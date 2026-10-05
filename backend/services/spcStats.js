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
    // ค่าคงที่ที่ใช้จริง — หน้า SC เอาไปแทนค่าใน tooltip สูตร (client ห้ามถือตารางนี้เอง)
    constants: { A2, D3, D4, d2 },
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
    constants: { E2: IMR.E2, D3: IMR.D3, D4: IMR.D4, d2: IMR.d2 },
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

  const empty = { cp: null, cpk: null, cpu: null, cpl: null, pp: null, ppk: null, sigmaWithin: within, sigmaOverall, mean: null };
  if (values.length < 2) return empty;

  const m = mean(values);

  // sigma = 0 (ค่าวัดเท่ากันหมด) หารไม่ได้ — เดิมได้ Infinity แล้วโชว์เป็น "∞" บนหน้าจอ
  const ratios = (sigma) => {
    if (sigma === null || sigma <= 0) return { c: null, ck: null, upper: null, lower: null };
    const c = U !== null && L !== null ? (U - L) / (6 * sigma) : null;
    // Cpk ใช้ด้านที่มีอยู่จริงได้ ไม่จำเป็นต้องมีครบสองข้าง (สเปกด้านเดียวมีจริงในงาน)
    const upper = U !== null ? (U - m) / (3 * sigma) : null;
    const lower = L !== null ? (m - L) / (3 * sigma) : null;
    const sides = [upper, lower].filter((x) => x !== null);
    return { c, ck: sides.length > 0 ? Math.min(...sides) : null, upper, lower };
  };

  const w = ratios(within);
  const o = ratios(sigmaOverall);

  // cpu / cpl = Cpk ด้านบน/ด้านล่างแยกกัน (กล่องสถิติของชีต SC โชว์ทั้งสองตัว) ใช้ sigma ภายในเหมือน Cpk
  return {
    cp: w.c, cpk: w.ck, cpu: w.upper, cpl: w.lower,
    pp: o.c, ppk: o.ck, sigmaWithin: within, sigmaOverall, mean: m,
  };
};

// ── 4. กฎ OCS (Out of Control Signal) ─────────────────────────────────────
//
// ตามคู่มือ "ลักษณะกราฟที่ไม่อยู่ภายใต้การควบคุม" (8 กฎ) — Mechanical Div. ใช้กฎ 1-4 · MAMM ใช้ครบ 8
// ชุดที่ใช้เลือกตามลูกค้าของ item (customers.ocs_rule_set → capabilityTarget.resolveTargets)

// รหัสกฎ — ⚠️ ต้องตรงกับ OCS_RULES ใน frontend/src/utils/spcRules.js (ลำดับ = ลำดับแถวในตาราง OCS)
//   กฎ 1 out · กฎ 2 shift_up/down · กฎ 3 trend_up/down · กฎ 4 alt14
//   กฎ 5 zone_a · กฎ 6 zone_b · กฎ 7 strat15 · กฎ 8 mix8
const OCS_RULE_IDS = [
  'out', 'shift_up', 'shift_down', 'trend_up', 'trend_down', 'alt14',
  'zone_a', 'zone_b', 'strat15', 'mix8',
];

// กฎ 5-8 อิงโซน σ สองฝั่งของ CL — ใช้กับกราฟบน (X̄ / I) เท่านั้น
// กราฟ R/MR ไม่สมมาตร (LCL = 0 บ่อย) โซนบนกราฟนั้นไม่มีความหมายในทางปฏิบัติ
const ZONE_RULES = ['zone_a', 'zone_b', 'strat15', 'mix8'];

const RULE_SETS = {
  basic: OCS_RULE_IDS.filter((r) => !ZONE_RULES.includes(r)),
  full: OCS_RULE_IDS,
};

// ocsRules(values, { center, ucl, lcl, enabled }) → [{ index, rules: ['out', 'shift_up'] }]
//
//   out         จุดหลุด UCL หรือ LCL (เทียบกับเส้นตรง ๆ — LCL ของกราฟ R เป็น 0 ได้)
//   shift_*     7 จุดติดกันอยู่เหนือ / ใต้ CL
//   trend_*     7 จุดติดกันไต่ขึ้น / ลงตลอด (= 6 ช่วงที่เพิ่ม/ลดติดกัน) — คู่มือใช้ 7 ไม่ใช่ 6 ของฟอร์ม Excel
//   alt14       14 จุดติดกันสลับขึ้นลง
//   zone_a      2 ใน 3 จุดติดกันเกิน 2σ ฝั่งเดียวกัน (Zone A)
//   zone_b      4 ใน 5 จุดติดกันเกิน 1σ ฝั่งเดียวกัน (Zone B ขึ้นไป)
//   strat15     15 จุดติดกันอยู่ใน ±1σ (Zone C) — แคบผิดปกติ มักคือ subgroup ปนหลายแหล่ง
//   mix8        8 จุดติดกันอยู่นอก ±1σ (ฝั่งไหนก็ได้ ไม่มีจุดใน Zone C) — ข้อมูลผสมสองกลุ่ม
//
// ⚠️ σ ของโซนมาจากเส้นลิมิตตรง ๆ: เหนือ CL = (UCL−CL)/3 · ใต้ CL = (CL−LCL)/3 ไม่คิดใหม่จากข้อมูล
//    โซนจึงตรงกับเส้นที่วาดบนกราฟเสมอ (baseline ที่ล็อกไว้ก็ได้ σ ของ baseline)
// ⚠️ ทำเครื่องหมายเฉพาะ "จุดที่ครบเงื่อนไข" (จุดท้ายของชุด) ไม่ใช่ทั้งชุด — ตรงกับคอลัมน์ *** ใน Event Log
//    ของ Excel · ชุดที่ยาวต่อไปอีก จุดถัด ๆ ไปก็ครบเงื่อนไขด้วยตัวเองจึงถูกทำเครื่องหมายต่อเนื่อง
//    กฎ "x ใน y จุด" (zone_a/zone_b) จุดท้ายต้องเป็นหนึ่งในจุดที่เกินเองด้วย ไม่งั้นจุดที่กลับเข้าโซนปกติ
//    แล้วจะโดนทำเครื่องหมายแทน
// ⚠️ จุดที่เป็น null (MR จุดแรกของ I-MR) ตัดสายของทุกกฎที่ต้องนับติดกัน
const ocsRules = (values, { center, ucl, lcl, enabled = RULE_SETS.basic } = {}) => {
  const k = values.length;
  const C = toNum(center);
  const U = toNum(ucl);
  const L = toNum(lcl);
  if (k === 0) return [];
  const on = new Set(enabled);

  const hits = new Map(); // index → Set(ruleId)
  const flag = (idx, rule) => {
    if (!on.has(rule)) return;
    if (!hits.has(idx)) hits.set(idx, new Set());
    hits.get(idx).add(rule);
  };
  const ok = (idx) => idx >= 0 && values[idx] !== null && Number.isFinite(values[idx]);
  // ทุกจุดในหน้าต่าง [i-len+1 .. i] มีค่าและผ่าน test
  const run = (i, len, test) => {
    if (i - len + 1 < 0) return false;
    for (let j = i - len + 1; j <= i; j += 1) if (!ok(j) || !test(j)) return false;
    return true;
  };
  // จำนวนจุดในหน้าต่าง len จุดล่าสุดที่ผ่าน test
  // ⚠️ ต้นกราฟหน้าต่างสั้นกว่า len ได้ — ไม่งั้น 2 จุดแรกที่เกิน 2σ ติดกันจะไม่ถูกจับเลย
  //    (จุดที่ 3 กลับเข้าโซนปกติ = ไม่ใช่จุดที่ทำเครื่องหมาย) · จุดว่างนับเป็นไม่ผ่าน
  const countIn = (i, len, test) => {
    let n = 0;
    for (let j = Math.max(0, i - len + 1); j <= i; j += 1) if (ok(j) && test(j)) n += 1;
    return n;
  };

  // σ แยกสองฝั่ง — มีได้เมื่อรู้ทั้ง CL/UCL/LCL และช่วงกว้างกว่า 0
  const zones = C !== null && U !== null && L !== null && U > C && C > L
    ? { up: (U - C) / 3, down: (C - L) / 3 }
    : null;
  // ระยะจาก CL เป็นจำนวน σ ของฝั่งที่จุดนั้นอยู่ (บวก = เหนือ CL)
  const z = (v) => (v >= C ? (v - C) / zones.up : (v - C) / zones.down);
  const beyond = (j, side, n) => Math.sign(z(values[j])) === side && Math.abs(z(values[j])) > n;

  for (let i = 0; i < k; i += 1) {
    if (!ok(i)) continue;
    const v = values[i];

    // กฎ 1
    if ((U !== null && v > U) || (L !== null && v < L)) flag(i, 'out');

    // กฎ 2
    if (C !== null) {
      if (run(i, 7, (j) => values[j] > C)) flag(i, 'shift_up');
      if (run(i, 7, (j) => values[j] < C)) flag(i, 'shift_down');
    }

    // กฎ 3 — 7 จุดไต่ตลอด = 6 ช่วงที่เพิ่มขึ้นติดกัน (จุดแรกของหน้าต่างไม่ต้องเทียบกับตัวก่อนหน้า)
    if (run(i, 7, () => true)) {
      let up = true;
      let down = true;
      for (let j = i - 5; j <= i; j += 1) {
        if (!(values[j] > values[j - 1])) up = false;
        if (!(values[j] < values[j - 1])) down = false;
      }
      if (up) flag(i, 'trend_up');
      if (down) flag(i, 'trend_down');
    }

    // กฎ 4 — 14 จุดสลับขึ้นลง = 13 ผลต่างที่เครื่องหมายสลับกันทุกคู่ติดกัน (12 คู่ · ผลต่าง 0 ตัดสาย)
    // ⚠️ j เริ่มที่ i-11 เพราะข้างในอ่าน values[j-2] — ต่ำกว่านี้จะอ่านจุดนอกหน้าต่าง 14 จุด
    if (run(i, 14, () => true)) {
      let alternating = true;
      for (let j = i - 11; j <= i && alternating; j += 1) {
        const prev = values[j - 1] - values[j - 2];
        const next = values[j] - values[j - 1];
        if (prev === 0 || next === 0 || Math.sign(prev) === Math.sign(next)) alternating = false;
      }
      if (alternating) flag(i, 'alt14');
    }

    if (!zones) continue;
    const side = Math.sign(z(v));

    // กฎ 5 — 2 ใน 3 เกิน 2σ ฝั่งเดียวกับจุดนี้ (จุดนี้ต้องเกินเอง)
    if (beyond(i, side, 2) && countIn(i, 3, (j) => beyond(j, side, 2)) >= 2) flag(i, 'zone_a');
    // กฎ 6 — 4 ใน 5 เกิน 1σ ฝั่งเดียวกับจุดนี้ (จุดนี้ต้องเกินเอง)
    if (beyond(i, side, 1) && countIn(i, 5, (j) => beyond(j, side, 1)) >= 4) flag(i, 'zone_b');
    // กฎ 7 — 15 จุดติดกันอยู่ใน ±1σ
    if (run(i, 15, (j) => Math.abs(z(values[j])) < 1)) flag(i, 'strat15');
    // กฎ 8 — 8 จุดติดกันอยู่นอก ±1σ
    if (run(i, 8, (j) => Math.abs(z(values[j])) > 1)) flag(i, 'mix8');
  }

  return [...hits.entries()]
    .map(([index, rules]) => ({ index, rules: OCS_RULE_IDS.filter((r) => rules.has(r)) }))
    .sort((a, b) => a.index - b.index);
};

// ── 5. ประกอบทั้งหมด ──────────────────────────────────────────────────────

// analyze(rows, { usl, lsl, baseline }) — ตัวที่ route เรียกใช้จริง
// คืนทุกอย่างที่หน้ากราฟต้องการในก้อนเดียว ฝั่ง client แค่เอาไปวาด ไม่ต้องคำนวณอะไรอีก
const analyze = (rows, { usl = null, lsl = null, baseline = null, ruleSet = 'basic' } = {}) => {
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

  // จุดบนกราฟล่าง: n>=2 เป็น range ของ subgroup · n=1 เป็น moving range (จุดแรกไม่มี)
  const rangeAt = (i) =>
    limits.mode === 'i-mr' ? (i === 0 ? null : limits.movingRanges[i - 1]) : subgroups[i].range;
  const rangeValues = subgroups.map((_, i) => rangeAt(i));

  // กฎ OCS ใช้กับทั้งกราฟบน (X̄ / I) และกราฟล่าง (R / MR) แยกกัน — ตาราง OCS ของฟอร์มมีครบทั้งสองชุด
  // violations: 1 แถวต่อ "จุด × กราฟ" · chart = 'xbar' | 'range' (Event Log ผูกกับคู่นี้)
  // ชุดกฎตามลูกค้า (basic = 1-4 · full = 1-8) · กราฟล่างไม่ใช้กฎโซน (5-8) เสมอ
  const xbarRules = RULE_SETS[ruleSet] ?? RULE_SETS.basic;
  const rangeRules = xbarRules.filter((r) => !ZONE_RULES.includes(r));
  const xbarHits = ocsRules(chartValues, { center: limits.center, ucl: limits.ucl, lcl: limits.lcl, enabled: xbarRules });
  const rangeHits = ocsRules(rangeValues, {
    center: limits.rangeCenter, ucl: limits.rangeUcl, lcl: limits.rangeLcl, enabled: rangeRules,
  });
  const xbarByIndex = new Map(xbarHits.map((v) => [v.index, v.rules]));
  const rangeByIndex = new Map(rangeHits.map((v) => [v.index, v.rules]));
  const violations = [
    ...xbarHits.map((v) => ({ ...v, chart: 'xbar' })),
    ...rangeHits.map((v) => ({ ...v, chart: 'range' })),
  ].sort((a, b) => a.index - b.index || (a.chart === 'xbar' ? -1 : 1));

  // กล่องสถิติของชีต SC — คิดจากข้อมูลในช่วงที่ดูอยู่ ไม่ใช่จาก baseline
  const presentRanges = rangeValues.filter((r) => r !== null);
  const stats = {
    count: allValues.length,
    subgroups: subgroups.length,
    max: allValues.length ? Math.max(...allValues) : null,
    min: allValues.length ? Math.min(...allValues) : null,
    xbarbar: chartValues.length ? mean(chartValues) : null,
    rbar: presentRanges.length ? mean(presentRanges) : null,
  };

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
      rules: xbarByIndex.get(i) ?? [],
      rangeRules: rangeByIndex.get(i) ?? [],
    })),
    violations,
    // กฎที่ใช้กับจุดนี้ — หน้า SC วาดแถวตาราง OCS ตามนี้ (ลูกค้า basic ไม่มีแถวกฎ 5-8)
    ocs: { ruleSet: RULE_SETS[ruleSet] ? ruleSet : 'basic', xbar: xbarRules, range: rangeRules },
    inControl: violations.length === 0,
    capability: capability({ usl, lsl, sigmaWithin: limits.sigmaWithin, values: allValues }),
    stats,
  };
};

module.exports = {
  toNum,
  mean,
  sampleSd,
  buildSubgroups,
  computeLimits,
  capability,
  ocsRules,
  OCS_RULE_IDS,
  RULE_SETS,
  ZONE_RULES,
  analyze,
  MIN_BASELINE_SUBGROUPS,
};
