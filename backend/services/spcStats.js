// backend/services/spcStats.js — สถิติ SPC ทั้งหมดของระบบ อยู่ไฟล์นี้ไฟล์เดียว
//
// pure ทั้งไฟล์ ไม่แตะ DB ไม่แตะ res ไม่มี state → เทสได้ตรง ๆ ด้วย node --test
//
// ⚠️ สองคำที่ห้ามสลับกันเด็ดขาด (ระบบเดิมสลับอยู่ นั่นคือบั๊กที่ rewrite นี้มาแก้):
//   spec limit    USL/LSL  มาจากแบบ         → ใช้ตัดสิน OK/NG และคิด Cp/Cpk
//   control limit UCL/LCL  คำนวณจากข้อมูล   → ใช้จับว่า process เปลี่ยน
// ชิ้นงานอยู่ในสเปกแต่ out-of-control ได้ และอยู่ใน control แต่หลุดสเปกก็ได้ คนละเรื่องกัน
'use strict';

const { getConstants, IMR, MIN_N, MAX_N } = require('./spcConstants');

// ── helper ────────────────────────────────────────────────────────────────

// mysql2 คืน DECIMAL มาเป็น string ("9.5000") — เทียบตรง ๆ จะกลายเป็นเทียบ string
// ทุกค่าที่เข้ามาในไฟล์นี้จึงต้องผ่าน toNum ก่อนเสมอ
const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// sample standard deviation (หาร n-1) — คืน null เมื่อมีน้อยกว่า 2 ค่า
const sampleSd = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

// ── 1. จัดกลุ่มเป็น subgroup ───────────────────────────────────────────────

// buildSubgroups(rows) — rows ต้องกรองมาแล้วว่าเป็นของ checkpoint เดียวเท่านั้น
//
// rows: [{ inspection_id, piece_no, value, n_used, subgroup_no, inspected_at, ...meta }]
// คืน { subgroups, n, mixedN }
//
// ⚠️ mixedN: ถ้ามีคนแก้ sample_size ของจุดตรวจหลังเก็บข้อมูลไปแล้ว ข้อมูลเก่าจะเป็น n=5
//    ข้อมูลใหม่เป็น n=3 ซึ่งใช้ A2/D3/D4 คนละตัว เอามารวมกราฟเดียวกันคือผิดหลักสถิติ
//    ฟังก์ชันนี้จึง "บอกว่าผสม" แล้วให้ปลายทางตัดสินใจ ไม่เฉลี่ยข้ามกันเงียบ ๆ
const buildSubgroups = (rows) => {
  const byInspection = new Map();

  for (const row of rows) {
    const value = toNum(row.value);
    if (value === null) continue; // จุด attribute ไม่มีตัวเลข ไม่เข้ากราฟ

    const key = row.inspection_id;
    if (!byInspection.has(key)) {
      byInspection.set(key, {
        inspectionId: key,
        subgroupNo: toNum(row.subgroup_no),
        nUsed: toNum(row.n_used) ?? 1,
        values: [],
        meta: {
          moNo: row.mo_no ?? null,
          lotNo: row.lot_no ?? null,
          shift: row.shift ?? null,
          inspector: row.inspector_name ?? null,
          machine: row.machine_name ?? null,
          inspectedAt: row.inspected_at ?? null,
        },
      });
    }
    byInspection.get(key).values.push({ pieceNo: toNum(row.piece_no) ?? 1, value });
  }

  // เรียงตามเวลาที่ตรวจ แล้วค่อย subgroup_no — เป็นลำดับที่กราฟเดินจากซ้ายไปขวา
  const subgroups = [...byInspection.values()]
    .sort((a, b) => {
      const ta = new Date(a.meta.inspectedAt).getTime() || 0;
      const tb = new Date(b.meta.inspectedAt).getTime() || 0;
      return ta - tb || (a.subgroupNo ?? 0) - (b.subgroupNo ?? 0);
    })
    .map((g) => {
      const values = g.values.sort((a, b) => a.pieceNo - b.pieceNo).map((v) => v.value);
      return {
        inspectionId: g.inspectionId,
        subgroupNo: g.subgroupNo,
        nUsed: g.nUsed,
        values,
        xbar: mean(values),
        // range ของ subgroup ที่มีค่าเดียวคือ 0 ซึ่งไม่มีความหมาย → null ให้ชัดว่าใช้ I-MR แทน
        range: values.length >= 2 ? Math.max(...values) - Math.min(...values) : null,
        meta: g.meta,
      };
    });

  const distinctN = [...new Set(subgroups.map((s) => s.nUsed))];

  return {
    subgroups,
    n: distinctN.length === 1 ? distinctN[0] : null,
    mixedN: distinctN.length > 1 ? { sizes: distinctN.sort((a, b) => a - b) } : null,
  };
};

// ── 2. control limit ──────────────────────────────────────────────────────

// computeLimits(subgroups, n, baseline)
//
// baseline = { xbarbar, rbar, n } ที่ freeze ไว้ที่ checkpoints — ถ้ามีให้ใช้อันนั้น
// ไม่มี → คำนวณสดจากข้อมูลที่มีแล้วตั้ง provisional = true
//
// ⚠️ ทำไมต้อง freeze: ถ้าคำนวณลิมิตใหม่จากข้อมูลทั้งหมดทุกครั้งที่เปิดกราฟ เส้นลิมิตจะ
//    วิ่งตาม process ที่ค่อย ๆ drift ไปด้วย แล้วจะไม่มีวันจับความผิดปกติได้เลย
//    (กับดักคลาสสิกของ SPC ที่เขียนเอง — ดูเหมือนทำงาน แต่ไม่เคยเตือนอะไรสักครั้ง)
const MIN_BASELINE_SUBGROUPS = 20;

const computeLimits = (subgroups, n, baseline = null) => {
  if (subgroups.length === 0) return null;

  const useBaseline =
    baseline &&
    toNum(baseline.xbarbar) !== null &&
    toNum(baseline.rbar) !== null &&
    // baseline ที่ทำไว้ตอน n ต่างจากปัจจุบัน ใช้ไม่ได้ ต้อง re-baseline
    (toNum(baseline.n) ?? n) === n;

  return n === 1
    ? individualsLimits(subgroups, useBaseline ? baseline : null)
    : xbarRLimits(subgroups, n, useBaseline ? baseline : null);
};

// X-bar R (n >= 2)
//   CL_X = Xbarbar          UCL_X = Xbarbar + A2*Rbar     LCL_X = Xbarbar - A2*Rbar
//   CL_R = Rbar             UCL_R = D4*Rbar               LCL_R = D3*Rbar
const xbarRLimits = (subgroups, n, baseline) => {
  const { A2, D3, D4, d2 } = getConstants(n);

  const xbarbar = baseline ? toNum(baseline.xbarbar) : mean(subgroups.map((s) => s.xbar));
  const rbar = baseline ? toNum(baseline.rbar) : mean(subgroups.map((s) => s.range));

  return {
    mode: 'xbar-r',
    n,
    baselineUsed: Boolean(baseline),
    provisional: !baseline && subgroups.length < MIN_BASELINE_SUBGROUPS,
    subgroupCount: subgroups.length,
    minBaselineSubgroups: MIN_BASELINE_SUBGROUPS,
    center: xbarbar,
    ucl: xbarbar + A2 * rbar,
    lcl: xbarbar - A2 * rbar,
    rangeCenter: rbar,
    rangeUcl: D4 * rbar,
    rangeLcl: D3 * rbar,
    // sigma ภายใน subgroup — ตัวนี้เท่านั้นที่เอาไปคิด Cp/Cpk ได้
    sigmaWithin: rbar / d2,
    xbarbar,
    rbar,
  };
};

// I-MR (n = 1) — moving range ของค่าติดกัน
//   MR_i = |x_i - x_(i-1)|  (จุดแรกไม่มี MR)
//   CL_I = xbar             UCL_I = xbar ± E2*MRbar
//   CL_MR = MRbar           UCL_MR = D4(2)*MRbar          LCL_MR = 0
const individualsLimits = (subgroups, baseline) => {
  const values = subgroups.map((s) => s.xbar);
  const movingRanges = values.slice(1).map((v, i) => Math.abs(v - values[i]));

  const center = baseline ? toNum(baseline.xbarbar) : mean(values);
  // baseline.rbar เก็บ MRbar ไว้ในช่องเดียวกัน (n=1 ไม่มี range จริง)
  const mrbar = baseline
    ? toNum(baseline.rbar)
    : movingRanges.length > 0
      ? mean(movingRanges)
      : 0;

  return {
    mode: 'i-mr',
    n: 1,
    baselineUsed: Boolean(baseline),
    provisional: !baseline && subgroups.length < MIN_BASELINE_SUBGROUPS,
    subgroupCount: subgroups.length,
    minBaselineSubgroups: MIN_BASELINE_SUBGROUPS,
    center,
    ucl: center + IMR.E2 * mrbar,
    lcl: center - IMR.E2 * mrbar,
    rangeCenter: mrbar,
    rangeUcl: IMR.D4 * mrbar,
    rangeLcl: IMR.D3 * mrbar,
    sigmaWithin: mrbar / IMR.d2,
    movingRanges,
    xbarbar: center,
    rbar: mrbar,
  };
};

// ── 3. ความสามารถของกระบวนการ ─────────────────────────────────────────────

// capability({ usl, lsl, sigmaWithin, values })
//
// Cp/Cpk ใช้ sigma ภายใน subgroup (Rbar/d2)   → "ถ้า process นิ่ง จะทำได้แค่ไหน"
// Pp/Ppk ใช้ sigma รวมทั้งหมด (sample SD)      → "ที่ผ่านมาทำได้จริงแค่ไหน"
//
// ⚠️ ระบบเดิมคำนวณด้วย sample SD รวมแล้วเรียกว่า Cp/Cpk — ตามนิยามสากลอันนั้นคือ Pp/Ppk
//    สองค่านี้ห่างกันมาก = ระหว่าง subgroup มีการเลื่อน (process ไม่นิ่ง) ซึ่งเป็นข้อมูลสำคัญ
//    ที่หายไปเลยถ้าแสดงแค่ตัวเดียว → หน้าจอต้องโชว์คู่กันเสมอ
const capability = ({ usl, lsl, sigmaWithin, values }) => {
  const U = toNum(usl);
  const L = toNum(lsl);
  const sigmaOverall = sampleSd(values);
  const within = toNum(sigmaWithin);

  const empty = { cp: null, cpk: null, pp: null, ppk: null, sigmaWithin: within, sigmaOverall, mean: null };
  if (values.length < 2) return empty;

  const m = mean(values);

  // sigma = 0 (ค่าวัดเท่ากันหมด) หารไม่ได้ — เดิมได้ Infinity แล้วโชว์เป็น "∞" บนหน้าจอ
  const ratios = (sigma) => {
    if (sigma === null || sigma <= 0) return { c: null, ck: null };
    const c = U !== null && L !== null ? (U - L) / (6 * sigma) : null;
    // Cpk ใช้ด้านที่มีอยู่จริงได้ ไม่จำเป็นต้องมีครบสองข้าง (สเปกด้านเดียวมีจริงในงาน)
    const upper = U !== null ? (U - m) / (3 * sigma) : null;
    const lower = L !== null ? (m - L) / (3 * sigma) : null;
    const sides = [upper, lower].filter((x) => x !== null);
    return { c, ck: sides.length > 0 ? Math.min(...sides) : null };
  };

  const w = ratios(within);
  const o = ratios(sigmaOverall);

  return { cp: w.c, cpk: w.ck, pp: o.c, ppk: o.ck, sigmaWithin: within, sigmaOverall, mean: m };
};

// ── 4. กฎ Nelson ──────────────────────────────────────────────────────────

// nelsonRules(points, { center, ucl }) → [{ index, rules: [1, 5] }]
//
// ครบทั้ง 8 ข้อตามมาตรฐาน · sigma เอามาจากระยะ center→UCL หารสาม (ไม่ใช่ SD ของข้อมูล)
// จุดที่ผิดกฎข้อ 1 = หลุด control limit · ข้ออื่นคือรูปแบบที่บอกว่า process กำลังเปลี่ยน
// ทั้งที่ยังไม่มีจุดไหนหลุดเส้น — เป็นเหตุผลหลักที่ต้องมีกฎพวกนี้ ไม่ใช่ดูแค่เส้นบนล่าง
const nelsonRules = (points, limits) => {
  const k = points.length;
  if (k === 0 || !limits) return [];

  const center = toNum(limits.center);
  const sigma = (toNum(limits.ucl) - center) / 3;
  if (!Number.isFinite(sigma) || sigma <= 0) return [];

  const hits = new Map(); // index → Set(ruleNo)
  const flag = (i, rule) => {
    if (!hits.has(i)) hits.set(i, new Set());
    hits.get(i).add(rule);
  };
  // ระยะห่างจากเส้นกลางเป็นหน่วย sigma (บวก = เหนือเส้นกลาง)
  const z = points.map((p) => (p - center) / sigma);
  const side = (i) => (z[i] > 0 ? 1 : z[i] < 0 ? -1 : 0);
  // ทำเครื่องหมายทั้งชุดที่ผิดกฎ ไม่ใช่เฉพาะจุดสุดท้าย — คนอ่านกราฟต้องเห็นว่าชุดไหน
  const flagRun = (start, end, rule) => {
    for (let i = start; i <= end; i += 1) flag(i, rule);
  };

  // 1: 1 จุดเกิน 3 sigma
  for (let i = 0; i < k; i += 1) if (Math.abs(z[i]) > 3) flag(i, 1);

  // 2: 9 จุดติดกันอยู่ข้างเดียวของเส้นกลาง
  for (let i = 8; i < k; i += 1) {
    const s = side(i);
    if (s !== 0 && Array.from({ length: 9 }, (_, j) => side(i - j)).every((x) => x === s)) {
      flagRun(i - 8, i, 2);
    }
  }

  // 3: 6 จุดติดกันไต่ขึ้นหรือไต่ลงตลอด
  for (let i = 5; i < k; i += 1) {
    const win = points.slice(i - 5, i + 1);
    const up = win.every((v, j) => j === 0 || v > win[j - 1]);
    const down = win.every((v, j) => j === 0 || v < win[j - 1]);
    if (up || down) flagRun(i - 5, i, 3);
  }

  // 4: 14 จุดติดกันสลับขึ้นลง
  for (let i = 13; i < k; i += 1) {
    let alternating = true;
    // 14 จุด = 13 ผลต่าง ต้องเทียบเครื่องหมายคู่ติดกัน 12 ครั้ง
    // (j สูงสุดคือ i-1 เพราะข้างในอ่าน points[j+1] — เลยไปกว่านี้จะหลุด array ได้ NaN)
    for (let j = i - 12; j <= i - 1; j += 1) {
      const prev = points[j] - points[j - 1];
      const next = points[j + 1] - points[j];
      if (prev === 0 || next === 0 || Math.sign(prev) === Math.sign(next)) {
        alternating = false;
        break;
      }
    }
    if (alternating) flagRun(i - 13, i, 4);
  }

  // 5: 2 ใน 3 จุดติดกัน เกิน 2 sigma ข้างเดียวกัน
  for (let i = 2; i < k; i += 1) {
    for (const s of [1, -1]) {
      const beyond = [0, 1, 2].filter((j) => side(i - j) === s && Math.abs(z[i - j]) > 2);
      if (beyond.length >= 2) flagRun(i - 2, i, 5);
    }
  }

  // 6: 4 ใน 5 จุดติดกัน เกิน 1 sigma ข้างเดียวกัน
  for (let i = 4; i < k; i += 1) {
    for (const s of [1, -1]) {
      const beyond = [0, 1, 2, 3, 4].filter((j) => side(i - j) === s && Math.abs(z[i - j]) > 1);
      if (beyond.length >= 4) flagRun(i - 4, i, 6);
    }
  }

  // 7: 15 จุดติดกันอยู่ในโซน 1 sigma ทั้งสองข้าง (แคบผิดปกติ — มักแปลว่าข้อมูลถูกแต่ง หรือลิมิตกว้างเกิน)
  for (let i = 14; i < k; i += 1) {
    if (Array.from({ length: 15 }, (_, j) => Math.abs(z[i - j])).every((a) => a < 1)) {
      flagRun(i - 14, i, 7);
    }
  }

  // 8: 8 จุดติดกันไม่มีจุดไหนอยู่ในโซน 1 sigma เลย (สองกลุ่มแยกกัน — มักแปลว่ามี 2 process ปนกัน)
  for (let i = 7; i < k; i += 1) {
    if (Array.from({ length: 8 }, (_, j) => Math.abs(z[i - j])).every((a) => a > 1)) {
      flagRun(i - 7, i, 8);
    }
  }

  return [...hits.entries()]
    .map(([index, rules]) => ({ index, rules: [...rules].sort((a, b) => a - b) }))
    .sort((a, b) => a.index - b.index);
};

// ── 5. ประกอบทั้งหมด ──────────────────────────────────────────────────────

// analyze(rows, { usl, lsl, baseline }) — ตัวที่ route เรียกใช้จริง
// คืนทุกอย่างที่หน้ากราฟต้องการในก้อนเดียว ฝั่ง client แค่เอาไปวาด ไม่ต้องคำนวณอะไรอีก
const analyze = (rows, { usl = null, lsl = null, baseline = null } = {}) => {
  const { subgroups, n, mixedN } = buildSubgroups(rows);

  if (mixedN) {
    // ไม่คำนวณต่อโดยตั้งใจ — ค่า A2/D4 ของ n ต่างกันคนละตัว รวมกราฟเดียวกันไม่ได้
    return {
      mode: null,
      points: [],
      limits: null,
      capability: null,
      violations: [],
      mixedN,
      error: `subgroup ในช่วงนี้มีขนาดไม่เท่ากัน (n = ${mixedN.sizes.join(', ')}) — sample_size ถูกแก้หลังเก็บข้อมูล ต้อง re-baseline และแยกช่วงก่อนจึงจะอ่านกราฟได้`,
    };
  }

  if (subgroups.length === 0) {
    return { mode: null, points: [], limits: null, capability: null, violations: [], mixedN: null };
  }

  if (n > MAX_N || n < 1) {
    return {
      mode: null, points: [], limits: null, capability: null, violations: [], mixedN: null,
      error: `subgroup size = ${n} อยู่นอกช่วงที่รองรับ (1 หรือ ${MIN_N}-${MAX_N})`,
    };
  }

  const limits = computeLimits(subgroups, n, baseline);
  const chartValues = subgroups.map((s) => s.xbar);
  const allValues = subgroups.flatMap((s) => s.values);
  const violations = nelsonRules(chartValues, limits);
  const violationByIndex = new Map(violations.map((v) => [v.index, v.rules]));

  // จุดบนกราฟล่าง: n>=2 เป็น range ของ subgroup · n=1 เป็น moving range (จุดแรกไม่มี)
  const rangeAt = (i) =>
    limits.mode === 'i-mr' ? (i === 0 ? null : limits.movingRanges[i - 1]) : subgroups[i].range;

  return {
    mode: limits.mode,
    n,
    limits,
    mixedN: null,
    points: subgroups.map((s, i) => ({
      index: i,
      subgroupNo: s.subgroupNo,
      inspectionId: s.inspectionId,
      xbar: s.xbar,
      range: rangeAt(i),
      values: s.values,
      meta: s.meta,
      rules: violationByIndex.get(i) ?? [],
    })),
    violations,
    inControl: violations.length === 0,
    capability: capability({ usl, lsl, sigmaWithin: limits.sigmaWithin, values: allValues }),
  };
};

module.exports = {
  toNum,
  mean,
  sampleSd,
  buildSubgroups,
  computeLimits,
  capability,
  nelsonRules,
  analyze,
  MIN_BASELINE_SUBGROUPS,
};
