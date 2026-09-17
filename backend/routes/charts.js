// backend/routes/charts.js — ข้อมูลกราฟ control chart ของจุดตรวจ
//
// ⚠️ สถิติทั้งหมดคำนวณที่นี่ ฝั่ง client แค่เอาไปวาด ไม่คำนวณอะไรเลย
//    เหตุผลเดียวกับที่กฎตัดสิน OK/NG อยู่ฝั่ง server — ตาราง A2/D3/D4 และสูตร Cp/Cpk
//    ต้องมีชุดเดียวในระบบ มีสองชุดเมื่อไหร่คือรอวันที่มันไม่ตรงกัน
'use strict';

const express = require('express');
const { fetchCheckpointRows, fetchCheckpoint } = require('../db/queries');
const { analyze } = require('../services/spcStats');
const { computeBaseline, setBaseline, clearBaseline, baselineOf } = require('../services/baseline');
const { AppError, wrap } = require('../middleware/errorHandler');

const router = express.Router();

const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));

// ตัวกรองที่รับจาก query string — ค่าว่างคือไม่กรอง ไม่ใช่กรองด้วยค่าว่าง
const filterFrom = (q) => ({
  from: q.from || null,
  to: q.to || null,
  mo_no: q.mo_no || null,
  lot_no: q.lot_no || null,
  shift: q.shift || null,
  inspector_id: q.inspector_id || null,
  machine_id: q.machine_id || null,
});

// GET /api/charts/:checkpointId — จุด + ลิมิต + Cp/Cpk + จุดที่ผิดกฎ Nelson ในก้อนเดียว
router.get('/:checkpointId', wrap(async (req, res) => {
  const { checkpointId } = req.params;
  if (!isIntLike(checkpointId)) throw new AppError('checkpoint id ไม่ถูกต้อง', 400);

  const checkpoint = await fetchCheckpoint(checkpointId);
  if (!checkpoint) throw new AppError('ไม่พบจุดตรวจนี้', 404);

  // จุด attribute ไม่มีค่าตัวเลข วาด control chart ไม่ได้ — คืนสรุป OK/NG แทน
  if (checkpoint.char_type === 'attribute') {
    const rows = await fetchCheckpointRows(checkpointId, filterFrom(req.query));
    const ng = rows.filter((r) => r.judgment === 'NG').length;
    return res.json({
      checkpoint,
      mode: 'attribute',
      total: rows.length,
      ngCount: ng,
      ngRate: rows.length ? ng / rows.length : null,
      points: [],
      limits: null,
      capability: null,
      violations: [],
    });
  }

  const rows = await fetchCheckpointRows(checkpointId, filterFrom(req.query));
  const result = analyze(rows, {
    usl: checkpoint.usl,
    lsl: checkpoint.lsl,
    baseline: baselineOf(checkpoint),
  });

  res.json({ checkpoint, baseline: baselineOf(checkpoint), ...result });
}));

// GET /api/charts/:checkpointId/baseline/preview — ลองดูว่าจะได้ baseline เท่าไร ยังไม่บันทึก
router.get('/:checkpointId/baseline/preview', wrap(async (req, res) => {
  if (!isIntLike(req.params.checkpointId)) throw new AppError('checkpoint id ไม่ถูกต้อง', 400);
  const r = await computeBaseline(req.params.checkpointId, filterFrom(req.query));
  res.json({
    n: r.n,
    subgroupCount: r.subgroupCount,
    enoughSubgroups: r.enoughSubgroups,
    minSubgroups: r.minSubgroups,
    xbarbar: r.xbarbar,
    rbar: r.rbar,
    limits: r.limits,
    from: r.from,
    to: r.to,
  });
}));

// POST /api/charts/:checkpointId/baseline — freeze ลิมิตจากช่วงที่เลือก
router.post('/:checkpointId/baseline', wrap(async (req, res) => {
  if (!isIntLike(req.params.checkpointId)) throw new AppError('checkpoint id ไม่ถูกต้อง', 400);

  const r = await setBaseline(req.params.checkpointId, filterFrom(req.body ?? {}));
  req.app.get('io')?.to(`model:${r.checkpoint.model_id}`).emit('baseline_updated', {
    checkpointId: Number(req.params.checkpointId),
    modelId: r.checkpoint.model_id,
  });

  res.json({
    success: true,
    n: r.n,
    subgroupCount: r.subgroupCount,
    enoughSubgroups: r.enoughSubgroups,
    xbarbar: r.xbarbar,
    rbar: r.rbar,
    limits: r.limits,
  });
}));

// DELETE /api/charts/:checkpointId/baseline — กลับไปเป็น provisional
router.delete('/:checkpointId/baseline', wrap(async (req, res) => {
  if (!isIntLike(req.params.checkpointId)) throw new AppError('checkpoint id ไม่ถูกต้อง', 400);

  const checkpoint = await fetchCheckpoint(req.params.checkpointId);
  if (!checkpoint) throw new AppError('ไม่พบจุดตรวจนี้', 404);

  await clearBaseline(req.params.checkpointId);
  req.app.get('io')?.to(`model:${checkpoint.model_id}`).emit('baseline_updated', {
    checkpointId: Number(req.params.checkpointId),
    modelId: checkpoint.model_id,
  });

  res.json({ success: true });
}));

module.exports = router;
module.exports.filterFrom = filterFrom;
