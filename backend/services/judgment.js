// backend/services/judgment.js — นิยามเดียวของกฎตัดสิน OK/NG ในระบบนี้
//
// ⚠️ ฝั่ง client แสดงผลทันทีที่พิมพ์ได้ แต่ถือเป็น advisory เท่านั้น
//    ค่าที่ลงฐานข้อมูลคือค่าที่คำนวณจากไฟล์นี้เสมอ ไม่ใช่ค่าที่ client ส่งมา
//    ถ้ามีสูตรตัดสินสองที่ วันหนึ่งมันจะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก
//
// pure ทั้งไฟล์ ไม่แตะ DB
'use strict';

const { toNum } = require('./spcStats');
const { MIN_N, MAX_N } = require('./spcConstants');

// judge(value, usl, lsl) → 'OK' | 'NG'
//
// นอกสเปก = NG · ไม่ได้ตั้งลิมิตด้านไหนก็ไม่ตัดสินด้านนั้น (สเปกด้านเดียวมีจริงในงาน)
// ไม่มีลิมิตเลย = OK เสมอ (เก็บค่าไว้ดูแนวโน้ม ยังไม่ตัดสิน)
//
// ⚠️ ค่าที่เข้ามาต้องผ่าน toNum ก่อน — ระบบเดิมเทียบ string ตรง ๆ ทำให้ "9.5000" > "10.0000"
//    เป็นจริง แล้วชิ้นงานที่อยู่ในสเปกถูกตีเป็น NG (36 จาก 46 แถวตอนตรวจเจอ)
const judge = (value, usl, lsl) => {
  const v = toNum(value);
  if (v === null) return 'NA';
  const U = toNum(usl);
  const L = toNum(lsl);
  if (U !== null && v > U) return 'NG';
  if (L !== null && v < L) return 'NG';
  return 'OK';
};

// evaluateCheckpoint(checkpoint, submitted) → [{ piece_no, value, judgment, ... }]
//
// checkpoint = แถวจากตาราง checkpoints (usl/lsl/sample_size/char_type)
// submitted  = { pieces: [{ piece_no, value }] }  หรือ  { judgment: 'OK'|'NG' } สำหรับ attribute
//
// คืนบรรทัดที่พร้อม INSERT ลง inspection_results พร้อม snapshot ลิมิตที่ใช้ตัดสิน
const evaluateCheckpoint = (checkpoint, submitted) => {
  const n = Number(checkpoint.sample_size) || 1;
  const usl = toNum(checkpoint.usl);
  const lsl = toNum(checkpoint.lsl);

  if (checkpoint.char_type === 'attribute') {
    // จุดตรวจด้วยตา ไม่มีตัวเลข — operator กดเอง ค่านั้นคือหลักฐาน
    const j = submitted?.judgment === 'NG' ? 'NG' : 'OK';
    return [{
      piece_no: 1,
      value: null,
      judgment: j,
      ng_reason: j === 'NG' ? (submitted?.ng_reason ?? null) : null,
      usl_used: null,
      lsl_used: null,
      n_used: 1,
    }];
  }

  const pieces = Array.isArray(submitted?.pieces) ? submitted.pieces : [];
  return pieces.map((p, i) => {
    const value = toNum(p.value);
    const j = judge(value, usl, lsl);
    return {
      piece_no: Number(p.piece_no) || i + 1,
      value,
      judgment: j,
      ng_reason: j === 'NG' ? (p.ng_reason ?? null) : null,
      // snapshot: แก้สเปกทีหลังแล้วผลตัดสินของใบเก่าต้องไม่เปลี่ยนตาม
      usl_used: usl,
      lsl_used: lsl,
      n_used: n,
    };
  });
};

// summarize(lines) → 'OK' | 'NG'   — NG แม้จุดเดียว = ทั้งใบ NG
const summarize = (lines) => (lines.some((l) => l.judgment === 'NG') ? 'NG' : 'OK');

// validateSubmission(checkpoint, submitted) → string | null (ข้อความ error ถ้าไม่ผ่าน)
//
// ⚠️ ตรวจแบบ coerce ไม่ใช่เช็ค typeof — ค่าจาก <Form.Control> มาเป็น string เสมอ
//    ถ้าเปลี่ยนเป็น typecheck จะบันทึกข้อมูลไม่ได้ทั้งระบบ
const validateSubmission = (checkpoint, submitted) => {
  const name = checkpoint.name ?? `checkpoint ${checkpoint.id}`;

  if (checkpoint.char_type === 'attribute') {
    if (submitted?.judgment !== 'OK' && submitted?.judgment !== 'NG') {
      return `จุดตรวจ "${name}" ต้องเลือก OK หรือ NG`;
    }
    return null;
  }

  const n = Number(checkpoint.sample_size) || 1;
  if (!Number.isInteger(n) || n < 1 || (n > 1 && (n < MIN_N || n > MAX_N))) {
    return `จุดตรวจ "${name}" ตั้ง sample_size = ${checkpoint.sample_size} ซึ่งอยู่นอกช่วงที่รองรับ (1 หรือ ${MIN_N}-${MAX_N})`;
  }

  const pieces = Array.isArray(submitted?.pieces) ? submitted.pieces : [];
  if (pieces.length !== n) {
    return `จุดตรวจ "${name}" ต้องกรอกครบ ${n} ชิ้น (ได้รับ ${pieces.length})`;
  }

  for (const p of pieces) {
    if (toNum(p.value) === null) {
      return `จุดตรวจ "${name}" ชิ้นที่ ${p.piece_no ?? '?'} ยังไม่ได้กรอกค่า หรือกรอกไม่ใช่ตัวเลข`;
    }
  }

  const seen = new Set(pieces.map((p) => Number(p.piece_no)));
  if (seen.size !== pieces.length) return `จุดตรวจ "${name}" มีเลขชิ้นซ้ำกัน`;

  return null;
};

// รหัสกะที่ระบบรับ — ⚠️ ต้องตรงกับ ENUM ของ inspections.shift ใน schema.sql
// และกับ SHIFTS ใน frontend/src/utils/config.js · แก้ที่ไหนต้องแก้ครบทั้งสามที่
//
// ⚠️ เดิมมีแค่ M/N แล้วมี shiftFromDate() เดากะจากนาฬิกาให้เมื่อ client ไม่ส่งมา
//    ถอดออกแล้วโดยตั้งใจ — พอมี 6 กะ การเดาจากเวลาเป็นไปไม่ได้อีกต่อไป (10 โมงเป็นได้ทั้ง
//    M และ A) เดาต่อไปคือแปะกะผิดลงหลักฐานการตรวจเงียบ ๆ · ไม่ส่งกะมา = ปฏิเสธไปเลย
const SHIFT_CODES = ['M', 'N', 'A', 'B', 'C', 'D'];

const isShift = (v) => SHIFT_CODES.includes(v);

module.exports = { judge, evaluateCheckpoint, summarize, validateSubmission, SHIFT_CODES, isShift };
