// backend/routes/inspections.js — บันทึกและอ่านใบตรวจ
'use strict';

const express = require('express');
const { query, execute, withTransaction } = require('../db/pool');
const { fetchModelCheckpoints, fetchDoneCheckpointIds } = require('../db/queries');
const { evaluateCheckpoint, summarize, validateSubmission, isShift } = require('../services/judgment');
const { AppError, wrap } = require('../middleware/errorHandler');
const { requireLogin } = require('../middleware/requireLogin');

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
//   mo_item_no?, mo_item_name?, mo_draw?, mo_model_group?,   // สิ่งที่ IPBASS ตอบมา
//   results: [
//     { checkpoint_id, pieces: [{ piece_no, value }] },   // variable
//     { checkpoint_id, judgment: 'OK'|'NG', ng_reason? }  // attribute
//   ]
// }
router.post('/', wrap(async (req, res) => {
  const b = req.body ?? {};

  for (const [key, label] of [['model_id', 'item'], ['machine_id', 'เครื่อง'], ['inspector_id', 'ผู้ตรวจ']]) {
    if (!isIntLike(b[key])) throw new AppError(`ยังไม่ได้เลือก${label}`, 400);
  }
  const moNo = String(b.mo_no ?? '').trim();
  if (!moNo) throw new AppError('ยังไม่ได้กรอก MO No.', 400);

  // ⚠️ ไม่เดากะให้เมื่อ client ไม่ส่งมาอีกแล้ว — มี 6 กะ เดาจากนาฬิกาไม่ได้
  //    กะที่เดาผิดคือหลักฐานการตรวจที่ผิดโดยไม่มีอะไรทัก จึงปฏิเสธเหมือนช่องบังคับอื่น
  //    แยกสองข้อความ: ว่าง = ยังไม่ได้เลือก · มีค่าแต่ไม่ผ่าน = ลิสต์ฝั่ง client หลุดจาก ENUM
  //    (บอกค่าที่ส่งมาไปด้วย ไม่งั้นไล่หาว่าใครหลุดไม่เจอ)
  if (!b.shift) throw new AppError('ยังไม่ได้เลือกกะ', 400);
  if (!isShift(b.shift)) throw new AppError(`กะ "${b.shift}" ไม่ใช่กะที่ระบบรับ`, 400);
  const shift = b.shift;

  // ⚠️ mo_* = สิ่งที่ IPBASS MOPLAN ตอบมาสำหรับ MO ใบนี้ เก็บเป็น snapshot เฉย ๆ
  //    ไม่ validate ไม่เอาไปตัดสินอะไร และ "ไม่มี" เป็นเรื่องปกติ (IPBASS ล่ม/ยังไม่ได้ตั้ง dept)
  //    การค้นหา MO เป็น advisory ล้วน ห้ามทำให้บันทึกใบตรวจไม่ได้
  const textOrNull = (v) => {
    const t = String(v ?? '').trim();
    return t === '' ? null : t;
  };
  const moItemNo     = textOrNull(b.mo_item_no);
  const moItemName   = textOrNull(b.mo_item_name);
  const moDraw       = textOrNull(b.mo_draw);
  const moModelGroup = textOrNull(b.mo_model_group);
  const submitted = Array.isArray(b.results) ? b.results : [];
  if (submitted.length === 0) throw new AppError('ยังไม่ได้กรอกผลตรวจสักจุด', 400);

  const checkpoints = await fetchModelCheckpoints(b.model_id);
  if (checkpoints.length === 0) throw new AppError('item นี้ยังไม่ได้ตั้งจุดตรวจไว้', 400);

  const byId = new Map(checkpoints.map((c) => [c.id, c]));
  const submittedById = new Map();
  for (const item of submitted) {
    const cp = byId.get(Number(item.checkpoint_id));
    if (!cp) throw new AppError(`จุดตรวจ id=${item.checkpoint_id} ไม่ได้อยู่ใน item นี้`, 400);
    if (submittedById.has(cp.id)) throw new AppError(`ส่งจุดตรวจ "${cp.name}" ซ้ำ`, 400);
    submittedById.set(cp.id, item);
  }

  // ทุกจุดที่ "ถึงรอบ" ต้องมีผล — จุดที่ทำไปแล้วในรอบนี้ (ต่อกะ/ต่อวัน ตาม checkpoints.frequency)
  // เว้นได้ ดู fetchDoneCheckpointIds · ใบตรวจจึงมีผลแค่บางจุดได้ แต่จุดที่ถึงรอบห้ามขาด
  //
  // ⚠️ เช็คนอก transaction โดยตั้งใจ — ชุด "ทำแล้ว" โตขึ้นได้อย่างเดียวระหว่างนี้ (ยกเว้นมีคนยกเลิกใบ
  //    ในเสี้ยววินาทีเดียวกัน) สองคนบันทึกพร้อมกันแล้วต่างถูกบังคับกรอกจุดเดียวกัน = วัดเกิน ไม่ใช่ขาด
  const done = await fetchDoneCheckpointIds({ modelId: b.model_id, machineId: b.machine_id, shift });
  const missing = checkpoints.filter((c) => !done.has(c.id) && !submittedById.has(c.id));
  if (missing.length > 0) {
    throw new AppError(`ยังไม่ได้กรอก (ถึงรอบตรวจแล้ว): ${missing.map((c) => c.name).join(', ')}`, 400);
  }

  // จุดที่ส่งมาต้องครบทุกชิ้น — ส่งมาครึ่งเดียวใช้เป็นหลักฐานไม่ได้ ไม่ว่าจะถึงรอบหรือไม่
  // ตรวจความถูกต้องให้ครบก่อน แล้วค่อยเปิด transaction — จะได้ไม่ถือ connection ไว้เปล่า ๆ
  const included = checkpoints.filter((c) => submittedById.has(c.id));
  for (const cp of included) {
    const err = validateSubmission(cp, submittedById.get(cp.id));
    if (err) throw new AppError(err, 400);
  }

  // server เป็นคนตัดสิน OK/NG ไม่ใช่ค่าที่ client ส่งมา (ยกเว้น attribute ที่คนกดเอง)
  const linesByCheckpoint = included.map((cp) => ({
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
         (model_id, machine_id, inspector_id, mo_no, lot_no, shift, subgroup_no, remark, overall_result,
          mo_item_no, mo_item_name, mo_draw, mo_model_group)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(b.model_id), Number(b.machine_id), Number(b.inspector_id),
        moNo, textOrNull(b.lot_no), shift, subgroupNo,
        textOrNull(b.remark), overall,
        moItemNo, moItemName, moDraw, moModelGroup,
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
    // ⚠️ Dashboard กรองตามเครื่องได้ (?machine=) — ไม่มี machineId มาด้วยจะแยกไม่ออกว่าใบนี้
    //    เป็นของเครื่องที่กำลังดูอยู่ไหม แล้วต้องโหลดกราฟใหม่ทุกครั้งที่เครื่องไหนก็ได้บันทึก
    //    ส่งแค่ id ไม่ส่งชื่อ — client มีลิสต์เครื่องจาก /master/lookups อยู่แล้ว
    machineId: Number(b.machine_id),
    subgroupNo: saved.subgroupNo,
    moNo,
    shift,
    overallResult: overall,
    // เฉพาะจุดที่อยู่ในใบนี้จริง — จุดที่เว้นไว้ (ยังไม่ถึงรอบ) ไม่มีจุดใหม่บนกราฟ
    checkpointIds: included.map((c) => c.id),
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

// ── ยกเลิก / คืนค่า ───────────────────────────────────────────────────────
//
// ⚠️ ใบตรวจ "ยกเลิก" ไม่ใช่ "ลบ" — แถวอยู่ต่อใน DB แต่ถูกตัดออกจากกราฟ/รายงาน/
//    Excel/Cp-Cpk/baseline ที่ buildInspectionFilter() จุดเดียว
//    หลักฐานการตรวจต้องไม่หายไปเฉย ๆ เพราะมีคนกดปุ่ม และต้องคืนค่าได้
//
// ⚠️ ห้ามแตะการแจก subgroup_no — MAX+1 ยังต้องนับรวมใบที่ยกเลิกเหมือนเดิม
//    ไม่งั้นเลขถูกใช้ซ้ำแล้วชน UNIQUE(model_id, mo_no, subgroup_no) กับใบที่ยกเลิกไว้
//    ผลคือเลข subgroup มีช่องว่างได้หลังยกเลิก ซึ่งถูกต้อง — หายไปหนึ่งใบคือหายไปหนึ่งจุด

// จุดตรวจที่ baseline ถูกล็อกไว้ "คร่อม" ใบที่เพิ่งยกเลิก
//
// ⚠️ xbarbar / rbar / subgroups ใน checkpoint_baselines เป็นตัวเลขที่ freeze ไว้
//    ไม่มีอะไรคำนวณใหม่ให้ ยกเลิกใบที่อยู่ในช่วงนั้นแล้วเส้น control limit จะยังมาจาก
//    ข้อมูลที่ระบบเพิ่งบอกว่าไม่นับ — ต้องบอกให้คนไป re-baseline
//    **ห้ามล้าง baseline ให้เอง** เส้นลิมิตเปลี่ยนได้เมื่อคนสั่งเท่านั้น
//
// ⚠️ ใบเดียวกระทบได้ถึงสองชุด: ชุดของเครื่องที่ตรวจใบนั้น และชุด "รวมทุกเครื่อง" (machine_id = 0)
//    ซึ่งคิดจากข้อมูลของทุกเครื่องรวมกัน — เช็คแค่ชุดเดียวคือปล่อยอีกชุดค้างไว้เงียบ ๆ
//    ชื่อที่คืนไปจึงติดขอบเขตไว้ด้วย ไม่งั้นคนเห็นชื่อจุดตรวจแล้วไม่รู้ว่าต้อง re-baseline ของใคร
const staleBaselineCheckpoints = async (inspectionId) => {
  const [rows] = await query(
    `SELECT DISTINCT c.name, b.machine_id, mc.code AS machine_code
       FROM inspection_results r
       JOIN checkpoints          c  ON c.id = r.checkpoint_id
       JOIN inspections          i  ON i.id = r.inspection_id
       JOIN checkpoint_baselines b  ON b.checkpoint_id = c.id
                                   AND b.machine_id IN (0, i.machine_id)
       LEFT JOIN machines        mc ON mc.id = b.machine_id
      WHERE r.inspection_id = ?
        AND i.inspected_at BETWEEN b.baseline_from AND b.baseline_to`,
    [inspectionId]
  );
  return rows.map((r) => (
    Number(r.machine_id) === 0
      ? `${r.name} (รวมทุกเครื่อง)`
      : `${r.name} (${r.machine_code ?? `เครื่อง #${r.machine_id}`})`
  ));
};

router.put('/:id/void', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const id = Number(req.params.id);
  const voided = req.body?.voided !== false;
  const reason = String(req.body?.reason ?? '').trim();

  // ไม่มี auth ในระบบนี้ เหตุผลจึงเป็นความรับผิดชอบชิ้นเดียวที่เหลืออยู่ — บังคับกรอก
  if (voided && !reason) throw new AppError('ต้องระบุเหตุผลที่ยกเลิก', 400);

  const [[inspection]] = await query(
    'SELECT id, model_id, machine_id, mo_no, subgroup_no, voided_at FROM inspections WHERE id = ?',
    [id]
  );
  // ใบนี้อาจถูกล้างทิ้งจริงไปแล้วโดยคนอื่น (ชั้น 2) ขณะที่หน้าจอเรายังค้างปุ่มคืนค่าอยู่
  if (!inspection) throw new AppError('ไม่พบใบตรวจนี้ — อาจถูกล้างทิ้งไปแล้ว กดรีเฟรชเพื่อดูรายการล่าสุด', 404);

  // เช็คก่อนอัปเดต เพราะต้องรู้ว่าใบนี้อยู่ในช่วง baseline ไหนบ้าง (ทั้งตอนยกเลิกและตอนคืนค่า)
  const staleBaselines = await staleBaselineCheckpoints(id);

  await execute(
    voided
      ? 'UPDATE inspections SET voided_at = NOW(), voided_reason = ? WHERE id = ?'
      : 'UPDATE inspections SET voided_at = NULL, voided_reason = NULL WHERE id = ?',
    voided ? [reason, id] : [id]
  );

  const [checkpointRows] = await query(
    'SELECT DISTINCT checkpoint_id FROM inspection_results WHERE inspection_id = ?',
    [id]
  );

  // Dashboard ที่เปิดค้างอยู่ต้องขยับเอง ไม่งั้นจะยังวาดจุดที่ยกเลิกไปแล้ว
  // ใช้ event เดิม ความหมายตรงอยู่แล้ว: "ข้อมูลของรุ่นนี้เปลี่ยน โหลดกราฟที่กระทบใหม่"
  req.app.get('io')?.to(`model:${inspection.model_id}`).emit('inspection_saved', {
    inspectionId: id,
    modelId: inspection.model_id,
    machineId: inspection.machine_id,
    subgroupNo: inspection.subgroup_no,
    moNo: inspection.mo_no,
    voided,
    checkpointIds: checkpointRows.map((r) => r.checkpoint_id),
    ngCheckpointIds: [],
  });

  res.json({ success: true, voided, staleBaselines });
}));

// ชั้น 2 — ล้างใบที่ "ยกเลิกไปแล้ว" ออกจาก DB จริง
//
// มีไว้เพื่อให้ลบ item ที่ติด FK RESTRICT ได้ โดยไม่ต้อง force delete ทับหลักฐานจริง
// ลบได้เฉพาะใบที่ถูกประกาศไปแล้วว่าไม่นับเท่านั้น · inspection_results หายตาม CASCADE
// รับ model_id ใน body ให้เข้ารูปเดียวกับ DELETE /master/delete
// ⚠️ ต้อง login — ลบหลักฐานออกจาก DB จริง กู้คืนไม่ได้ (กดจากหน้า Master)
//    ต่างจาก PUT /:id/void ข้างบนที่ยังเปิดอยู่ เพราะยกเลิกคืนค่าได้ และมี voided_reason บังคับ
router.delete('/voided', requireLogin, wrap(async (req, res) => {
  const { model_id: modelId } = req.body;
  if (!isIntLike(modelId)) throw new AppError('model_id ไม่ถูกต้อง', 400);

  const [result] = await execute(
    'DELETE FROM inspections WHERE model_id = ? AND voided_at IS NOT NULL',
    [Number(modelId)]
  );

  // ⚠️ machineId = null โดยตั้งใจ — การล้างใบที่ยกเลิกกวาดทุกเครื่องของรุ่นนี้
  //    ฝั่ง client ต้องอ่าน null ว่า "โหลดใหม่เสมอ" ไม่ใช่ "ไม่ตรงกับเครื่องที่ดูอยู่"
  req.app.get('io')?.to(`model:${Number(modelId)}`).emit('inspection_saved', {
    modelId: Number(modelId),
    machineId: null,
    purged: result.affectedRows,
    checkpointIds: [],
    ngCheckpointIds: [],
  });

  res.json({ success: true, deleted: result.affectedRows });
}));

// ── อ่าน ──────────────────────────────────────────────────────────────────

// จุดไหนถึงรอบต้องกรอกในใบถัดไป — หน้าใบตรวจยิงทุกครั้งที่เปลี่ยน item / เครื่อง / กะ
// ⚠️ เป็นแค่ตัวช่วยของหน้าจอ ตัวบังคับจริงคือ POST / ที่คำนวณชุดเดียวกันซ้ำตอนบันทึก
// ⚠️ ต้องอยู่ก่อน GET /:id ไม่งั้น 'due' ถูกจับเป็น id
router.get('/due', wrap(async (req, res) => {
  const { model_id: modelId, machine_id: machineId, shift } = req.query;
  if (!isIntLike(modelId) || !isIntLike(machineId)) throw new AppError('ต้องระบุ model_id และ machine_id', 400);
  if (!isShift(shift)) throw new AppError('ต้องระบุกะ', 400);

  const [checkpoints, done] = await Promise.all([
    fetchModelCheckpoints(modelId),
    fetchDoneCheckpointIds({ modelId, machineId, shift }),
  ]);
  res.json({
    due: checkpoints.filter((c) => !done.has(c.id)).map((c) => c.id),
    done: checkpoints.filter((c) => done.has(c.id)).map((c) => c.id),
  });
}));

// รายการใบตรวจล่าสุด — ตาราง log ใต้ใบตรวจใช้เส้นนี้
// ⚠️ เส้นนี้ **โชว์ใบที่ยกเลิกด้วย** โดยตั้งใจ — ไม่งั้นกดคืนค่าไม่ได้ และคนจะนึกว่าลบจริงไปแล้ว
//    (ต่างจาก charts/reports ที่ตัดทิ้งผ่าน buildInspectionFilter)
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
    `SELECT i.*, m.item_no, m.item_name, mc.code AS machine_code, mc.name AS machine_name,
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
    `SELECT i.*, m.item_no, m.item_name, mc.name AS machine_name, ins.name AS inspector_name
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
