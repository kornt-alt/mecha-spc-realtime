// backend/services/spcConstants.js — ตารางค่าคงที่ของ control chart ตัวเดียวในระบบ
//
// ⚠️ ผิดช่องเดียว = กราฟทุกจุดทุกหน้าเพี้ยนแบบเงียบ ๆ ไม่มี error ให้เห็น
//    ห้ามแก้ตัวเลขในนี้โดยไม่เทียบกับแหล่งอ้างอิงที่ตีพิมพ์
//
// แหล่งอ้างอิง: Montgomery, "Introduction to Statistical Quality Control", Appendix VI
//              (ค่าชุดเดียวกับ ASTM E2587 และ NIST/SEMATECH e-Handbook หัวข้อ X-bar and R chart)
//
// ตัวเลขชุดนี้มีความสัมพันธ์กันเองอยู่ ซึ่ง __tests__/spcConstants.test.js ตรวจซ้ำให้ทุกครั้ง:
//   A2 = 3 / (d2 * sqrt(n))
//   D4 = 1 + 3 * d3 / d2
//   D3 = 1 - 3 * d3 / d2   (ติดลบเมื่อไหร่ให้เป็น 0 — เกิดกับ n <= 6)
// ถ้าเผลอพิมพ์ผิดช่องใดช่องหนึ่ง เทสจะจับได้จากความสัมพันธ์นี้ ไม่ต้องรอให้กราฟเพี้ยน
'use strict';

// n = ขนาด subgroup · เก็บถึง 10 เท่านั้น (checkpoints.sample_size มี CHECK บังคับช่วงนี้ไว้แล้ว)
const CONSTANTS = {
  2:  { d2: 1.128, d3: 0.853, A2: 1.880, D3: 0,     D4: 3.267 },
  3:  { d2: 1.693, d3: 0.888, A2: 1.023, D3: 0,     D4: 2.574 },
  4:  { d2: 2.059, d3: 0.880, A2: 0.729, D3: 0,     D4: 2.282 },
  5:  { d2: 2.326, d3: 0.864, A2: 0.577, D3: 0,     D4: 2.114 },
  6:  { d2: 2.534, d3: 0.848, A2: 0.483, D3: 0,     D4: 2.004 },
  7:  { d2: 2.704, d3: 0.833, A2: 0.419, D3: 0.076, D4: 1.924 },
  8:  { d2: 2.847, d3: 0.820, A2: 0.373, D3: 0.136, D4: 1.864 },
  9:  { d2: 2.970, d3: 0.808, A2: 0.337, D3: 0.184, D4: 1.816 },
  10: { d2: 3.078, d3: 0.797, A2: 0.308, D3: 0.223, D4: 1.777 },
};

const MIN_N = 2;
const MAX_N = 10;

// ค่าสำหรับ I-MR (n = 1) — moving range ใช้ค่าคู่ติดกันจึงอ้างตาราง n = 2
//   E2 = 3 / d2(2) = 3 / 1.128 = 2.660
// UCL/LCL ของกราฟ Individual = xbar ± E2 * MRbar
// UCL ของกราฟ MR = D4(2) * MRbar = 3.267 * MRbar (LCL = 0 เสมอ)
const IMR = {
  E2: 2.660,
  d2: CONSTANTS[2].d2,
  D3: CONSTANTS[2].D3,
  D4: CONSTANTS[2].D4,
};

// getConstants(n) — โยน error เมื่อ n อยู่นอกตาราง ดีกว่าคืน undefined แล้วได้ NaN ไปทั้งกราฟ
const getConstants = (n) => {
  const row = CONSTANTS[n];
  if (!row) {
    throw new Error(`ไม่มีค่าคงที่ control chart สำหรับ subgroup size = ${n} (รองรับ ${MIN_N}-${MAX_N})`);
  }
  return row;
};

module.exports = { CONSTANTS, IMR, MIN_N, MAX_N, getConstants };
