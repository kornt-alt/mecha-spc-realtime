// เทส buildInspectionFilter — pure ล้วน ไม่แตะ DB
//
// สิ่งที่ล็อกไว้ที่นี่คือ default ที่พังแล้วเงียบที่สุดในระบบ:
// ถ้าใบตรวจที่ถูกยกเลิกหลุดเข้ามา กราฟกับ Cp/Cpk จะยังคำนวณรวมจุดที่คนสั่งให้ตัดทิ้งไปแล้ว
// โดยไม่มีอะไรบนหน้าจอบอกเลย
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildInspectionFilter } = require('../queries');

test('default ต้องตัดใบที่ยกเลิกทิ้งเสมอ แม้ไม่ได้ส่งตัวกรองอะไรมาเลย', () => {
  const { where, params } = buildInspectionFilter();
  assert.deepStrictEqual(where, ['i.voided_at IS NULL']);
  assert.deepStrictEqual(params, []);
});

test('includeVoided: true ต้องไม่มีเงื่อนไข voided เลย', () => {
  const { where } = buildInspectionFilter({}, { includeVoided: true });
  assert.deepStrictEqual(where, []);
});

test('เงื่อนไข voided อยู่คู่กับตัวกรองอื่นได้ครบ', () => {
  const { where, params } = buildInspectionFilter({
    from: '2026-09-01', to: '2026-09-30', mo_no: 'MO-1', shift: 'M',
    inspector_id: '5', machine_id: '7', lot_no: 'L1',
  });
  assert.ok(where.includes('i.voided_at IS NULL'));
  assert.strictEqual(where.length, 7);
  // params ต้องไม่มีของ voided ปน (มันเป็นเงื่อนไขคงที่ ไม่ใช่ placeholder)
  assert.deepStrictEqual(params, ['2026-09-01', '2026-09-30', 'MO-1', 'L1', 'M', 5, 7]);
});

test('includeVoided: true ยังกรองตัวอื่นตามปกติ', () => {
  const { where, params } = buildInspectionFilter({ mo_no: 'MO-9' }, { includeVoided: true });
  assert.deepStrictEqual(where, ['i.mo_no = ?']);
  assert.deepStrictEqual(params, ['MO-9']);
});

// พฤติกรรมเดิมที่ยังไม่มีเทสมาก่อน — ล็อกไว้กันแก้หลุด
test('วันที่กรองเมื่อครบทั้ง from และ to เท่านั้น', () => {
  assert.deepStrictEqual(buildInspectionFilter({ from: '2026-09-01' }).params, []);
  assert.deepStrictEqual(buildInspectionFilter({ to: '2026-09-30' }).params, []);
});

test('ค่าว่างคือไม่กรอง ไม่ใช่กรองด้วยค่าว่าง', () => {
  const { where } = buildInspectionFilter({ mo_no: '', shift: '', inspector_id: '', machine_id: '' });
  assert.deepStrictEqual(where, ['i.voided_at IS NULL']);
});

test('id ถูกแปลงเป็นตัวเลข ไม่ใช่ string ที่มาจาก query string', () => {
  const { params } = buildInspectionFilter({ inspector_id: '5', machine_id: '7' });
  assert.deepStrictEqual(params, [5, 7]);
});
