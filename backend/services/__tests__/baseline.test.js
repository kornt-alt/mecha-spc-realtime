// เทสส่วน pure ของ services/baseline.js — การ "เลือกชุด baseline" ที่ตรงกับเครื่องที่ดูอยู่
//
// ส่วนที่คุยกับ DB (computeBaseline / setBaseline / clearBaseline) ไม่ได้เทสที่นี่
// แต่ pickBaseline คือจุดที่ตัดสินว่ากราฟของเครื่องหนึ่งจะได้เส้นลิมิตของใคร
// ตัดสินผิดที่นี่ = เอาลิมิตของเครื่องหนึ่งไปตัดสินอีกเครื่อง โดยไม่มีอะไรบนจอบอกเลย
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { AGGREGATE, scopeOf, pickBaseline, baselineOf } = require('../baseline');

const row = (machineId, xbarbar) => ({
  checkpoint_id: 1,
  machine_id: machineId,
  xbarbar,
  rbar: '0.030000',
  n: 5,
  subgroups: 25,
  baseline_from: null,
  baseline_to: null,
  locked_at: '2026-09-01 08:00:00',
});

test('scopeOf — ไม่ได้กรองเครื่อง = ชุดรวม (0) ไม่ใช่ NaN หรือ null', () => {
  assert.strictEqual(scopeOf({}), AGGREGATE);
  assert.strictEqual(scopeOf({ machine_id: null }), AGGREGATE);
  assert.strictEqual(scopeOf({ machine_id: '' }), AGGREGATE);
  // query string ส่งมาเป็น string เสมอ ต้อง coerce ไม่ใช่เช็ค typeof
  assert.strictEqual(scopeOf({ machine_id: '11' }), 11);
  assert.strictEqual(scopeOf({ machine_id: 11 }), 11);
});

test('pickBaseline — เลือกชุดของเครื่องที่ขอ ไม่ใช่ชุดแรกที่เจอ', () => {
  const rows = [row(AGGREGATE, '10.000000'), row(11, '10.020000'), row(12, '9.980000')];

  assert.strictEqual(pickBaseline(rows, 11).xbarbar, '10.020000');
  assert.strictEqual(pickBaseline(rows, 12).xbarbar, '9.980000');
  assert.strictEqual(pickBaseline(rows, AGGREGATE).xbarbar, '10.000000');
});

test('⚠️ เครื่องที่ยังไม่ได้ล็อก ต้องได้ null ห้าม fallback ไปชุดรวม', () => {
  // ยืมลิมิตของชุดรวมมาใช้ = เครื่องที่ค่ากลางเบี่ยงจากกลุ่มจะติดกฎ Nelson ข้อ 2 ค้างตลอด
  // โดยไม่มีอะไรผิดจริง แล้วคนจะเลิกเชื่อคำเตือนทั้งหมด — ซึ่งคือปัญหาที่การแยกรายเครื่องมาแก้
  // null ทำให้กราฟคำนวณสดเป็น provisional ซึ่งอย่างน้อยก็บอกตัวเองว่ายังไม่ได้ล็อก
  const rows = [row(AGGREGATE, '10.000000')];

  assert.strictEqual(pickBaseline(rows, 11), null);
  assert.strictEqual(pickBaseline([], AGGREGATE), null);
  assert.strictEqual(pickBaseline(undefined, 11), null);
});

test('pickBaseline — ไม่ส่งขอบเขตมา = ชุดรวม (ค่าเริ่มต้นต้องไม่ใช่เครื่องแรกในลิสต์)', () => {
  const rows = [row(11, '10.020000'), row(AGGREGATE, '10.000000')];
  assert.strictEqual(pickBaseline(rows).xbarbar, '10.000000');
});

test('baselineOf — แปลงเป็นรูปที่ computeLimits รับ และคืน null เมื่อไม่มีแถว', () => {
  assert.strictEqual(baselineOf(null), null);
  assert.strictEqual(baselineOf(undefined), null);

  const b = baselineOf(row(11, '10.020000'));
  assert.strictEqual(b.xbarbar, '10.020000');
  assert.strictEqual(b.n, 5);
  assert.strictEqual(b.machineId, 11);
  assert.strictEqual(b.subgroups, 25);
});

test('baselineOf — แถวของชุดรวมต้องได้ machineId = 0 ไม่ใช่ null/undefined', () => {
  // ฝั่ง client เทียบค่านี้กับ ?machine= ที่เป็นค่าว่าง ถ้าเป็น null จะแยกไม่ออกว่า
  // "ชุดรวม" กับ "ไม่รู้ว่าชุดไหน" ต่างกันยังไง
  assert.strictEqual(baselineOf(row(0, '10.000000')).machineId, AGGREGATE);
});
