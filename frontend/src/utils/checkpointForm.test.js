// เทส utils/checkpointForm.js
//
// สองเรื่องที่ต้องไม่พลาด:
//   1. specIssues ต้องเงียบกับสเปกด้านเดียว — เตือนพร่ำเพรื่อแล้วคนจะเลิกอ่านคำเตือนจริง
//   2. localStorage อ่าน/เขียนไม่ได้ ต้องไม่ throw (หน้าตั้งค่าต้องเปิดได้แม้จำอะไรไม่ได้)
import {
  UNIT_OPTIONS, mergeOptions, specIssues, limitsFromTolerance, toleranceFromLimits,
  readCpMemory, rememberCp, clearCpMemory,
} from './checkpointForm';

beforeEach(() => localStorage.clear());

// ── หน่วย ──────────────────────────────────────────────────────────────────

test("μ ในลิสต์หน่วยเป็น U+03BC ไม่ใช่ U+00B5 ที่หน้าตาเหมือนกัน", () => {
  expect(UNIT_OPTIONS).toEqual(['mm', '\u03BCm']);
  expect(UNIT_OPTIONS).not.toContain('\u00B5m');
});

test('mergeOptions ตัดค่าว่าง ตัดตัวซ้ำแบบไม่สนตัวพิมพ์ และคงลำดับ', () => {
  expect(mergeOptions(['mm', 'μm'], ['  MM  ', '', null, 'Ra', 'ra'])).toEqual(['mm', 'μm', 'Ra']);
});

test('mergeOptions รับลิสต์ว่าง/undefined ได้', () => {
  expect(mergeOptions(undefined, [], null)).toEqual([]);
});

// ── ตรวจสเปก ───────────────────────────────────────────────────────────────

test('LSL มากกว่า USL = ห้ามบันทึก (ทุกชิ้นที่วัดจะเป็น NG)', () => {
  const { blocking, warnings } = specIssues({ char_type: 'variable', lsl: 10, usl: 9 });
  expect(blocking).toMatch(/LSL มากกว่า USL/);
  expect(warnings).toEqual([]);
});

test('LSL เท่ากับ USL = เตือนแต่บันทึกได้', () => {
  const { blocking, warnings } = specIssues({ char_type: 'variable', lsl: 5, usl: 5 });
  expect(blocking).toBeNull();
  expect(warnings).toHaveLength(1);
});

// แบบที่พิกัดเป็นทิศเดียวกันทำให้ค่ากลางอยู่นอกช่วงเสมอโดยโครงสร้าง ไม่ใช่ความผิดพลาด
// (0.24 -0.01 -0.02 → 0.22 ~ 0.23 โดยค่ากลาง 0.24 อยู่เหนือ USL) — เตือนทุกใบคือสอนให้คนเลิกอ่าน
test('Target นอกช่วง LSL~USL ต้องไม่เตือน (งานเพลา/รูเขียนแบบนี้เป็นปกติ)', () => {
  const tol = limitsFromTolerance({ nominal: '0.24', tolUpper: '-0.01', tolLower: '-0.02' });
  expect(tol).toEqual({ lsl: '0.22', target: '0.24', usl: '0.23' });
  expect(specIssues({ char_type: 'variable', ...tol })).toEqual({ blocking: null, warnings: [] });

  expect(specIssues({ char_type: 'variable', lsl: 1, usl: 2, target: 5 }).warnings).toEqual([]);
  expect(specIssues({ char_type: 'variable', lsl: 1, usl: 2, target: 0 }).warnings).toEqual([]);
});

// นี่คือเคสที่สำคัญที่สุดของชุดนี้ — สเปกด้านเดียวเป็นรูปที่ระบบรองรับ ไม่ใช่การกรอกไม่ครบ
test('สเปกด้านเดียว (มีแค่ USL หรือแค่ LSL) ต้องเงียบสนิท', () => {
  expect(specIssues({ char_type: 'variable', usl: 9 })).toEqual({ blocking: null, warnings: [] });
  expect(specIssues({ char_type: 'variable', lsl: 1 })).toEqual({ blocking: null, warnings: [] });
  expect(specIssues({ char_type: 'variable', lsl: '', usl: '', target: '' }))
    .toEqual({ blocking: null, warnings: [] });
});

test('จุด attribute ไม่มีค่าตัวเลข ต้องไม่เตือนอะไรเลยแม้ค่าที่ค้างอยู่จะกลับหัว', () => {
  expect(specIssues({ char_type: 'attribute', lsl: 10, usl: 9 }))
    .toEqual({ blocking: null, warnings: [] });
});

test('ค่าที่มาจาก <Form.Control> เป็น string ต้องเทียบแบบตัวเลข ไม่ใช่ตัวอักษร', () => {
  // '9' > '10' เป็นจริงถ้าเทียบเป็น string — บั๊กตัวเดียวกับที่ normalize.js มีไว้กัน
  expect(specIssues({ char_type: 'variable', lsl: '9', usl: '10' }).blocking).toBeNull();
  expect(specIssues({ char_type: 'variable', lsl: '10', usl: '9' }).blocking).not.toBeNull();
});

test('เรียกแบบไม่ส่งอะไรเลยก็ไม่ throw', () => {
  expect(() => specIssues()).not.toThrow();
});

// ── จำวิธีวัด ──────────────────────────────────────────────────────────────

test('ยังไม่เคยจำอะไร → คืนค่าว่าง ไม่ใช่ undefined', () => {
  expect(readCpMemory()).toEqual({ gauge: '', unit: '', sampleSize: 1, gauges: [] });
});

test('จำแล้วอ่านกลับได้ และเครื่องมือวัดล่าสุดอยู่หน้าสุดของลิสต์', () => {
  rememberCp({ gauge: 'Micrometer', unit: 'mm', sample_size: 3 });
  rememberCp({ gauge: 'Caliper', unit: 'mm', sample_size: 5 });

  const mem = readCpMemory();
  expect(mem.gauge).toBe('Caliper');
  expect(mem.sampleSize).toBe(5);
  expect(mem.gauges).toEqual(['Caliper', 'Micrometer']);
});

test('จำเครื่องมือเดิมซ้ำไม่ทำให้ลิสต์ยาวขึ้น', () => {
  rememberCp({ gauge: 'Micrometer', sample_size: 1 });
  rememberCp({ gauge: 'Caliper', sample_size: 1 });
  rememberCp({ gauge: 'micrometer', sample_size: 1 });
  expect(readCpMemory().gauges).toEqual(['micrometer', 'Caliper']);
});

test('เครื่องมือวัดที่เว้นว่างไม่ถูกเก็บเข้าลิสต์', () => {
  rememberCp({ gauge: 'Micrometer', sample_size: 1 });
  rememberCp({ gauge: '   ', sample_size: 1 });
  expect(readCpMemory().gauges).toEqual(['Micrometer']);
});

// sample_size มี CHECK (1..10) ที่ฝั่ง DB — ค่านอกช่วงต้องไม่ถูกเติมกลับลงฟอร์ม
test('sampleSize นอกช่วง 1-10 ถูกดึงกลับเป็น 1', () => {
  rememberCp({ gauge: 'X', sample_size: 99 });
  expect(readCpMemory().sampleSize).toBe(1);
  localStorage.setItem('spc.cpMaster', JSON.stringify({ sampleSize: 0 }));
  expect(readCpMemory().sampleSize).toBe(1);
});

test('ข้อมูลใน localStorage เสีย → ไม่ throw คืนค่าว่างแทน', () => {
  localStorage.setItem('spc.cpMaster', '{ไม่ใช่ JSON');
  expect(() => readCpMemory()).not.toThrow();
  expect(readCpMemory().gauge).toBe('');
});

test('อ่าน localStorage ไม่ได้เลย (โหมด private) → ไม่ throw', () => {
  const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  expect(() => readCpMemory()).not.toThrow();
  expect(readCpMemory().gauges).toEqual([]);
  spy.mockRestore();
});

test('เขียนไม่ได้ (โควตาเต็ม) → กลืนไว้ ไม่ทำให้หน้าจอพัง', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  expect(() => rememberCp({ gauge: 'X', sample_size: 1 })).not.toThrow();
  spy.mockRestore();
});

test('clearCpMemory ลบของที่จำไว้', () => {
  rememberCp({ gauge: 'Micrometer', sample_size: 2 });
  clearCpMemory();
  expect(readCpMemory().gauge).toBe('');
});

// ── ค่ากลาง + พิกัด ────────────────────────────────────────────────────────
//
// กฎเดียวที่ต้องจำ: เครื่องหมายที่พิมพ์มาชนะเสมอ ไม่พิมพ์ถึงจะเดาให้
// และเดาคนละทางตามช่อง (บน = ขึ้น · ล่าง = ลง)

test('ไม่ใส่เครื่องหมาย — ช่องบนคือขึ้น ช่องล่างคือลง', () => {
  expect(limitsFromTolerance({ nominal: '1.23', tolUpper: '0.5', tolLower: '0.6' }))
    .toEqual({ lsl: '0.63', target: '1.23', usl: '1.73' });
});

test('ใส่เครื่องหมายเองได้ผลเท่ากันถ้าทิศทางเดียวกัน', () => {
  expect(limitsFromTolerance({ nominal: '1.23', tolUpper: '+0.5', tolLower: '-0.6' }))
    .toEqual({ lsl: '0.63', target: '1.23', usl: '1.73' });
});

// งานเพลา/เฟือง เขียนแบบนี้ทั้งนั้น — ลิมิตทั้งสองด้านอยู่ใต้ค่ากลาง
test('ลบทั้งคู่ = ต่ำกว่าค่ากลางทั้งคู่', () => {
  expect(limitsFromTolerance({ nominal: '10', tolUpper: '-0.005', tolLower: '-0.015' }))
    .toEqual({ lsl: '9.985', target: '10', usl: '9.995' });
});

// ถ้าใครเปลี่ยนช่องพิกัดกลับไปเป็น type="number" เคสนี้จะพัง — พิมพ์ + ไม่ได้อีก
test('+ ในช่องล่างต้องเคารพ ลิมิตทั้งคู่อยู่เหนือค่ากลางได้', () => {
  expect(limitsFromTolerance({ nominal: '10', tolUpper: '+0.015', tolLower: '+0.005' }))
    .toEqual({ lsl: '10.005', target: '10', usl: '10.015' });
});

test('พิกัดว่างด้านไหน ลิมิตด้านนั้นว่าง (คุมด้านเดียว)', () => {
  expect(limitsFromTolerance({ nominal: '1.23', tolUpper: '0.05', tolLower: '' }))
    .toEqual({ lsl: '', target: '1.23', usl: '1.28' });
  expect(limitsFromTolerance({ nominal: '1.23', tolUpper: '', tolLower: '0.05' }))
    .toEqual({ lsl: '1.18', target: '1.23', usl: '' });
});

test('ค่ากลางยังพิมพ์ไม่เสร็จ → คืนว่างทั้งชุด ไม่ throw', () => {
  for (const nominal of ['', '-', 'abc', null, undefined]) {
    expect(limitsFromTolerance({ nominal, tolUpper: '0.5', tolLower: '0.6' }))
      .toEqual({ lsl: '', target: '', usl: '' });
  }
});

test('พิกัดที่ยังพิมพ์ค้าง ("-") ถือว่ายังไม่ได้กรอก', () => {
  expect(limitsFromTolerance({ nominal: '1.23', tolUpper: '-', tolLower: '0.6' }))
    .toEqual({ lsl: '0.63', target: '1.23', usl: '' });
});

// 1.23 + 0.5 ใน JS ได้ 1.7300000000000002 — หลุดลงฟอร์มเมื่อไหร่คนเห็นทันทีว่าเลขประหลาด
test('ปัด 4 ตำแหน่งและตัดศูนย์ท้าย ไม่มี float noise หลุดออกมา', () => {
  const r = limitsFromTolerance({ nominal: '1.23', tolUpper: '0.5', tolLower: '0.6' });
  expect(r.usl).toBe('1.73');
  expect(r.lsl).toBe('0.63');
  expect(limitsFromTolerance({ nominal: '2', tolUpper: '0.0000001', tolLower: '0.004' }).usl)
    .toBe('2');
});

// ก๊อปมาจากไฟล์แบบแล้วได้ขีดยาวติดมา — Number() มองเป็น NaN ถ้าไม่แปลงก่อน
test('ขีดยาว (−) ใช้แทนเครื่องหมายลบได้', () => {
  expect(limitsFromTolerance({ nominal: '1.23', tolUpper: '\u22120.5', tolLower: '\u22120.6' }))
    .toEqual({ lsl: '0.63', target: '1.23', usl: '0.73' });
});

test('ตัวกลับคืนพิกัดพร้อมเครื่องหมายเสมอ', () => {
  expect(toleranceFromLimits({ lsl: 0.63, target: 1.23, usl: 1.73 }))
    .toEqual({ nominal: '1.23', tolUpper: '+0.5', tolLower: '-0.6' });
});

test('ตัวกลับ: ไม่มี target แต่มีลิมิตสองด้าน → ใช้กึ่งกลาง', () => {
  expect(toleranceFromLimits({ lsl: 9.9, target: null, usl: 10.1 }))
    .toEqual({ nominal: '10', tolUpper: '+0.1', tolLower: '-0.1' });
});

// เดาค่ากลางผิด = เขียน target ที่ไม่เคยมีลง DB เงียบ ๆ
test('ตัวกลับ: ด้านเดียวและไม่มี target → คืนว่าง ไม่เดาค่ากลางให้', () => {
  expect(toleranceFromLimits({ lsl: null, target: null, usl: 1.6 }))
    .toEqual({ nominal: '', tolUpper: '', tolLower: '' });
});

test('พิกัดศูนย์ไม่ใส่เครื่องหมาย และพิมพ์กลับเข้าไปแล้วได้ค่าเดิม', () => {
  const tol = toleranceFromLimits({ lsl: 9.985, target: 10, usl: 10 });
  expect(tol).toEqual({ nominal: '10', tolUpper: '0', tolLower: '-0.015' });
  expect(limitsFromTolerance(tol)).toEqual({ lsl: '9.985', target: '10', usl: '10' });
});

// วนกลับไปกลับมาแล้วเลขต้องไม่ขยับ ไม่งั้นแค่สลับโหมดดูเฉย ๆ ก็แก้สเปกของจุดตรวจไปแล้ว
test('round-trip limits → พิกัด → limits ได้ค่าเดิมเป๊ะ', () => {
  const cases = [
    { lsl: 0.63, target: 1.23, usl: 1.73 },
    { lsl: 9.985, target: 10, usl: 9.995 },
    { lsl: 10.005, target: 10, usl: 10.015 },
    { lsl: 1.996, target: 2, usl: 2.004 },
    { lsl: 9.9, target: null, usl: 10.1 },
  ];
  for (const c of cases) {
    const back = limitsFromTolerance(toleranceFromLimits(c));
    expect(Number(back.lsl)).toBeCloseTo(c.lsl, 4);
    expect(Number(back.usl)).toBeCloseTo(c.usl, 4);
  }
});

test('เรียกแบบไม่ส่ง argument ไม่ throw', () => {
  expect(() => limitsFromTolerance()).not.toThrow();
  expect(() => toleranceFromLimits()).not.toThrow();
});
