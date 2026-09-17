// backend/db/queries.js — query ที่ใช้ร่วมกันหลาย route
//
// การดึงค่าวัดของจุดตรวจหนึ่งจุดถูกใช้ทั้งใน charts / reports / baseline
// ถ้าปล่อยให้แต่ละที่เขียน JOIN เอง ตัวกรองจะไม่ตรงกันแล้วกราฟกับรายงานจะไม่ตรงกัน
'use strict';

const { query } = require('./pool');

// สร้าง WHERE จากตัวกรองที่ "ส่งมาจริง" เท่านั้น — ค่าว่างคือไม่กรอง ไม่ใช่กรองด้วยค่าว่าง
//
// ⚠️ วันที่กรองเมื่อได้รับครบทั้ง from และ to เท่านั้น ให้ตรงกับพฤติกรรมเดิมของระบบ
//    ฝั่ง client ต้องใช้เงื่อนไขเดียวกันเป๊ะ ไม่งั้นกรอกวันเดียวแล้วผลไม่ตรงกับที่เห็น
const buildInspectionFilter = (f = {}) => {
  const where = [];
  const params = [];

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

module.exports = {
  buildInspectionFilter,
  fetchCheckpointRows,
  fetchModelRows,
  fetchCheckpoint,
  fetchModelCheckpoints,
};
