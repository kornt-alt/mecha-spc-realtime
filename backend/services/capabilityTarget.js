// backend/services/capabilityTarget.js — เลือกเกณฑ์ Cp/Cpk ขั้นต่ำของจุดตรวจ (pure ไม่แตะ DB)
//
// ลูกค้าแต่ละรายกำหนดเกณฑ์ไม่เท่ากัน และจุด CTF (checkpoints.is_critical) มักถูกกำหนดสูงกว่า
// จุดทั่วไป จึงมี 2 ชุด (general / ctf) และแต่ละค่าเลือกตามลำดับ:
//
//   models.min_*  (override ราย item)  ??  customers.min_*  ??  DEFAULT_MIN (ค่าระบบ)
//
// ⚠️ เลือกที่นี่ที่เดียว แล้วส่งไปกับผลกราฟ (capabilityTarget) — ฝั่ง client ห้ามมีลำดับ fallback
//    ของตัวเอง และห้าม hardcode 1.33 กลับเข้าไปใน component (ของเดิมมีสองที่แล้วต้องตามแก้ทั้งคู่)
// ⚠️ เป็นเกณฑ์สำหรับ "แสดงผล" ไม่ได้ตัดสิน OK/NG ของใบตรวจ (อันนั้นคือ spec limit ที่ judgment.js)
'use strict';

// พฤติกรรมเดิมก่อนมีตารางลูกค้า — item ที่ยังไม่ผูกลูกค้าจึงได้สีแบบที่เคยเห็นเป๊ะ
const DEFAULT_MIN = 1.33;

// decimal จาก mysql2 มาเป็น string ("1.6700") — แปลงที่นี่ ไม่ปล่อยให้ string หลุดไปถึง client
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ค่าเดียว: override ของ item ก่อน ไม่มีค่อยใช้ของลูกค้า ไม่มีทั้งคู่ใช้ค่าระบบ
const pick = (own, customer, hasCustomer) => {
  const o = num(own);
  if (o !== null) return { value: o, source: 'item' };
  const c = hasCustomer ? num(customer) : null;
  if (c !== null) return { value: c, source: 'customer' };
  return { value: DEFAULT_MIN, source: 'default' };
};

// source ของชุด = ที่มาที่ "เฉพาะเจาะจงที่สุด" ในสองค่า (item > customer > default)
// หน้าจอใช้บอกคนอ่านว่าเลขนี้มาจากไหน ไม่ได้ใช้ตัดสินอะไร
const RANK = { item: 2, customer: 1, default: 0 };
const pair = (cp, cpk) => ({
  minCp: cp.value,
  minCpk: cpk.value,
  source: RANK[cp.source] >= RANK[cpk.source] ? cp.source : cpk.source,
});

// resolveTargets(row) — row = แถว models ที่ LEFT JOIN customers มาแล้ว
//   ต้องมี: min_cp, min_cpk, min_cp_ctf, min_cpk_ctf (ของ item)
//           customer_id, customer_name, cust_min_cp, cust_min_cpk, cust_min_cp_ctf, cust_min_cpk_ctf
const resolveTargets = (row = {}) => {
  const r = row ?? {};
  // customer_id มีแต่ join ไม่เจอ (ไม่ควรเกิดเพราะ FK) ถือว่าไม่มีลูกค้า
  const hasCustomer = r.customer_id !== null && r.customer_id !== undefined && r.customer_name != null;
  return {
    customerId: hasCustomer ? Number(r.customer_id) : null,
    customerName: hasCustomer ? r.customer_name : null,
    general: pair(
      pick(r.min_cp, r.cust_min_cp, hasCustomer),
      pick(r.min_cpk, r.cust_min_cpk, hasCustomer),
    ),
    ctf: pair(
      pick(r.min_cp_ctf, r.cust_min_cp_ctf, hasCustomer),
      pick(r.min_cpk_ctf, r.cust_min_cpk_ctf, hasCustomer),
    ),
  };
};

// targetFor(checkpoint, targets) — ชุดที่ใช้กับจุดตรวจนี้ (null สำหรับ attribute ที่ไม่มี Cp/Cpk)
// is_critical มาจาก DB เป็น 0/1 หรือ "0"/"1" — ต้อง coerce ไม่ใช่เช็ค truthy ของ string
const targetFor = (checkpoint, targets) => {
  if (!checkpoint || checkpoint.char_type === 'attribute') return null;
  const t = targets ?? resolveTargets({});
  const critical = Boolean(Number(checkpoint.is_critical));
  return {
    ...(critical ? t.ctf : t.general),
    critical,
    customerName: t.customerName,
  };
};

module.exports = { DEFAULT_MIN, resolveTargets, targetFor };
