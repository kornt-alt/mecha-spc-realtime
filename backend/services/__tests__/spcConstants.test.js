// เทสตารางค่าคงที่ control chart
//
// ค่าพวกนี้พิมพ์มาจากตารางที่ตีพิมพ์ ซึ่งแปลว่าพิมพ์ผิดได้และจะไม่มีใครรู้จนกว่ากราฟจะเพี้ยน
// เทสนี้จึงไม่ได้เทียบกับตัวเลขที่พิมพ์ซ้ำอีกรอบ (ซึ่งจะผิดตามกันไป) แต่ตรวจ "ความสัมพันธ์
// ทางคณิตศาสตร์ระหว่างคอลัมน์" ที่ค่าชุดนี้ต้องเป็นจริงเสมอ — พิมพ์ผิดช่องไหนก็หลุดตรงนี้
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { CONSTANTS, IMR, getConstants } = require('../spcConstants');

// ตารางที่ตีพิมพ์ปัดเป็นทศนิยม 3 ตำแหน่ง ความคลาดเคลื่อนสะสมจึงอยู่ราว ๆ นี้
const TOL = 0.0025;

test('A2 = 3 / (d2 * sqrt(n)) ทุกแถว', () => {
  for (const [n, c] of Object.entries(CONSTANTS)) {
    const expected = 3 / (c.d2 * Math.sqrt(Number(n)));
    assert.ok(
      Math.abs(c.A2 - expected) < TOL,
      `n=${n}: A2=${c.A2} แต่ 3/(d2*sqrt(n))=${expected.toFixed(4)}`
    );
  }
});

test('D4 = 1 + 3*d3/d2 ทุกแถว', () => {
  for (const [n, c] of Object.entries(CONSTANTS)) {
    const expected = 1 + (3 * c.d3) / c.d2;
    assert.ok(
      Math.abs(c.D4 - expected) < TOL,
      `n=${n}: D4=${c.D4} แต่ 1+3*d3/d2=${expected.toFixed(4)}`
    );
  }
});

test('D3 = max(0, 1 - 3*d3/d2) ทุกแถว', () => {
  for (const [n, c] of Object.entries(CONSTANTS)) {
    const expected = Math.max(0, 1 - (3 * c.d3) / c.d2);
    assert.ok(
      Math.abs(c.D3 - expected) < TOL,
      `n=${n}: D3=${c.D3} แต่ max(0, 1-3*d3/d2)=${expected.toFixed(4)}`
    );
  }
});

test('D3 เป็น 0 เมื่อ n <= 6 และมากกว่า 0 เมื่อ n >= 7', () => {
  for (const [n, c] of Object.entries(CONSTANTS)) {
    if (Number(n) <= 6) assert.strictEqual(c.D3, 0, `n=${n} ควรเป็น 0`);
    else assert.ok(c.D3 > 0, `n=${n} ควรมากกว่า 0`);
  }
});

test('d2 เพิ่มขึ้นตาม n และ A2 ลดลงตาม n', () => {
  const ns = Object.keys(CONSTANTS).map(Number).sort((a, b) => a - b);
  for (let i = 1; i < ns.length; i += 1) {
    assert.ok(CONSTANTS[ns[i]].d2 > CONSTANTS[ns[i - 1]].d2, `d2 ต้องเพิ่มที่ n=${ns[i]}`);
    assert.ok(CONSTANTS[ns[i]].A2 < CONSTANTS[ns[i - 1]].A2, `A2 ต้องลดที่ n=${ns[i]}`);
  }
});

test('E2 ของ I-MR = 3 / d2(2)', () => {
  assert.ok(Math.abs(IMR.E2 - 3 / CONSTANTS[2].d2) < TOL);
});

test('getConstants โยน error เมื่อ n อยู่นอกตาราง (ไม่ใช่คืน undefined)', () => {
  assert.throws(() => getConstants(1), /subgroup size/);
  assert.throws(() => getConstants(11), /subgroup size/);
  assert.doesNotThrow(() => getConstants(5));
});
