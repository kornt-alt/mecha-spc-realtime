// backend/routes/charts.js — ข้อมูลกราฟ control chart ของจุดตรวจ
//
// ⚠️ สถิติทั้งหมดคำนวณที่นี่ ฝั่ง client แค่เอาไปวาด ไม่คำนวณอะไรเลย
//    เหตุผลเดียวกับที่กฎตัดสิน OK/NG อยู่ฝั่ง server — ตาราง A2/D3/D4 และสูตร Cp/Cpk
//    ต้องมีชุดเดียวในระบบ มีสองชุดเมื่อไหร่คือรอวันที่มันไม่ตรงกัน
'use strict';

const express = require('express');
const {
  fetchCheckpointRows, fetchCheckpoint, fetchCheckpointBaselines, fetchModelTargets,
} = require('../db/queries');
const { targetFor } = require('../services/capabilityTarget');
const { analyze } = require('../services/spcStats');
const { CONSTANTS, IMR } = require('../services/spcConstants');

const CONSTANTS_TABLE = {
  rows: Object.entries(CONSTANTS).map(([size, row]) => ({ n: Number(size), ...row })),
  imr: { ...IMR },
};
const {
  computeBaseline, setBaseline, clearBaseline, baselineOf, pickBaseline, scopeOf,
} = require('../services/baseline');
const { AppError, wrap } = require('../middleware/errorHandler');
// ตั้ง/ล้าง baseline = เปลี่ยนเส้น control limit ที่ทุกจอใช้ตัดสิน — ต้อง login (กดจากหน้า Master)
// preview ยังเปิดอยู่ อ่านอย่างเดียวไม่เขียนอะไร
const { requireMenu } = require('../middleware/requireLogin');

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
  // หมวดการตรวจ — ว่าง = ตรวจตามรอบ (buildInspectionFilter ตั้ง default ให้)
  // หมวดที่มีขั้น PD/QC ไม่ส่ง stage มา = ดูผล QC (ค่าที่ยืนยันแล้ว) · ส่ง 'pd' มาถึงเห็นของ PD
  category_id: q.category || q.category_id || null,
  stage: (q.category || q.category_id) && Number(q.category || q.category_id) !== 1
    ? (q.stage === 'pd' ? 'pd' : 'qc')
    : null,
});

// ⚠️ baseline ล็อกได้เฉพาะหมวดตรวจตามรอบ — ข้อมูล Set up ห้ามกลายเป็นเส้น control limit ของงานจริง
const assertRoutine = (f) => {
  if (f.category_id && Number(f.category_id) !== 1) {
    throw new AppError('ล็อก baseline ได้เฉพาะข้อมูลตรวจตามรอบ', 400);
  }
};

// GET /api/charts/:checkpointId — จุด + ลิมิต + Cp/Cpk + จุดที่ผิดกฎ OCS (ทั้ง X̄ และ R) ในก้อนเดียว
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

  // ⚠️ baseline แยกรายเครื่อง — ต้องเลือกชุดให้ตรงกับเครื่องที่กำลังกรองดูอยู่
  //    ไม่ตรงเมื่อไหร่คือเอาลิมิตของเครื่องหนึ่งไปตัดสินอีกเครื่อง · ยังไม่ได้ล็อกของเครื่องนั้น
  //    ก็ได้ null แล้วกราฟจะคำนวณสดเป็น provisional ให้ (ไม่ยืมของชุดรวมมาใช้ ดู pickBaseline)
  const filter = filterFrom(req.query);
  const [rows, baselineRows, targets] = await Promise.all([
    fetchCheckpointRows(checkpointId, filter),
    fetchCheckpointBaselines(checkpointId),
    fetchModelTargets(checkpoint.model_id),
  ]);
  // หมวดอื่นที่ไม่ใช่ตรวจตามรอบ ไม่มี baseline ของตัวเอง (ล็อกไม่ได้ ดู assertRoutine) และห้ามยืมของงานตามรอบ
  //   → ลิมิต provisional คำนวณสดจากข้อมูลหมวดนั้นเสมอ
  const isRoutine = !filter.category_id || Number(filter.category_id) === 1;
  const baseline = isRoutine ? baselineOf(pickBaseline(baselineRows, scopeOf(filter))) : null;

  const result = analyze(rows, { usl: checkpoint.usl, lsl: checkpoint.lsl, baseline, ruleSet: targets.ruleSet });

  // baselines = ทุกชุดที่ล็อกไว้ของจุดนี้ (หน้า Master Setup เอาไปโชว์ว่าเครื่องไหนล็อกแล้วบ้าง)
  res.json({
    checkpoint,
    baseline,
    baselines: baselineRows.map(baselineOf),
    baselineScope: scopeOf(filter),
    // เกณฑ์ Cp/Cpk ขั้นต่ำของจุดนี้ (ลูกค้า/override/ค่าระบบ เลือกแล้วที่ server) — client แค่เอาไปเทียบสี
    capabilityTarget: targetFor(checkpoint, targets),
    // ตารางค่าคงที่ทั้งชุด — หน้า SC วาดเป็นตารางอ้างอิงเหมือนชีต SC ของ Excel
    // ส่งจาก server เพราะ client ห้ามถือตารางนี้เอง · ใส่เฉพาะ route นี้ ไม่ติดไปทุกการ์ดของ Dashboard
    constantsTable: CONSTANTS_TABLE,
    ...result,
  });
}));

// GET /api/charts/:checkpointId/baseline/preview — ลองดูว่าจะได้ baseline เท่าไร ยังไม่บันทึก
router.get('/:checkpointId/baseline/preview', wrap(async (req, res) => {
  if (!isIntLike(req.params.checkpointId)) throw new AppError('checkpoint id ไม่ถูกต้อง', 400);
  const f = filterFrom(req.query);
  assertRoutine(f);
  const r = await computeBaseline(req.params.checkpointId, f);
  res.json({
    machineId: r.machineId,
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
router.post('/:checkpointId/baseline', requireMenu('master.items'), wrap(async (req, res) => {
  if (!isIntLike(req.params.checkpointId)) throw new AppError('checkpoint id ไม่ถูกต้อง', 400);

  const f = filterFrom(req.body ?? {});
  assertRoutine(f);
  const r = await setBaseline(req.params.checkpointId, f);
  // machineId ไปกับ event ด้วย — Dashboard ที่กรองอยู่คนละเครื่องจะได้ไม่ต้องโหลดกราฟใหม่เปล่า ๆ
  // (0 = ชุดรวม กระทบเฉพาะจอที่ดู "ทุกเครื่อง" อยู่)
  req.app.get('io')?.to(`model:${r.checkpoint.model_id}`).emit('baseline_updated', {
    checkpointId: Number(req.params.checkpointId),
    modelId: r.checkpoint.model_id,
    machineId: r.machineId,
  });

  res.json({
    success: true,
    machineId: r.machineId,
    n: r.n,
    subgroupCount: r.subgroupCount,
    enoughSubgroups: r.enoughSubgroups,
    xbarbar: r.xbarbar,
    rbar: r.rbar,
    limits: r.limits,
  });
}));

// DELETE /api/charts/:checkpointId/baseline — กลับไปเป็น provisional
router.delete('/:checkpointId/baseline', requireMenu('master.items'), wrap(async (req, res) => {
  if (!isIntLike(req.params.checkpointId)) throw new AppError('checkpoint id ไม่ถูกต้อง', 400);

  const checkpoint = await fetchCheckpoint(req.params.checkpointId);
  if (!checkpoint) throw new AppError('ไม่พบจุดตรวจนี้', 404);

  // ⚠️ ล้างเฉพาะขอบเขตที่สั่ง — ไม่ส่ง machine_id มา = ล้างชุดรวม ไม่ใช่ล้างทุกชุด
  //    ล้างทุกชุดให้เองเมื่อไหร่คือลบ baseline ของเครื่องอื่นที่คนไม่ได้สั่ง
  const machineId = scopeOf({ machine_id: req.query.machine_id });
  await clearBaseline(req.params.checkpointId, machineId);
  req.app.get('io')?.to(`model:${checkpoint.model_id}`).emit('baseline_updated', {
    checkpointId: Number(req.params.checkpointId),
    modelId: checkpoint.model_id,
    machineId,
  });

  res.json({ success: true, machineId });
}));

module.exports = router;
module.exports.filterFrom = filterFrom;
