// backend/routes/events.js — Event Log ของจุดที่ผิดกฎ OCS (ท้ายชีต SC ของฟอร์ม SP-QC-214C)
//
// 1 แถว = สาเหตุ (4M + Measurement) + มาตรการแก้ไข ของ 1 จุด × 1 กราฟ (X̄ หรือ R)
// ตัวกฎคำนวณสดที่ spcStats.ocsRules — ตารางนี้เก็บแค่สิ่งที่คนเขียน ไม่ได้เก็บว่าจุดไหนผิดกฎ
//
// ⚠️ ไม่ต้อง login โดยตั้งใจ (หลักเดียวกับ PUT /inspections/:id/void) — คนหน้าไลน์เป็นคนเขียน
//    และไม่มีใคร login · recorded_by จึงบังคับกรอก เป็นร่องรอยเดียวว่าใครเขียน
'use strict';

const express = require('express');
const { query, execute } = require('../db/pool');
const { buildInspectionFilter } = require('../db/queries');
const { filterFrom } = require('./charts');
const { AppError, wrap } = require('../middleware/errorHandler');

const router = express.Router();

const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));

// ช่องข้อความทั้งหมดของฟอร์ม — ชื่อตรงคอลัมน์ DB เป๊ะ ต่อเข้า SQL จากลิสต์นี้เท่านั้น
const TEXT_FIELDS = ['man_pd', 'man_qc', 'machine_note', 'method', 'material', 'measurement', 'corrective_action'];
const CHARTS = ['xbar', 'range'];

// GET /events?checkpoint_id=&from=&to=&machine_id=… (ตัวกรองชุดเดียวกับ GET /charts/:id)
// ⚠️ ใช้ buildInspectionFilter ตัวเดียวกับกราฟ — ใบที่ยกเลิกถูกตัดทิ้งเหมือนกัน event ของมันจึงไม่โผล่
router.get('/', wrap(async (req, res) => {
  if (!isIntLike(req.query.checkpoint_id)) throw new AppError('ต้องระบุ checkpoint_id', 400);

  const { where, params } = buildInspectionFilter(filterFrom(req.query));
  const [rows] = await query(
    `SELECT e.*
       FROM ocs_events e
       JOIN inspections i ON i.id = e.inspection_id
      WHERE e.checkpoint_id = ?${where.length ? ` AND ${where.join(' AND ')}` : ''}
      ORDER BY i.inspected_at ASC, e.chart ASC`,
    [Number(req.query.checkpoint_id), ...params]
  );
  res.json(rows);
}));

// PUT /events — บันทึกหรือแก้ของจุดเดิม (upsert ด้วย checkpoint_id + inspection_id + chart)
router.put('/', wrap(async (req, res) => {
  const b = req.body ?? {};
  if (!isIntLike(b.checkpoint_id) || !isIntLike(b.inspection_id)) {
    throw new AppError('ต้องระบุ checkpoint_id และ inspection_id', 400);
  }
  if (!CHARTS.includes(b.chart)) throw new AppError("chart ต้องเป็น 'xbar' หรือ 'range'", 400);

  const recordedBy = String(b.recorded_by ?? '').trim();
  if (!recordedBy) throw new AppError('ต้องระบุชื่อผู้บันทึก', 400);

  const text = (v) => {
    const t = String(v ?? '').trim();
    return t === '' ? null : t;
  };
  const values = TEXT_FIELDS.map((k) => text(b[k]));
  if (values.every((v) => v === null)) throw new AppError('ยังไม่ได้กรอกสาเหตุหรือมาตรการแก้ไขสักช่อง', 400);

  // จุดนี้ต้องมีจริง — ใบตรวจนั้นต้องมีผลของจุดตรวจนี้ (กันผูก event กับใบของ item อื่น)
  const [[exists]] = await query(
    'SELECT COUNT(*) AS n FROM inspection_results WHERE inspection_id = ? AND checkpoint_id = ?',
    [Number(b.inspection_id), Number(b.checkpoint_id)]
  );
  if (!Number(exists.n)) throw new AppError('ใบตรวจนี้ไม่มีผลของจุดตรวจนี้', 400);

  // rules = snapshot ของกฎที่ผิด ณ ตอนบันทึก ('out,shift_up') — กฎคำนวณสด จุดนี้อาจไม่ผิดกฎแล้ววันหลัง
  const rules = Array.isArray(b.rules) ? b.rules.map(String).join(',').slice(0, 64) : text(b.rules);

  await execute(
    `INSERT INTO ocs_events
       (checkpoint_id, inspection_id, chart, rules, ${TEXT_FIELDS.join(', ')}, recorded_by)
     VALUES (?, ?, ?, ?, ${TEXT_FIELDS.map(() => '?').join(', ')}, ?)
     ON DUPLICATE KEY UPDATE
       rules = VALUES(rules), ${TEXT_FIELDS.map((k) => `${k} = VALUES(${k})`).join(', ')},
       recorded_by = VALUES(recorded_by)`,
    [Number(b.checkpoint_id), Number(b.inspection_id), b.chart, rules, ...values, recordedBy]
  );

  const [[row]] = await query(
    'SELECT * FROM ocs_events WHERE checkpoint_id = ? AND inspection_id = ? AND chart = ?',
    [Number(b.checkpoint_id), Number(b.inspection_id), b.chart]
  );
  res.json({ success: true, event: row });
}));

module.exports = router;
