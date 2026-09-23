// เทส backend/services/judgment.js เฉพาะส่วนรหัสกะ
//
// ⚠️ รหัสกะถูกเขียนไว้ 3 ที่ที่ต้องตรงกัน — SHIFT_CODES ที่นี่ · ENUM ของ inspections.shift
//    ใน db/schema.sql · SHIFTS ใน frontend/src/utils/config.js
//    หลุดจากกันเมื่อไหร่ = เลือกกะได้บนหน้าจอแต่บันทึกไม่ผ่าน เทสนี้จับสองที่แรกให้
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { SHIFT_CODES, isShift } = require('../judgment');

test('isShift รับเฉพาะรหัสที่อยู่ใน SHIFT_CODES', () => {
  for (const code of SHIFT_CODES) assert.strictEqual(isShift(code), true);
  for (const bad of ['X', 'm', '', null, undefined, 'MN', 1]) {
    assert.strictEqual(isShift(bad), false, `${bad} ไม่ควรผ่าน`);
  }
});

test('SHIFT_CODES ตรงกับ ENUM ของ inspections.shift ใน schema.sql', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

  // ดึงทุกที่ที่นิยาม ENUM ของคอลัมน์ shift (ทั้งใน CREATE TABLE และใน ALTER ท้ายไฟล์)
  const found = [...sql.matchAll(/shift\s+ENUM\(([^)]+)\)/gi)]
    .map((m) => m[1].split(',').map((v) => v.trim().replace(/'/g, '')));

  assert.ok(found.length >= 2, 'ต้องมีทั้งใน CREATE TABLE และ ALTER ที่ท้ายไฟล์');
  for (const codes of found) {
    assert.deepStrictEqual(codes, SHIFT_CODES);
  }
});
