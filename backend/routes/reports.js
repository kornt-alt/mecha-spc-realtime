// backend/routes/reports.js — รายงานรายรุ่น
//
// หน้า Report ต้องใช้เลขชุดเดียวกับที่หน้ากราฟแสดง จึงเรียก spcStats.analyze ตัวเดียวกัน
// (ถ้าคำนวณสรุปด้วย SQL แยกต่างหาก วันหนึ่งสองหน้าจะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก)
'use strict';

const express = require('express');
const { query } = require('../db/pool');
const {
  fetchModelRows, fetchModelCheckpoints, fetchModelBaselines, fetchModelTargets,
} = require('../db/queries');
const { targetFor } = require('../services/capabilityTarget');
const { buildInspectionFilter } = require('../db/queries');
const { analyze } = require('../services/spcStats');
const { baselineOf, pickBaseline, scopeOf } = require('../services/baseline');
const { AppError, wrap } = require('../middleware/errorHandler');
const { filterFrom } = require('./charts');

const router = express.Router();

const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));

// GET /api/reports/model/:modelId — สรุป + กราฟทุกจุดของรุ่น ในคำขอเดียว
router.get('/model/:modelId', wrap(async (req, res) => {
  const { modelId } = req.params;
  if (!isIntLike(modelId)) throw new AppError('model id ไม่ถูกต้อง', 400);

  const [[model]] = await query(
    `SELECT m.*, d.name AS division_name, cu.name AS customer_name
       FROM models m
       JOIN divisions d ON d.id = m.division_id
       LEFT JOIN customers cu ON cu.id = m.customer_id
      WHERE m.id = ?`,
    [Number(modelId)]
  );
  if (!model) throw new AppError('ไม่พบรุ่นนี้', 404);

  const filter = filterFrom(req.query);
  const [checkpoints, rowsByCheckpoint, baselinesByCheckpoint, targets] = await Promise.all([
    fetchModelCheckpoints(modelId, { activeOnly: req.query.all !== '1' }),
    fetchModelRows(modelId, filter),
    fetchModelBaselines(modelId),
    fetchModelTargets(modelId),
  ]);
  // ⚠️ baseline แยกรายเครื่อง — ขอบเขตต้องตรงกับตัวกรองที่ใช้ดึงค่าวัดข้างบนเสมอ
  //    ไม่ตรงเมื่อไหร่คือเอาลิมิตของเครื่องหนึ่งไปวาดทับจุดของอีกเครื่อง
  const scope = scopeOf(filter);

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

  // ── รายการใบตรวจ (โชว์ใบที่ยกเลิกด้วย) ────────────────────────────────
  //
  // ⚠️ handler นี้เรียก buildInspectionFilter สองครั้งด้วยคนละ option โดยตั้งใจ ห้ามยุบรวม
  //    fetchModelRows ข้างบน (กราฟทุกจุดตรวจในหน้านี้) ต้อง **ไม่รวม** ใบที่ยกเลิก
  //    ส่วนตารางข้างล่างต้อง **รวม** ไม่งั้นกดคืนค่าไม่ได้และคนจะนึกว่าลบจริงไปแล้ว
  //    ยุบเป็นครั้งเดียวเมื่อไหร่ ใบที่ยกเลิกจะไหลกลับเข้ากราฟเงียบ ๆ
  const { where: listWhere, params: listParams } = buildInspectionFilter(filter, { includeVoided: true });
  const [inspections] = await query(
    `SELECT i.id, i.mo_no, i.lot_no, i.shift, i.subgroup_no, i.inspected_at, i.overall_result,
            i.voided_at, i.voided_reason,
            mc.code AS machine_code, mc.name AS machine_name, ins.name AS inspector_name,
            (SELECT COUNT(*) FROM inspection_results r
              WHERE r.inspection_id = i.id AND r.judgment = 'NG') AS ng_count
       FROM inspections i
       JOIN machines mc    ON mc.id  = i.machine_id
       JOIN inspectors ins ON ins.id = i.inspector_id
      WHERE i.model_id = ?${listWhere.length ? ` AND ${listWhere.join(' AND ')}` : ''}
      ORDER BY i.inspected_at DESC, i.id DESC
      LIMIT 500`,
    [Number(modelId), ...listParams]
  );

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
        capabilityTarget: null,
      };
    }

    const baselineRows = baselinesByCheckpoint.get(checkpoint.id) ?? [];
    const baseline = baselineOf(pickBaseline(baselineRows, scope));

    const result = analyze(rows, { usl: checkpoint.usl, lsl: checkpoint.lsl, baseline, ruleSet: targets.ruleSet });
    const ngCount = rows.filter((r) => r.judgment === 'NG').length;

    return {
      checkpoint,
      baseline,
      baselines: baselineRows.map(baselineOf),
      ngCount,
      ngRate: rows.length ? ngCount / rows.length : null,
      capabilityTarget: targetFor(checkpoint, targets),
      ...result,
    };
  });

  res.json({
    model,
    // เกณฑ์ Cp/Cpk ทั้งสองชุดของ item (หัวรายงานโชว์) — รายจุดอยู่ที่ charts[].capabilityTarget
    targets,
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
      // ⚠️ summary กับ charts ข้างบนไม่นับใบที่ยกเลิก แต่ inspections ข้างล่างรวมไว้ด้วย
      //    ตัวเลขนี้มีไว้ให้หน้าจออธิบายความต่างได้ ไม่งั้นคนนับแถวแล้วสงสัยว่าทำไมไม่ตรง
      voidedInspections: inspections.filter((i) => i.voided_at).length,
    },
    charts,
    inspections,
  });
}));

// GET /api/reports/model/:modelId/grid — ตารางแบบชีต Input ของ Excel
//
// จุดตรวจเป็นคอลัมน์ ชิ้นเป็นแถว ใบตรวจหนึ่งใบกาง n แถว (ชิ้นที่ 1..n) เรียงเก่า→ใหม่ลงล่าง
// เหมือนแถว 17 ลงไปในชีต Input · ใช้ทั้งแท็บ "ตารางแบบ Input" ของหน้ารายงาน
// และตารางประวัติใต้ใบตรวจ (`?limit=` = เอาแค่ N ใบล่าสุด)
//
// ⚠️ แถวรวมใบที่ยกเลิกด้วย (ขีดฆ่าบนจอ) แต่ Max/Avg/Min หัวตาราง **ไม่รวม** — หลักเดียวกับ
//    GET /model/:id ที่แยกรายการใบตรวจออกจากตัวเลขสถิติ
router.get('/model/:modelId/grid', wrap(async (req, res) => {
  const { modelId } = req.params;
  if (!isIntLike(modelId)) throw new AppError('model id ไม่ถูกต้อง', 400);
  const limit = isIntLike(req.query.limit) ? Math.min(Math.max(Number(req.query.limit), 1), 1000) : 1000;

  const filter = filterFrom(req.query);
  const { where, params } = buildInspectionFilter(filter, { includeVoided: true });
  const [checkpoints, [inspections]] = await Promise.all([
    fetchModelCheckpoints(modelId, { activeOnly: req.query.all !== '1' }),
    query(
      `SELECT i.id, i.mo_no, i.lot_no, i.shift, i.subgroup_no, i.inspected_at, i.overall_result,
              i.voided_at, mc.code AS machine_code, ins.name AS inspector_name
         FROM inspections i
         JOIN machines mc    ON mc.id  = i.machine_id
         JOIN inspectors ins ON ins.id = i.inspector_id
        WHERE i.model_id = ?${where.length ? ` AND ${where.join(' AND ')}` : ''}
        ORDER BY i.inspected_at DESC, i.id DESC
        LIMIT ?`,
      [Number(modelId), ...params, limit]
    ),
  ]);
  inspections.reverse();

  const [results] = inspections.length
    ? await query(
      `SELECT inspection_id, checkpoint_id, piece_no, value, judgment
         FROM inspection_results WHERE inspection_id IN (?)`,
      [inspections.map((i) => i.id)]
    )
    : [[]];

  const byInspection = new Map();
  for (const r of results) {
    if (!byInspection.has(r.inspection_id)) byInspection.set(r.inspection_id, []);
    byInspection.get(r.inspection_id).push(r);
  }

  // สถิติหัวคอลัมน์ (แถว Max / Average / Min ของชีต Input) — เฉพาะใบที่ยังไม่ยกเลิก
  const acc = new Map();
  const rows = [];
  for (const ins of inspections) {
    const lines = byInspection.get(ins.id) ?? [];
    const pieces = Math.max(1, ...lines.map((l) => l.piece_no));
    for (let p = 1; p <= pieces; p += 1) {
      const cells = {};
      for (const l of lines) {
        if (l.piece_no !== p) continue;
        const value = l.value === null ? null : Number(l.value);
        cells[l.checkpoint_id] = { value, judgment: l.judgment };
        if (!ins.voided_at && value !== null) {
          const a = acc.get(l.checkpoint_id) ?? { max: -Infinity, min: Infinity, sum: 0, count: 0 };
          a.max = Math.max(a.max, value);
          a.min = Math.min(a.min, value);
          a.sum += value;
          a.count += 1;
          acc.set(l.checkpoint_id, a);
        }
      }
      rows.push({
        inspection_id: ins.id,
        inspected_at: ins.inspected_at,
        mo_no: ins.mo_no,
        lot_no: ins.lot_no,
        machine_code: ins.machine_code,
        shift: ins.shift,
        inspector_name: ins.inspector_name,
        subgroup_no: ins.subgroup_no,
        overall_result: ins.overall_result,
        voided_at: ins.voided_at,
        piece_no: p,
        pieces,
        cells,
      });
    }
  }

  const stats = {};
  for (const [id, a] of acc) stats[id] = { max: a.max, min: a.min, avg: a.sum / a.count, count: a.count };

  res.json({ checkpoints, rows, stats, truncated: inspections.length === limit });
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
  const targets = await fetchModelTargets(modelId);

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

  ws.addRow([`รายงานผลตรวจสอบ — ${model.item_no} ${model.item_name}`]);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow([
    `ช่วงวันที่: ${filter.from && filter.to ? `${filter.from} ถึง ${filter.to}` : 'ทั้งหมด'}`,
    '', '', `ออกรายงานเมื่อ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
  ]);
  const g = targets.general;
  const c = targets.ctf;
  ws.addRow([
    `ลูกค้า: ${targets.customerName ?? 'ไม่ระบุ'} · เกณฑ์ Cp ≥ ${g.minCp.toFixed(2)} Cpk ≥ ${g.minCpk.toFixed(2)}` +
    ` · จุด SC point: Cp ≥ ${c.minCp.toFixed(2)} Cpk ≥ ${c.minCpk.toFixed(2)}`,
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
  //
  // ⚠️ item_no ต้อง sanitize ก่อน — เลข item จริงมี '/' หรือเว้นวรรคได้ ซึ่งทำให้
  //    ทั้งชื่อไฟล์และ header Content-Disposition เพี้ยน (ของเดิมเป็น model_code
  //    ที่คนพิมพ์เองเลยไม่เคยเจอ) เก็บไว้เฉพาะ [A-Za-z0-9_.-] ที่เหลือยุบเป็น '_'
  const safeItemNo = String(model.item_no || 'item').replace(/[^\w.-]+/g, '_');
  const fname = `QC-${safeItemNo}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`
  );
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
