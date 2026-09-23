// backend/routes/master.js — master data ทั้งหมด (division / machine / inspector / model / checkpoint)
'use strict';

const express = require('express');
const { query, execute, withTransaction } = require('../db/pool');
const { fetchModelCheckpoints, fetchModelBaselines } = require('../db/queries');
const { baselineOf } = require('../services/baseline');
const { AppError, wrap } = require('../middleware/errorHandler');

const router = express.Router();

// ชื่อตารางและชื่อคอลัมน์ต่อเข้า SQL ตรง ๆ (parameterize ชื่อคอลัมน์ไม่ได้) จึงต้อง whitelist ทั้งคู่
// ⚠️ เพิ่มฟิลด์ใหม่ที่หน้า MasterSetup ต้องมาเพิ่มที่นี่ด้วยเสมอ ไม่งั้นถูกตอบ 400
const ALLOWED_COLUMNS = {
  divisions:   ['name', 'ipbass_dept'],
  machines:    ['division_id', 'code', 'name', 'is_active'],
  inspectors:  ['emp_code', 'name', 'division_id', 'is_active'],
  models:      ['division_id', 'item_no', 'item_name', 'drawing_no', 'drawing_rev', 'is_active'],
  checkpoints: [
    'model_id', 'seq_no', 'name', 'char_type', 'unit', 'gauge',
    'usl', 'lsl', 'target', 'sample_size', 'is_critical', 'is_active',
  ],
};
const allowedTables = Object.keys(ALLOWED_COLUMNS);

// ⚠️ ตรวจแบบ coerce ไม่ใช่เช็ค typeof — ค่าจาก <Form.Control> มาเป็น string เสมอ
const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));

const pickColumns = (table, data) => {
  const allowed = ALLOWED_COLUMNS[table];
  const keys = Object.keys(data || {});
  return {
    keys: keys.filter((k) => allowed.includes(k)),
    invalid: keys.filter((k) => !allowed.includes(k)),
  };
};

const notifyMasterChanged = (req) => req.app.get('io')?.emit('master_updated');

// ── อ่าน ──────────────────────────────────────────────────────────────────

// ทุกอย่างที่หัวใบตรวจต้องใช้ในคำขอเดียว — หน้า InspectionSheet เปิดมาแล้วยิงทีเดียวจบ
router.get('/lookups', wrap(async (req, res) => {
  const activeOnly = req.query.all !== '1';
  const flag = activeOnly ? ' WHERE is_active = 1' : '';

  const [[divisions], [machines], [inspectors]] = await Promise.all([
    // ipbass_dept ต้องมาด้วย — ฝั่ง client ใช้เลือก dept ตอนยิง MOPLAN
    query('SELECT id, name, ipbass_dept FROM divisions ORDER BY name'),
    query(`SELECT id, division_id, code, name, is_active FROM machines${flag} ORDER BY code`),
    query(`SELECT id, emp_code, name, division_id, is_active FROM inspectors${flag} ORDER BY name`),
  ]);

  res.json({ divisions, machines, inspectors });
}));

router.get('/models', wrap(async (req, res) => {
  const { division_id: divisionId } = req.query;
  const activeOnly = req.query.all !== '1';

  const where = [];
  const params = [];
  if (divisionId) {
    where.push('m.division_id = ?');
    params.push(Number(divisionId));
  }
  if (activeOnly) where.push('m.is_active = 1');

  const [rows] = await query(
    `SELECT m.*, d.name AS division_name,
            (SELECT COUNT(*) FROM checkpoints c WHERE c.model_id = m.id AND c.is_active = 1) AS checkpoint_count,
            -- ใบตรวจที่ยกเลิกไปแล้วของ item นี้ — หน้า Master ใช้โชว์ปุ่ม "ล้างใบที่ยกเลิกแล้ว"
            (SELECT COUNT(*) FROM inspections i
              WHERE i.model_id = m.id AND i.voided_at IS NOT NULL) AS voided_count
       FROM models m
       JOIN divisions d ON d.id = m.division_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.item_no`,
    params
  );
  res.json(rows);
}));

// รุ่นเดียวพร้อมจุดตรวจเรียงตาม seq_no — ใบตรวจใช้เส้นนี้เส้นเดียว
router.get('/models/:id', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);

  const [[model]] = await query(
    `SELECT m.*, d.name AS division_name
       FROM models m JOIN divisions d ON d.id = m.division_id
      WHERE m.id = ?`,
    [Number(req.params.id)]
  );
  if (!model) throw new AppError('ไม่พบ item นี้', 404);

  // ⚠️ baseline ไม่ได้อยู่บนแถว checkpoint แล้ว (แยกรายเครื่องไปอยู่ checkpoint_baselines)
  //    ต้องแนบมาด้วย ไม่งั้นหน้า Master Setup จะโชว์ว่า "ยังไม่ล็อก" ทุกจุดทั้งที่ล็อกไว้แล้ว
  const [checkpoints, baselinesByCheckpoint] = await Promise.all([
    fetchModelCheckpoints(req.params.id, { activeOnly: req.query.all !== '1' }),
    fetchModelBaselines(req.params.id),
  ]);

  res.json({
    model,
    checkpoints: checkpoints.map((cp) => ({
      ...cp,
      baselines: (baselinesByCheckpoint.get(cp.id) ?? []).map(baselineOf),
    })),
  });
}));

// ── เขียน (generic CRUD) ──────────────────────────────────────────────────

router.post('/add', wrap(async (req, res) => {
  const { table, data } = req.body;
  if (!allowedTables.includes(table)) throw new AppError('ตารางไม่ถูกต้อง', 400);

  const { keys, invalid } = pickColumns(table, data);
  if (invalid.length) throw new AppError(`คอลัมน์ไม่ถูกต้อง: ${invalid.join(', ')}`, 400);
  if (!keys.length) throw new AppError('ไม่มีข้อมูลให้บันทึก', 400);

  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const [result] = await execute(sql, keys.map((k) => data[k]));

  notifyMasterChanged(req);
  res.json({ success: true, id: result.insertId });
}));

router.put('/update', wrap(async (req, res) => {
  const { table, id, data } = req.body;
  if (!allowedTables.includes(table)) throw new AppError('ตารางไม่ถูกต้อง', 400);
  if (!isIntLike(id)) throw new AppError('id ไม่ถูกต้อง', 400);

  const { keys, invalid } = pickColumns(table, data);
  if (invalid.length) throw new AppError(`คอลัมน์ไม่ถูกต้อง: ${invalid.join(', ')}`, 400);
  if (!keys.length) throw new AppError('ไม่มีข้อมูลให้แก้ไข', 400);

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  await execute(`UPDATE ${table} SET ${setClause} WHERE id = ?`, [...keys.map((k) => data[k]), Number(id)]);

  // แก้ usl/lsl/sample_size แล้ว baseline เดิมอาจใช้ไม่ได้ — เตือนให้ client รู้ ไม่ลบให้อัตโนมัติ
  const affectsBaseline =
    table === 'checkpoints' && keys.some((k) => k === 'sample_size');

  notifyMasterChanged(req);
  res.json({ success: true, baselineMayBeStale: affectsBaseline });
}));

router.delete('/delete', wrap(async (req, res) => {
  const { table, id } = req.body;
  if (!allowedTables.includes(table)) throw new AppError('ตารางไม่ถูกต้อง', 400);
  if (!isIntLike(id)) throw new AppError('id ไม่ถูกต้อง', 400);

  // FK ของทุกเส้นที่ชี้จากใบตรวจมาหา master เป็น RESTRICT โดยตั้งใจ
  // ลบ master ที่มีใบตรวจอ้างอยู่จะถูก DB ปฏิเสธ แล้ว errorHandler แปลงเป็นข้อความบอกให้ปิดใช้งานแทน
  //
  // สองตารางข้างล่างนับก่อนแล้วบอกทางไปต่อเอง — ข้อความกลาง ๆ จาก errorHandler
  // บอกแค่ว่า "ลบไม่ได้" ซึ่งเป็นทางตัน คนที่เจอไม่รู้ว่าติดกี่ใบและต้องทำอะไรต่อ
  if (table === 'models') {
    const [[counts]] = await query(
      `SELECT COUNT(*) AS total, SUM(voided_at IS NOT NULL) AS voided
         FROM inspections WHERE model_id = ?`,
      [Number(id)]
    );
    const total = Number(counts.total) || 0;
    if (total > 0) {
      const voided = Number(counts.voided) || 0;
      throw new AppError(
        `ลบไม่ได้ — item นี้มีใบตรวจ ${total} ใบ (ยกเลิกไปแล้ว ${voided} ใบ) · ` +
        `ยกเลิกใบที่ไม่ต้องการก่อนแล้วกด "ล้างใบที่ยกเลิกแล้ว" หรือปิดใช้งาน item นี้แทนการลบ`,
        400
      );
    }
  }
  if (table === 'checkpoints') {
    // ⚠️ จุดตรวจที่มีผลตรวจแล้วลบไม่ได้ตลอดกาล และตั้งใจให้เป็นแบบนั้น
    //    ลบทิ้งแล้วใบตรวจเก่าที่เคยบันทึก 5 จุดจะเหลือ 4 กลายเป็นใบที่กรอกไม่ครบย้อนหลัง
    //    ซึ่งคือสิ่งที่ validateSubmission ปฏิเสธไม่ให้เกิดตั้งแต่ตอนบันทึก
    const [[used]] = await query(
      'SELECT COUNT(*) AS n FROM inspection_results WHERE checkpoint_id = ?',
      [Number(id)]
    );
    if (Number(used.n) > 0) {
      throw new AppError(
        `ลบไม่ได้ — จุดตรวจนี้มีผลวัดบันทึกไว้แล้ว ${used.n} ค่า ลบทิ้งจะทำให้ใบตรวจเก่ากลายเป็นใบที่กรอกไม่ครบ · ` +
        'ให้เอาเครื่องหมาย "ใช้งาน" ออกแทน จุดนี้จะไม่โผล่ในใบตรวจใบใหม่แต่ของเก่ายังอ่านได้',
        400
      );
    }
  }

  await execute(`DELETE FROM ${table} WHERE id = ?`, [Number(id)]);

  notifyMasterChanged(req);
  res.json({ success: true });
}));

// ── ลำดับจุดตรวจ ──────────────────────────────────────────────────────────

// สลับ seq_no กับจุดที่อยู่ติดกัน — operator ต้องไล่ตรวจตามลำดับในแบบ ลำดับจึงเป็นข้อมูลจริง
//
// ⚠️ ต้องทำใน transaction และพักค่าไว้ที่เลขชั่วคราวก่อน เพราะมี UNIQUE(model_id, seq_no)
//    ถ้า UPDATE ตรง ๆ ทีละแถวจะชนกันเองกลางคัน
router.put('/checkpoints/:id/move', wrap(async (req, res) => {
  const { id } = req.params;
  const { direction } = req.body;
  if (!isIntLike(id)) throw new AppError('id ไม่ถูกต้อง', 400);
  if (direction !== 'up' && direction !== 'down') throw new AppError("direction ต้องเป็น 'up' หรือ 'down'", 400);

  await withTransaction(async (conn) => {
    const [[current]] = await conn.query('SELECT id, model_id, seq_no FROM checkpoints WHERE id = ?', [Number(id)]);
    if (!current) throw new AppError('ไม่พบจุดตรวจนี้', 404);

    const [[neighbour]] = await conn.query(
      `SELECT id, seq_no FROM checkpoints
        WHERE model_id = ? AND seq_no ${direction === 'up' ? '<' : '>'} ?
        ORDER BY seq_no ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
      [current.model_id, current.seq_no]
    );
    if (!neighbour) throw new AppError('อยู่สุดขอบแล้ว เลื่อนต่อไม่ได้', 400);

    // -1 คือที่พักชั่วคราว ไม่มีแถวจริงใช้เลขติดลบ
    await conn.execute('UPDATE checkpoints SET seq_no = -1 WHERE id = ?', [current.id]);
    await conn.execute('UPDATE checkpoints SET seq_no = ? WHERE id = ?', [current.seq_no, neighbour.id]);
    await conn.execute('UPDATE checkpoints SET seq_no = ? WHERE id = ?', [neighbour.seq_no, current.id]);
  });

  notifyMasterChanged(req);
  res.json({ success: true });
}));

module.exports = router;
module.exports.ALLOWED_COLUMNS = ALLOWED_COLUMNS;
