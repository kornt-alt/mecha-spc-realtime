// backend/db/queries.js — query ที่ใช้ร่วมกันหลาย route
//
// การดึงค่าวัดของจุดตรวจหนึ่งจุดถูกใช้ทั้งใน charts / reports / baseline
// ถ้าปล่อยให้แต่ละที่เขียน JOIN เอง ตัวกรองจะไม่ตรงกันแล้วกราฟกับรายงานจะไม่ตรงกัน
'use strict';

const { query } = require('./pool');
const { resolveTargets } = require('../services/capabilityTarget');

// สร้าง WHERE จากตัวกรองที่ "ส่งมาจริง" เท่านั้น — ค่าว่างคือไม่กรอง ไม่ใช่กรองด้วยค่าว่าง
//
// ⚠️ วันที่กรองเมื่อได้รับครบทั้ง from และ to เท่านั้น ให้ตรงกับพฤติกรรมเดิมของระบบ
//    ฝั่ง client ต้องใช้เงื่อนไขเดียวกันเป๊ะ ไม่งั้นกรอกวันเดียวแล้วผลไม่ตรงกับที่เห็น
//
// ⚠️ ใบตรวจที่ถูกยกเลิกถูกตัดทิ้งเป็น default — ฟังก์ชันนี้เป็นคอขวดจุดเดียวที่
//    กราฟ / สรุปรายงาน / Excel / baseline ใช้ร่วมกัน การตัดที่นี่จึงครอบคลุมทุกทางพร้อมกัน
//    default เป็นแบบปลอดภัยโดยตั้งใจ: คนเขียนโค้ดใหม่ต้อง "ตั้งใจ" ส่ง includeVoided: true
//    ถึงจะดึงใบที่ยกเลิกออกมา ไม่ใช่ "ลืม" แล้วมันหลุดเข้ากราฟไปเอง
//    ที่เดียวที่ opt-out คือการดึงรายการมาโชว์ให้คนกดคืนค่า (routes/reports.js)
const buildInspectionFilter = (f = {}, { includeVoided = false } = {}) => {
  const where = [];
  const params = [];

  if (!includeVoided) where.push('i.voided_at IS NULL');

  if (f.from && f.to) {
    where.push('DATE(i.inspected_at) BETWEEN ? AND ?');
    params.push(f.from, f.to);
  }
  if (f.mo_no) {
    where.push('i.mo_no = ?');
    params.push(f.mo_no);
  }
  if (f.lot_no) {
    where.push('i.lot_no = ?');
    params.push(f.lot_no);
  }
  if (f.shift) {
    where.push('i.shift = ?');
    params.push(f.shift);
  }
  if (f.inspector_id) {
    where.push('i.inspector_id = ?');
    params.push(Number(f.inspector_id));
  }
  if (f.machine_id) {
    where.push('i.machine_id = ?');
    params.push(Number(f.machine_id));
  }

  return { where, params };
};

// ดึงค่าวัดของ checkpoint เดียว พร้อม meta ที่ tooltip ต้องใช้ (MO / lot / กะ / ผู้ตรวจ / เครื่อง)
// รูปแถวที่คืนตรงกับที่ spcStats.buildSubgroups ต้องการพอดี
const SELECT_RESULT_ROWS = `
  SELECT
    r.inspection_id, r.checkpoint_id, r.piece_no, r.value, r.judgment, r.n_used,
    i.subgroup_no, i.inspected_at, i.mo_no, i.lot_no, i.shift, i.overall_result,
    ins.name AS inspector_name,
    mc.name  AS machine_name
  FROM inspection_results r
  JOIN inspections i  ON i.id  = r.inspection_id
  JOIN inspectors  ins ON ins.id = i.inspector_id
  JOIN machines    mc  ON mc.id  = i.machine_id
`;

const fetchCheckpointRows = async (checkpointId, filter = {}) => {
  const { where, params } = buildInspectionFilter(filter);
  const sql = `${SELECT_RESULT_ROWS}
    WHERE r.checkpoint_id = ?${where.length ? ` AND ${where.join(' AND ')}` : ''}
    ORDER BY i.inspected_at ASC, i.subgroup_no ASC, r.piece_no ASC`;
  const [rows] = await query(sql, [Number(checkpointId), ...params]);
  return rows;
};

// ดึงทีเดียวสำหรับทุกจุดตรวจของรุ่น แล้วค่อยแยกเป็นราย checkpoint ในหน่วยความจำ
// หน้า report มีหลายจุดตรวจ ถ้ายิงทีละจุดจะกลายเป็น N query ต่อการเปิดหนึ่งครั้ง
const fetchModelRows = async (modelId, filter = {}) => {
  const { where, params } = buildInspectionFilter(filter);
  const sql = `${SELECT_RESULT_ROWS}
    WHERE i.model_id = ?${where.length ? ` AND ${where.join(' AND ')}` : ''}
    ORDER BY r.checkpoint_id ASC, i.inspected_at ASC, i.subgroup_no ASC, r.piece_no ASC`;
  const [rows] = await query(sql, [Number(modelId), ...params]);

  const byCheckpoint = new Map();
  for (const row of rows) {
    if (!byCheckpoint.has(row.checkpoint_id)) byCheckpoint.set(row.checkpoint_id, []);
    byCheckpoint.get(row.checkpoint_id).push(row);
  }
  return byCheckpoint;
};

const fetchCheckpoint = async (checkpointId) => {
  const [rows] = await query('SELECT * FROM checkpoints WHERE id = ?', [Number(checkpointId)]);
  return rows[0] ?? null;
};

const fetchModelCheckpoints = async (modelId, { activeOnly = true } = {}) => {
  const [rows] = await query(
    `SELECT * FROM checkpoints
      WHERE model_id = ?${activeOnly ? ' AND is_active = 1' : ''}
      ORDER BY seq_no ASC`,
    [Number(modelId)]
  );
  return rows;
};

// ── baseline ที่ freeze ไว้ (แยกรายเครื่อง) ────────────────────────────────
//
// ⚠️ machine_id = 0 คือชุด "รวมทุกเครื่อง" ไม่ใช่รหัสเครื่องจริง (ดูคอมเมนต์ใน schema.sql)
//    การเลือกว่าจะใช้แถวไหนอยู่ที่ pickBaseline() ใน services/baseline.js ที่เดียว
const fetchCheckpointBaselines = async (checkpointId) => {
  const [rows] = await query(
    'SELECT * FROM checkpoint_baselines WHERE checkpoint_id = ?',
    [Number(checkpointId)]
  );
  return rows;
};

// ดึงทีเดียวสำหรับทุกจุดตรวจของรุ่น แล้วแยกเป็นราย checkpoint ในหน่วยความจำ
// เหตุผลเดียวกับ fetchModelRows — หน้า report มีหลายจุดตรวจ ยิงทีละจุดจะกลายเป็น N query
const fetchModelBaselines = async (modelId) => {
  const [rows] = await query(
    `SELECT b.*
       FROM checkpoint_baselines b
       JOIN checkpoints c ON c.id = b.checkpoint_id
      WHERE c.model_id = ?`,
    [Number(modelId)]
  );

  const byCheckpoint = new Map();
  for (const row of rows) {
    if (!byCheckpoint.has(row.checkpoint_id)) byCheckpoint.set(row.checkpoint_id, []);
    byCheckpoint.get(row.checkpoint_id).push(row);
  }
  return byCheckpoint;
};

// ── ความถี่ต่อจุดตรวจ — จุดไหน "ถึงรอบ" ต้องกรอกในใบนี้ ──────────────────────
//
// จุดที่ "ทำแล้วรอบนี้" = มีผลในใบตรวจที่ยังไม่ถูกยกเลิก ของ item + เครื่องเดียวกัน ภายในรอบปัจจุบัน
//   frequency 'shift' → กะเดียวกัน ภายใน 12 ชั่วโมงที่ผ่านมา (กะยาวสุด 12 ชม. — กันกะ M ของเมื่อวานนับเป็นวันนี้)
//   frequency 'day'   → วันเดียวกัน (DATE(inspected_at) = CURDATE())
// จุดที่ไม่อยู่ในชุดนี้ = ถึงรอบ ต้องกรอก · จุดที่อยู่ในชุดนี้ = กรอกหรือไม่กรอกก็ได้
//
// ⚠️ กะดึกข้ามเที่ยงคืน → จุด 'day' กลับมาถึงรอบอีกครั้งหลัง 00:00 ในกะเดียวกัน
//    ผลคือวัดเกินหนึ่งรอบ ไม่ใช่ขาด — ยอมรับไว้ก่อน (ไม่มีข้อมูลเวลาเริ่ม/จบของแต่ละกะในระบบ)
// ⚠️ ใบที่ยกเลิกไม่นับ — ยกเลิกใบแรกของกะแล้วจุดพวกนั้นต้องกลับมาถึงรอบ
const fetchDoneCheckpointIds = async ({ modelId, machineId, shift }) => {
  const [rows] = await query(
    `SELECT DISTINCT r.checkpoint_id
       FROM inspection_results r
       JOIN inspections i ON i.id = r.inspection_id
       JOIN checkpoints c ON c.id = r.checkpoint_id
      WHERE i.model_id = ? AND i.machine_id = ? AND i.voided_at IS NULL
        AND (
          (c.frequency = 'shift' AND i.shift = ? AND i.inspected_at >= NOW() - INTERVAL 12 HOUR)
          OR (c.frequency = 'day' AND DATE(i.inspected_at) = CURDATE())
        )`,
    [Number(modelId), Number(machineId), shift]
  );
  return new Set(rows.map((r) => r.checkpoint_id));
};

// ── เกณฑ์ Cp/Cpk ของ item (ลูกค้า + override) ─────────────────────────────
//
// คืนผลที่เลือกแล้ว (resolveTargets) ไม่ใช่แถวดิบ — ลำดับ fallback ต้องมีที่เดียว
// item ที่หาไม่เจอได้ค่าระบบ (ผลเดียวกับ item ที่ไม่ผูกลูกค้า) ไม่ throw
// เพราะเกณฑ์เป็นแค่การแสดงผล ไม่ควรทำให้กราฟเปิดไม่ขึ้น
const SELECT_TARGETS = `
  SELECT m.id AS model_id, m.customer_id, m.min_cp, m.min_cpk, m.min_cp_ctf, m.min_cpk_ctf,
         c.name AS customer_name,
         c.min_cp AS cust_min_cp, c.min_cpk AS cust_min_cpk,
         c.min_cp_ctf AS cust_min_cp_ctf, c.min_cpk_ctf AS cust_min_cpk_ctf
    FROM models m
    LEFT JOIN customers c ON c.id = m.customer_id
`;

const fetchModelTargets = async (modelId) => {
  const [rows] = await query(`${SELECT_TARGETS} WHERE m.id = ?`, [Number(modelId)]);
  return resolveTargets(rows[0] ?? {});
};

module.exports = {
  fetchModelTargets,
  buildInspectionFilter,
  fetchCheckpointRows,
  fetchModelRows,
  fetchCheckpoint,
  fetchModelCheckpoints,
  fetchCheckpointBaselines,
  fetchModelBaselines,
  fetchDoneCheckpointIds,
};
