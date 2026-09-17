// เทส spcStats — ใช้ชุดข้อมูลที่คำนวณด้วยมือได้ทุกตัว ไม่ใช่เทียบกับผลที่โค้ดตัวเองพ่นออกมา
// ทุกเคสมีตัวเลขที่คาดหวังเขียนกำกับไว้ว่ามาจากสูตรไหน
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  buildSubgroups, computeLimits, capability, nelsonRules, analyze, sampleSd,
} = require('../spcStats');

const close = (actual, expected, tol = 1e-6, msg = '') =>
  assert.ok(Math.abs(actual - expected) < tol, `${msg} ได้ ${actual} คาดว่า ${expected}`);

// สร้าง rows แบบที่ออกมาจาก query จริง (ค่า decimal เป็น string เหมือน mysql2 คืนมา)
const makeRows = (groups, { nUsed = null } = {}) =>
  groups.flatMap((values, gi) =>
    values.map((v, pi) => ({
      inspection_id: gi + 1,
      subgroup_no: gi + 1,
      piece_no: pi + 1,
      value: String(v.toFixed(4)),      // ← string โดยตั้งใจ mysql2 คืน DECIMAL มาแบบนี้
      n_used: nUsed ?? values.length,
      inspected_at: `2026-09-1${gi % 9} 08:00:00`,
      mo_no: `MO-${gi + 1}`,
      shift: 'M',
      inspector_name: 'สมชาย',
    }))
  );

// ── buildSubgroups ────────────────────────────────────────────────────────

test('buildSubgroups แปลง string จาก mysql2 เป็นตัวเลขและคิด xbar/range ถูก', () => {
  const { subgroups, n, mixedN } = buildSubgroups(makeRows([[10, 12], [11, 13], [9, 11]]));
  assert.strictEqual(n, 2);
  assert.strictEqual(mixedN, null);
  assert.strictEqual(subgroups.length, 3);
  close(subgroups[0].xbar, 11, 1e-9, 'xbar S1');   // (10+12)/2
  close(subgroups[0].range, 2, 1e-9, 'range S1');  // 12-10
  close(subgroups[2].xbar, 10, 1e-9, 'xbar S3');   // (9+11)/2
});

test('buildSubgroups ตั้ง range = null เมื่อ subgroup มีค่าเดียว (n=1 ต้องใช้ I-MR)', () => {
  const { subgroups, n } = buildSubgroups(makeRows([[10], [12]]));
  assert.strictEqual(n, 1);
  assert.strictEqual(subgroups[0].range, null);
});

test('buildSubgroups บอกว่า n ผสมกัน ไม่ใช่เฉลี่ยข้ามกันเงียบ ๆ', () => {
  const rows = [...makeRows([[10, 12]]), ...makeRows([[9, 10, 11]]).map((r) => ({ ...r, inspection_id: 99 }))];
  const { mixedN } = buildSubgroups(rows);
  assert.deepStrictEqual(mixedN, { sizes: [2, 3] });
});

test('buildSubgroups ข้ามแถว attribute ที่ value เป็น null', () => {
  const rows = [
    ...makeRows([[10, 12]]),
    { inspection_id: 1, subgroup_no: 1, piece_no: 3, value: null, n_used: 2, judgment: 'OK' },
  ];
  const { subgroups } = buildSubgroups(rows);
  assert.strictEqual(subgroups[0].values.length, 2);
});

// ── X-bar R (n >= 2) ──────────────────────────────────────────────────────
//
// ชุดข้อมูล: S1=[10,12] S2=[11,13] S3=[9,11]  → xbar = 11, 12, 10 · R = 2, 2, 2
// Xbarbar = 11 · Rbar = 2 · n=2 → A2=1.880 D3=0 D4=3.267 d2=1.128
//   UCL_X = 11 + 1.880*2 = 14.760     LCL_X = 11 - 3.760 = 7.240
//   UCL_R = 3.267*2 = 6.534           LCL_R = 0
//   sigmaWithin = Rbar/d2 = 2/1.128 = 1.7730496...

test('X-bar R คำนวณ control limit ตรงกับที่คิดมือ', () => {
  const { subgroups, n } = buildSubgroups(makeRows([[10, 12], [11, 13], [9, 11]]));
  const L = computeLimits(subgroups, n, null);

  assert.strictEqual(L.mode, 'xbar-r');
  close(L.center, 11, 1e-9, 'Xbarbar');
  close(L.ucl, 14.76, 1e-9, 'UCL_X');
  close(L.lcl, 7.24, 1e-9, 'LCL_X');
  close(L.rangeCenter, 2, 1e-9, 'Rbar');
  close(L.rangeUcl, 6.534, 1e-9, 'UCL_R');
  close(L.rangeLcl, 0, 1e-9, 'LCL_R');
  close(L.sigmaWithin, 2 / 1.128, 1e-9, 'sigma within');
});

test('ยังไม่ถึง 20 subgroup และไม่มี baseline → provisional = true', () => {
  const { subgroups, n } = buildSubgroups(makeRows([[10, 12], [11, 13], [9, 11]]));
  const L = computeLimits(subgroups, n, null);
  assert.strictEqual(L.provisional, true);
  assert.strictEqual(L.baselineUsed, false);
});

test('มี baseline แล้วต้องใช้ค่าที่ freeze ไว้ ไม่คำนวณสดจากข้อมูลปัจจุบัน', () => {
  const { subgroups, n } = buildSubgroups(makeRows([[10, 12], [11, 13], [9, 11]]));
  // baseline บอกว่า Xbarbar=20 Rbar=4 ซึ่งไม่ตรงกับข้อมูลชุดนี้เลย — ต้องเชื่อ baseline
  const L = computeLimits(subgroups, n, { xbarbar: '20.0000', rbar: '4.0000', n: 2 });
  assert.strictEqual(L.baselineUsed, true);
  assert.strictEqual(L.provisional, false);
  close(L.center, 20, 1e-9, 'center จาก baseline');
  close(L.ucl, 20 + 1.88 * 4, 1e-9, 'UCL จาก baseline');   // 27.52
});

test('baseline ที่ทำไว้ตอน n ต่างจากปัจจุบัน ต้องถูกปฏิเสธ (A2/D4 คนละตัว)', () => {
  const { subgroups, n } = buildSubgroups(makeRows([[10, 12], [11, 13], [9, 11]]));
  const L = computeLimits(subgroups, n, { xbarbar: '20.0000', rbar: '4.0000', n: 5 });
  assert.strictEqual(L.baselineUsed, false);
  close(L.center, 11, 1e-9, 'กลับไปคำนวณสด');
});

// ── I-MR (n = 1) ──────────────────────────────────────────────────────────
//
// ค่า: 10, 12, 11, 14 → MR = 2, 1, 3 → MRbar = 2 · xbar = 11.75
//   UCL_I  = 11.75 + 2.660*2 = 17.07      LCL_I = 11.75 - 5.32 = 6.43
//   UCL_MR = 3.267*2 = 6.534              LCL_MR = 0

test('I-MR คำนวณ moving range และ limit ตรงกับที่คิดมือ', () => {
  const { subgroups, n } = buildSubgroups(makeRows([[10], [12], [11], [14]]));
  const L = computeLimits(subgroups, n, null);

  assert.strictEqual(L.mode, 'i-mr');
  assert.deepStrictEqual(L.movingRanges, [2, 1, 3]);
  close(L.center, 11.75, 1e-9, 'xbar');
  close(L.rangeCenter, 2, 1e-9, 'MRbar');
  close(L.ucl, 17.07, 1e-9, 'UCL_I');
  close(L.lcl, 6.43, 1e-9, 'LCL_I');
  close(L.rangeUcl, 6.534, 1e-9, 'UCL_MR');
  close(L.rangeLcl, 0, 1e-9, 'LCL_MR');
});

// ── capability ────────────────────────────────────────────────────────────
//
// ค่าทั้งหมด: 10,12,11,13,9,11 → mean = 11 · sample SD = sqrt(10/5) = sqrt(2) = 1.4142136
// sigmaWithin = 2/1.128 = 1.7730496
// USL=20 LSL=2 →  Cp = 18/(6*1.7730496) = 1.691979...
//                 Pp = 18/(6*1.4142136) = 2.121320...

test('Cp/Cpk ใช้ sigma ภายใน subgroup ส่วน Pp/Ppk ใช้ sigma รวม — ต้องได้คนละค่า', () => {
  const values = [10, 12, 11, 13, 9, 11];
  const c = capability({ usl: 20, lsl: 2, sigmaWithin: 2 / 1.128, values });

  close(c.sigmaOverall, Math.sqrt(2), 1e-9, 'sigma overall');
  close(c.cp, 18 / (6 * (2 / 1.128)), 1e-9, 'Cp');
  close(c.pp, 18 / (6 * Math.sqrt(2)), 1e-9, 'Pp');
  assert.ok(Math.abs(c.cp - c.pp) > 0.1, 'Cp กับ Pp ต้องไม่เท่ากันเมื่อมี between-subgroup variation');
  // mean = 11 อยู่กึ่งกลางสเปกพอดี (2..20 กลางคือ 11) → Cpk = Cp
  close(c.cpk, c.cp, 1e-9, 'Cpk = Cp เมื่อ mean อยู่กลางสเปก');
});

test('ค่าวัดเท่ากันหมด (sigma = 0) ต้องได้ null ไม่ใช่ Infinity', () => {
  const c = capability({ usl: 20, lsl: 2, sigmaWithin: 0, values: [11, 11, 11, 11] });
  assert.strictEqual(c.cp, null);
  assert.strictEqual(c.cpk, null);
  assert.strictEqual(c.pp, null);
  assert.strictEqual(c.ppk, null);
});

test('ไม่ได้ตั้ง USL/LSL → Cp เป็น null แต่ไม่พัง', () => {
  const c = capability({ usl: null, lsl: null, sigmaWithin: 1.5, values: [10, 12, 11] });
  assert.strictEqual(c.cp, null);
  assert.strictEqual(c.cpk, null);
  assert.ok(c.sigmaOverall > 0);
});

test('สเปกด้านเดียว (มีแต่ USL) ยังคิด Cpk ได้ แต่ Cp เป็น null', () => {
  // mean=11 sigma=2 → Cpu = (20-11)/(3*2) = 1.5
  const c = capability({ usl: 20, lsl: null, sigmaWithin: 2, values: [9, 11, 13] });
  assert.strictEqual(c.cp, null);
  close(c.cpk, 1.5, 1e-9, 'Cpk ด้านเดียว');
});

test('sampleSd หาร n-1 และคืน null เมื่อมีค่าเดียว', () => {
  close(sampleSd([10, 12, 11, 13, 9, 11]), Math.sqrt(2), 1e-9);
  assert.strictEqual(sampleSd([5]), null);
});

// ── Nelson rules ──────────────────────────────────────────────────────────

const limitsFor = (center, sigma) => ({ center, ucl: center + 3 * sigma, lcl: center - 3 * sigma });

test('กฎ 1 — จุดเดียวหลุด 3 sigma', () => {
  const pts = [10, 10, 10, 10, 20];  // sigma=1 → จุดสุดท้ายอยู่ที่ +10 sigma
  const v = nelsonRules(pts, limitsFor(10, 1));
  assert.deepStrictEqual(v.map((x) => x.index), [4]);
  assert.ok(v[0].rules.includes(1));
});

test('กฎ 2 — 9 จุดติดกันอยู่ข้างเดียวของเส้นกลาง (ทั้งที่ไม่มีจุดไหนหลุดเส้น)', () => {
  const pts = Array(9).fill(10.5);   // center=10 sigma=1 → +0.5 sigma ทุกจุด ไม่หลุดลิมิต
  const v = nelsonRules(pts, limitsFor(10, 1));
  assert.strictEqual(v.length, 9, 'ต้องมาร์กทั้งชุด ไม่ใช่เฉพาะจุดสุดท้าย');
  assert.ok(v.every((x) => x.rules.includes(2)));
  assert.ok(v.every((x) => !x.rules.includes(1)), 'ไม่ควรติดกฎ 1 เพราะไม่มีจุดไหนหลุด 3 sigma');
});

test('กฎ 3 — 6 จุดติดกันไต่ขึ้นตลอด', () => {
  const pts = [10, 10.1, 10.2, 10.3, 10.4, 10.5];
  const v = nelsonRules(pts, limitsFor(10, 1));
  assert.ok(v.length > 0 && v.every((x) => x.rules.includes(3)));
});

test('ข้อมูลที่นิ่งและสลับข้างปกติ ต้องไม่ติดกฎอะไรเลย', () => {
  const pts = [10.2, 9.8, 10.1, 9.9, 10.3, 9.7, 10.0, 10.2, 9.8];
  assert.deepStrictEqual(nelsonRules(pts, limitsFor(10, 1)), []);
});

test('nelsonRules ไม่พังและไม่คืนอะไรเมื่อ sigma = 0 หรือไม่มีจุด', () => {
  assert.deepStrictEqual(nelsonRules([10, 10, 10], limitsFor(10, 0)), []);
  assert.deepStrictEqual(nelsonRules([], limitsFor(10, 1)), []);
});

test('กฎ 4 ไม่อ่านหลุด array (14 จุดสลับขึ้นลงพอดี)', () => {
  const pts = Array.from({ length: 14 }, (_, i) => 10 + (i % 2 === 0 ? 0.2 : -0.2));
  const v = nelsonRules(pts, limitsFor(10, 1));
  assert.ok(v.every((x) => x.rules.every((r) => Number.isInteger(r))), 'ต้องไม่มี NaN หลุดมา');
});

// ── analyze (ตัวที่ route เรียกจริง) ───────────────────────────────────────

test('analyze คืนทุกอย่างที่หน้ากราฟต้องใช้ในก้อนเดียว', () => {
  const rows = makeRows([[10, 12], [11, 13], [9, 11]]);
  const r = analyze(rows, { usl: 20, lsl: 2 });

  assert.strictEqual(r.mode, 'xbar-r');
  assert.strictEqual(r.n, 2);
  assert.strictEqual(r.points.length, 3);
  close(r.points[0].xbar, 11, 1e-9);
  close(r.points[0].range, 2, 1e-9);
  assert.strictEqual(r.points[0].meta.moNo, 'MO-1', 'meta ต้องติดไปกับจุด ไว้ทำ tooltip');
  assert.strictEqual(r.inControl, true);
  assert.ok(r.capability.cp > 0 && r.capability.pp > 0);
});

test('analyze กับ n=1 ให้จุด range แรกเป็น null แล้วตามด้วย moving range', () => {
  const r = analyze(makeRows([[10], [12], [11], [14]]), {});
  assert.strictEqual(r.mode, 'i-mr');
  assert.strictEqual(r.points[0].range, null);
  close(r.points[1].range, 2, 1e-9);
  close(r.points[3].range, 3, 1e-9);
});

test('analyze ปฏิเสธเมื่อ n ผสมกัน พร้อมข้อความบอกว่าต้องทำอะไร', () => {
  const rows = [
    ...makeRows([[10, 12]]),
    ...makeRows([[9, 10, 11]]).map((r) => ({ ...r, inspection_id: 99 })),
  ];
  const r = analyze(rows, {});
  assert.ok(r.error && r.error.includes('re-baseline'));
  assert.deepStrictEqual(r.points, []);
  assert.strictEqual(r.limits, null);
});

test('analyze กับข้อมูลว่าง ไม่พัง', () => {
  const r = analyze([], { usl: 10, lsl: 1 });
  assert.deepStrictEqual(r.points, []);
  assert.strictEqual(r.limits, null);
});
