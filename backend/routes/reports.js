// backend/routes/reports.js — รายงานรายรุ่น
//
// หน้า Report ต้องใช้เลขชุดเดียวกับที่หน้ากราฟแสดง จึงเรียก spcStats.analyze ตัวเดียวกัน
// (ถ้าคำนวณสรุปด้วย SQL แยกต่างหาก วันหนึ่งสองหน้าจะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก)
'use strict';

const express = require('express');
const { query } = require('../db/pool');
const { fetchModelRows, fetchModelCheckpoints } = require('../db/queries');
const { buildInspectionFilter } = require('../db/queries');
const { analyze } = require('../services/spcStats');
const { baselineOf } = require('../services/baseline');
const { AppError, wrap } = require('../middleware/errorHandler');
const { filterFrom } = require('./charts');

const router = express.Router();

const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));

// GET /api/reports/model/:modelId — สรุป + กราฟทุกจุดของรุ่น ในคำขอเดียว
router.get('/model/:modelId', wrap(async (req, res) => {
  const { modelId } = req.params;
  if (!isIntLike(modelId)) throw new AppError('model id ไม่ถูกต้อง', 400);

  const [[model]] = await query(
    `SELECT m.*, d.name AS division_name
       FROM models m JOIN divisions d ON d.id = m.division_id WHERE m.id = ?`,
    [Number(modelId)]
  );
  if (!model) throw new AppError('ไม่พบรุ่นนี้', 404);

  const filter = filterFrom(req.query);
  const [checkpoints, rowsByCheckpoint] = await Promise.all([
    fetchModelCheckpoints(modelId, { activeOnly: req.query.all !== '1' }),
    fetchModelRows(modelId, filter),
  ]);

  // สรุปหัวรายงาน — นับจากตาราง inspections ตรง ๆ (1 แถว = 1 ใบตรวจ)
  const { where, params } = buildInspectionFilter(filter);
  const [[summary]] = await query(
    `SELECT COUNT(*) AS total_inspections,
            SUM(CASE WHEN i.overall_result = 'NG' THEN 1 ELSE 0 END) AS ng_inspections,
            MIN(i.inspected_at) AS first_at,
            MAX(i.inspected_at) AS last_at
       FROM inspections i
      WHERE i.model_id = ?${where.length ? ` AND ${where.join(' AND ')}` : ''}`,
    [Number(modelId), ...params]
  );

  const total = Number(summary.total_inspections) || 0;
  const ng = Number(summary.ng_inspections) || 0;

  const charts = checkpoints.map((checkpoint) => {
    const rows = rowsByCheckpoint.get(checkpoint.id) ?? [];

    if (checkpoint.char_type === 'attribute') {
      const ngCount = rows.filter((r) => r.judgment === 'NG').length;
      return {
        checkpoint,
        mode: 'attribute',
        total: rows.length,
        ngCount,
        ngRate: rows.length ? ngCount / rows.length : null,
        points: [], limits: null, capability: null, violations: [],
      };
    }

    const result = analyze(rows, {
      usl: checkpoint.usl,
      lsl: checkpoint.lsl,
      baseline: baselineOf(checkpoint),
    });
    const ngCount = rows.filter((r) => r.judgment === 'NG').length;

    return {
      checkpoint,
      baseline: baselineOf(checkpoint),
      ngCount,
      ngRate: rows.length ? ngCount / rows.length : null,
      ...result,
    };
  });

  res.json({
    model,
    filter,
    summary: {
      totalInspections: total,
      ngInspections: ng,
      // อัตรา NG ระดับ "ใบตรวจ" — ใบไหนมีจุด NG แม้จุดเดียวนับเป็น NG ทั้งใบ
      ngRate: total ? ng / total : null,
      firstAt: summary.first_at,
      lastAt: summary.last_at,
      // จุดที่ยัง out-of-control อยู่ — เป็นตัวเลขที่หัวหน้างานอยากเห็นก่อนอย่างอื่น
      outOfControlCheckpoints: charts.filter((c) => c.violations?.length > 0).length,
    },
    charts,
  });
}));

// GET /api/reports/model/:modelId/export — ดาวน์โหลดเป็น Excel
//
// สร้างไฟล์ฝั่ง server แล้วเขียนลง res ตรง ๆ (แพตเทิร์นเดียวกับที่ MECHA_TIME_IN ใช้)
// จะได้ไม่ต้องยัดไลบรารี xlsx ลง bundle ของหน้าเว็บ
router.get('/model/:modelId/export', wrap(async (req, res) => {
  const { modelId } = req.params;
  if (!isIntLike(modelId)) throw new AppError('model id ไม่ถูกต้อง', 400);

  const [[model]] = await query('SELECT * FROM models WHERE id = ?', [Number(modelId)]);
  if (!model) throw new AppError('ไม่พบรุ่นนี้', 404);

  const filter = filterFrom(req.query);
  const { where, params } = buildInspectionFilter(filter);

  // แถวละ 1 ค่าวัด พร้อม traceability ครบ — เปิดใน Excel แล้ว pivot ต่อได้เลย
  const [rows] = await query(
    `SELECT i.inspected_at, i.mo_no, i.lot_no, i.shift, i.subgroup_no,
            mc.code AS machine_code, mc.name AS machine_name, ins.name AS inspector_name,
            c.seq_no, c.name AS checkpoint_name, c.unit,
            r.piece_no, r.value, r.judgment, r.usl_used, r.lsl_used, r.ng_reason
       FROM inspection_results r
       JOIN inspections i   ON i.id  = r.inspection_id
       JOIN checkpoints c   ON c.id  = r.checkpoint_id
       JOIN machines mc     ON mc.id = i.machine_id
       JOIN inspectors ins  ON ins.id = i.inspector_id
      WHERE i.model_id = ?${where.length ? ` AND ${where.join(' AND ')}` : ''}
      ORDER BY i.inspected_at ASC, i.subgroup_no ASC, c.seq_no ASC, r.piece_no ASC`,
    [Number(modelId), ...params]
  );

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ผลตรวจ');

  ws.addRow([`รายงานผลตรวจสอบ — ${model.model_code} ${model.model_name}`]);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow([
    `ช่วงวันที่: ${filter.from && filter.to ? `${filter.from} ถึง ${filter.to}` : 'ทั้งหมด'}`,
    '', '', `ออกรายงานเมื่อ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
  ]);
  ws.addRow([]);

  const head = ws.addRow([
    'วันเวลาที่ตรวจ', 'MO No.', 'Lot No.', 'กะ', 'Subgroup', 'เครื่อง', 'ผู้ตรวจ',
    'ลำดับ', 'จุดตรวจ', 'หน่วย', 'ชิ้นที่', 'ค่าที่วัดได้', 'LSL', 'USL', 'ผล', 'เหตุผล NG',
  ]);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9ECEF' } };
    c.border = { bottom: { style: 'thin' } };
  });

  for (const r of rows) {
    const row = ws.addRow([
      new Date(r.inspected_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      r.mo_no, r.lot_no ?? '', r.shift, r.subgroup_no,
      `${r.machine_code} ${r.machine_name}`, r.inspector_name,
      r.seq_no, r.checkpoint_name, r.unit ?? '', r.piece_no,
      // decimal มาเป็น string — แปลงเป็น number ไม่งั้น Excel เก็บเป็นข้อความแล้วคำนวณต่อไม่ได้
      r.value === null ? '' : Number(r.value),
      r.lsl_used === null ? '' : Number(r.lsl_used),
      r.usl_used === null ? '' : Number(r.usl_used),
      r.judgment, r.ng_reason ?? '',
    ]);
    if (r.judgment === 'NG') {
      row.getCell(15).font = { bold: true, color: { argb: 'FFC00000' } };
    }
  }

  ws.columns = [
    { width: 20 }, { width: 14 }, { width: 12 }, { width: 6 }, { width: 10 },
    { width: 18 }, { width: 18 }, { width: 7 }, { width: 26 }, { width: 8 },
    { width: 8 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 7 }, { width: 24 },
  ];
  // ตรึงหัวตารางไว้ตอนเลื่อน — อ่านเลขแถวจาก head เอง ไม่ fix เป็นเลขตายตัว
  ws.views = [{ state: 'frozen', ySplit: head.number }];

  // ⚠️ ชื่อไฟล์เป็นภาษาไทยได้ ต้องมี filename*=UTF-8'' ไม่งั้นเบราว์เซอร์ได้ชื่อเพี้ยน
  const fname = `QC-${model.model_code}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`
  );
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
