// backend/db/inspectionWrite.js — insert ใบตรวจ 1 ใบ (header + ผลทุกบรรทัด) ภายใน transaction ที่เปิดไว้แล้ว
//
// ใช้ร่วมกันสองที่: POST /inspections (ตรวจตามรอบ) กับ routes/checkJobs.js (Set up / Last Piece)
// ⚠️ อย่า copy โค้ดนี้ไปเขียนใหม่อีกที่ — กฎ subgroup_no / snapshot ต้องมีชุดเดียว
'use strict';

const { ROUTINE_CATEGORY } = require('./queries');

// h = { model_id, machine_id, inspector_id, mo_no, lot_no, shift, remark, overall,
//       mo_item_no, mo_item_name, mo_draw, mo_model_group,
//       category_id?, job_id?, stage? }
// linesByCheckpoint = [{ checkpoint, lines: evaluateCheckpoint(...) }]
const insertInspection = async (conn, h, linesByCheckpoint) => {
  // ⚠️ subgroup_no ให้ server แจกเองเสมอ ห้ามรับจาก client
  // สองคนตรวจ MO เดียวกันพร้อมกันแล้วเลขชน = ทุกจุดบนกราฟหลังจากนั้นผิดหมด
  // FOR UPDATE ล็อกช่วงไว้จนกว่าจะ commit · UNIQUE(model_id, mo_no, subgroup_no) เป็นตาข่ายชั้นสอง
  // ⚠️ นับรวมทุกหมวด (และใบที่ยกเลิก) โดยตั้งใจ — UNIQUE ไม่มี category_id จะใช้เลขซ้ำข้ามหมวดไม่ได้
  const [[next]] = await conn.query(
    `SELECT COALESCE(MAX(subgroup_no), 0) + 1 AS n
       FROM inspections WHERE model_id = ? AND mo_no = ? FOR UPDATE`,
    [Number(h.model_id), h.mo_no]
  );
  const subgroupNo = next.n;

  const [header] = await conn.execute(
    `INSERT INTO inspections
       (model_id, machine_id, inspector_id, mo_no, lot_no, shift, subgroup_no, remark, overall_result,
        mo_item_no, mo_item_name, mo_draw, mo_model_group, category_id, job_id, stage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(h.model_id), Number(h.machine_id), Number(h.inspector_id),
      h.mo_no, h.lot_no ?? null, h.shift, subgroupNo,
      h.remark ?? null, h.overall,
      h.mo_item_no ?? null, h.mo_item_name ?? null, h.mo_draw ?? null, h.mo_model_group ?? null,
      Number(h.category_id) || ROUTINE_CATEGORY, h.job_id ?? null, h.stage ?? null,
    ]
  );
  const inspectionId = header.insertId;

  // insert บรรทัดผลทั้งหมดในคำสั่งเดียว
  const values = [];
  const params = [];
  for (const { checkpoint, lines } of linesByCheckpoint) {
    for (const l of lines) {
      values.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
      params.push(
        inspectionId, checkpoint.id, l.piece_no, l.value,
        l.judgment, l.ng_reason, l.usl_used, l.lsl_used, l.n_used
      );
    }
  }
  await conn.query(
    `INSERT INTO inspection_results
       (inspection_id, checkpoint_id, piece_no, value, judgment, ng_reason, usl_used, lsl_used, n_used)
     VALUES ${values.join(', ')}`,
    params
  );

  return { inspectionId, subgroupNo };
};

module.exports = { insertInspection };
