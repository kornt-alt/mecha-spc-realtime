// backend/routes/inspections.js — บันทึกและอ่านใบตรวจ
'use strict';

const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { fetchModelCheckpoints } = require('../db/queries');
const { evaluateCheckpoint, summarize, validateSubmission, shiftFromDate } = require('../services/judgment');
const { AppError, wrap } = require('../middleware/errorHandler');

const router = express.Router();

const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));

// ── บันทึกใบตรวจ — 1 request 1 transaction ────────────────────────────────
//
// ระบบเดิมยิง 1 POST ต่อ 1 spec ผ่าน Promise.all แล้วแต่ละครั้ง query ประวัติทั้งหมดมา broadcast
// ใบเช็คชีต 10 จุด × 5 ชิ้น = 50 POST / 50 full-history query / 50 broadcast
// ตรงนี้คือเหตุผลหลักที่คุ้มจะ rewrite — ทั้งใบต้องลงในคำขอเดียวและ atomic
//
// payload:
// {
//   model_id, machine_id, inspector_id, mo_no, lot_no?, shift?, remark?,
//   results: [
//     { checkpoint_id, pieces: [{ piece_no, value }] },   // variable
//     { checkpoint_id, judgment: 'OK'|'NG', ng_reason? }  // attribute
//   ]
// }
router.post('/', wrap(async (req, res) => {
  const b = req.body ?? {};

  for (const [key, label] of [['model_id', 'รุ่น'], ['machine_id', 'เครื่อง'], ['inspector_id', 'ผู้ตรวจ']]) {
    if (!isIntLike(b[key])) throw new AppError(`ยังไม่ได้เลือก${label}`, 400);
  }
  const moNo = String(b.mo_no ?? '').trim();
  if (!moNo) throw new AppError('ยังไม่ได้กรอก MO No.', 400);

  const shift = b.shift === 'M' || b.shift === 'N' ? b.shift : shiftFromDate();
  const submitted = Array.isArray(b.results) ? b.results : [];
  if (submitted.length === 0) throw new AppError('ยังไม่ได้กรอกผลตรวจสักจุด', 400);

  const checkpoints = await fetchModelCheckpoints(b.model_id);
  if (checkpoints.length === 0) throw new AppError('รุ่นนี้ยังไม่ได้ตั้งจุดตรวจไว้', 400);

  const byId = new Map(checkpoints.map((c) => [c.id, c]));
  const submittedById = new Map();
  for (const item of submitted) {
    const cp = byId.get(Number(item.checkpoint_id));
    if (!cp) throw new AppError(`จุดตรวจ id=${item.checkpoint_id} ไม่ได้อยู่ในรุ่นนี้`, 400);
    if (submittedById.has(cp.id)) throw new AppError(`ส่งจุดตรวจ "${cp.name}" ซ้ำ`, 400);
    submittedById.set(cp.id, item);
  }

  // ทุกจุดที่ active ต้องมีผล — ใบตรวจที่กรอกไม่ครบใช้เป็นหลักฐานไม่ได้
  const missing = checkpoints.filter((c) => !submittedById.has(c.id));
  if (missing.length > 0) {
    throw new AppError(`ยังไม่ได้กรอก: ${missing.map((c) => c.name).join(', ')}`, 400);
  }

  // ตรวจความถูกต้องให้ครบก่อน แล้วค่อยเปิด transaction — จะได้ไม่ถือ connection ไว้เปล่า ๆ
  for (const cp of checkpoints) {
    const err = validateSubmission(cp, submittedById.get(cp.id));
    if (err) throw new AppError(err, 400);
  }

  // server เป็นคนตัดสิน OK/NG ไม่ใช่ค่าที่ client ส่งมา (ยกเว้น attribute ที่คนกดเอง)
  const linesByCheckpoint = checkpoints.map((cp) => ({
    checkpoint: cp,
    lines: evaluateCheckpoint(cp, submittedById.get(cp.id)),
  }));
  const allLines = linesByCheckpoint.flatMap((x) => x.lines);
  const overall = summarize(allLines);

  const saved = await withTransaction(async (conn) => {
    // ⚠️ subgroup_no ให้ server แจกเองเสมอ ห้ามรับจาก client
    // สองคนตรวจ MO เดียวกันพร้อมกันแล้วเลขชน = ทุกจุดบนกราฟหลังจากนั้นผิดหมด
    // FOR UPDATE ล็อกช่วงไว้จนกว่าจะ commit · UNIQUE(model_id, mo_no, subgroup_no) เป็นตาข่ายชั้นสอง
    const [[next]] = await conn.query(
      `SELECT COALESCE(MAX(subgroup_no), 0) + 1 AS n
         FROM inspections WHERE model_id = ? AND mo_no = ? FOR UPDATE`,
      [Number(b.model_id), moNo]
    );
    const subgroupNo = next.n;

    const [header] = await conn.execute(
      `INSERT INTO inspections
         (model_id, machine_id, inspector_id, mo_no, lot_no, shift, subgroup_no, remark, overall_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(b.model_id), Number(b.machine_id), Number(b.inspector_id),
        moNo, b.lot_no ? String(b.lot_no).trim() : null, shift, subgroupNo,
        b.remark ? String(b.remark).trim() : null, overall,
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
  });

  // ── แจ้ง client ที่กำลังดูรุ่นนี้อยู่ ───────────────────────────────────
  //
  // ส่งเข้า room ของรุ่นเท่านั้น ไม่ broadcast ทั้งระบบ และส่งแค่ "สรุปว่าอะไรเปลี่ยน"
  // ไม่ใช่ประวัติทั้งก้อนแบบเดิม — client เอา checkpointIds ไปโหลดเฉพาะกราฟที่กระทบ
  req.app.get('io')?.to(`model:${Number(b.model_id)}`).emit('inspection_saved', {
    inspectionId: saved.inspectionId,
    modelId: Number(b.model_id),
    subgroupNo: saved.subgroupNo,
    moNo,
    shift,
    overallResult: overall,
    checkpointIds: checkpoints.map((c) => c.id),
    ngCheckpointIds: linesByCheckpoint
      .filter((x) => x.lines.some((l) => l.judgment === 'NG'))
      .map((x) => x.checkpoint.id),
  });

  res.json({
    success: true,
    id: saved.inspectionId,
    subgroup_no: saved.subgroupNo,
    shift,
    overall_result: overall,
    results: linesByCheckpoint.map((x) => ({
      checkpoint_id: x.checkpoint.id,
      name: x.checkpoint.name,
      judgment: summarize(x.lines),
      pieces: x.lines.map((l) => ({ piece_no: l.piece_no, value: l.value, judgment: l.judgment })),
    })),
  });
}));

// ── อ่าน ──────────────────────────────────────────────────────────────────

// รายการใบตรวจล่าสุด — ตาราง log ใต้ใบตรวจใช้เส้นนี้
router.get('/', wrap(async (req, res) => {
  const { model_id: modelId, mo_no: moNo, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const where = [];
  const params = [];
  if (modelId) { where.push('i.model_id = ?'); params.push(Number(modelId)); }
  if (moNo) { where.push('i.mo_no = ?'); params.push(String(moNo)); }
  // กรองวันที่เมื่อครบทั้งคู่เท่านั้น — ต้องตรงกับเงื่อนไขฝั่ง client เป๊ะ
  if (from && to) { where.push('DATE(i.inspected_at) BETWEEN ? AND ?'); params.push(from, to); }

  const [rows] = await query(
    `SELECT i.*, m.model_code, m.model_name, mc.code AS machine_code, mc.name AS machine_name,
            ins.name AS inspector_name,
            (SELECT COUNT(*) FROM inspection_results r
              WHERE r.inspection_id = i.id AND r.judgment = 'NG') AS ng_count
       FROM inspections i
       JOIN models m      ON m.id   = i.model_id
       JOIN machines mc   ON mc.id  = i.machine_id
       JOIN inspectors ins ON ins.id = i.inspector_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY i.inspected_at DESC, i.id DESC
      LIMIT ${limit}`,
    params
  );
  res.json(rows);
}));

// ใบตรวจใบเดียวพร้อมผลทุกบรรทัด
router.get('/:id', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const id = Number(req.params.id);

  const [[inspection]] = await query(
    `SELECT i.*, m.model_code, m.model_name, mc.name AS machine_name, ins.name AS inspector_name
       FROM inspections i
       JOIN models m      ON m.id   = i.model_id
       JOIN machines mc   ON mc.id  = i.machine_id
       JOIN inspectors ins ON ins.id = i.inspector_id
      WHERE i.id = ?`,
    [id]
  );
  if (!inspection) throw new AppError('ไม่พบใบตรวจนี้', 404);

  const [results] = await query(
    `SELECT r.*, c.name AS checkpoint_name, c.seq_no, c.unit, c.char_type
       FROM inspection_results r
       JOIN checkpoints c ON c.id = r.checkpoint_id
      WHERE r.inspection_id = ?
      ORDER BY c.seq_no ASC, r.piece_no ASC`,
    [id]
  );

  res.json({ inspection, results });
}));

module.exports = router;
