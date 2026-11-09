// backend/routes/master.js — master data ทั้งหมด (division / machine / inspector / model / checkpoint)
'use strict';

const express = require('express');
const { query, execute, withTransaction } = require('../db/pool');
const { fetchModelCheckpoints, fetchModelBaselines } = require('../db/queries');
const { baselineOf } = require('../services/baseline');
const { AppError, wrap } = require('../middleware/errorHandler');
const { requireMenu } = require('../middleware/requireLogin');

// generic CRUD เลือกเมนูตามตาราง — item/จุดตรวจ = master.items · ที่เหลือ = master.base
// ⚠️ เพิ่มผู้ตรวจจากหน้าใบตรวจ (ปุ่ม "+ เพิ่มผู้ตรวจใหม่") ใช้สิทธิ์ของเมนูใบตรวจ (inspect) ไม่ใช่ Master
const MENU_OF_TABLE = { models: 'master.items', checkpoints: 'master.items' };
const menuOfTable = (req) => MENU_OF_TABLE[req.body?.table ?? req.query?.table] ?? 'master.base';

const router = express.Router();

// ชื่อตารางและชื่อคอลัมน์ต่อเข้า SQL ตรง ๆ (parameterize ชื่อคอลัมน์ไม่ได้) จึงต้อง whitelist ทั้งคู่
// ⚠️ เพิ่มฟิลด์ใหม่ที่หน้า MasterSetup ต้องมาเพิ่มที่นี่ด้วยเสมอ ไม่งั้นถูกตอบ 400
const ALLOWED_COLUMNS = {
  divisions:   ['name', 'ipbass_dept'],
  machines:    ['division_id', 'code', 'name', 'is_active'],
  inspectors:  ['emp_code', 'name', 'division_id', 'is_active'],
  customers:   ['name', 'min_cp', 'min_cpk', 'min_cp_ctf', 'min_cpk_ctf', 'ocs_rule_set', 'is_active'],
  models:      [
    'division_id', 'item_no', 'item_name', 'drawing_no', 'drawing_rev', 'is_active',
    // min_* NULL = ใช้เกณฑ์ของลูกค้า (ลำดับเลือกอยู่ที่ services/capabilityTarget.js)
    'customer_id', 'min_cp', 'min_cpk', 'min_cp_ctf', 'min_cpk_ctf',
  ],
  checkpoints: [
    'model_id', 'seq_no', 'name', 'char_type', 'unit', 'gauge',
    'usl', 'lsl', 'target', 'sample_size', 'is_critical', 'is_active',
    // frequency = 'shift' | 'day' (จุดไหนต้องกรอกในใบไหน ดู fetchDoneCheckpointIds)
    'frequency', 'characteristic',
    // in_routine = อยู่ในใบตรวจตามรอบไหม (0 = ตรวจเฉพาะหมวด Set up / Last Piece ที่ตั้งไว้)
    'in_routine',
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

// ร่องรอยว่าใครแก้ master — ยังไม่มีตาราง audit ลง console ไว้ก่อน (pm2/nssm เก็บ log ให้)
// ผู้ตรวจที่เพิ่มจากหน้าใบตรวจไม่มี req.user (เส้นเดียวที่ไม่ต้อง login)
const logWrite = (req, action, table, id) =>
  console.log(`[master] ${req.user?.username ?? '(หน้าใบตรวจ ไม่ได้ login)'} ${action} ${table} id=${id}`);

// ⚠️ ทุกเส้นที่เขียนในไฟล์นี้ต้อง login ยกเว้นเพิ่มผู้ตรวจ — ปุ่ม "+ เพิ่มผู้ตรวจใหม่" ที่หน้าใบตรวจ
//    (StationBar → InspectionSheet.addInspector) ต้องใช้ได้โดยไม่ login เพราะหน้าไลน์ไม่มีใคร login
//    ส่วนแก้/ลบผู้ตรวจยังต้อง login เหมือน master อื่น
const isAddInspector = (req) => req.body?.table === 'inspectors';

// ── อ่าน ──────────────────────────────────────────────────────────────────

// ทุกอย่างที่หัวใบตรวจต้องใช้ในคำขอเดียว — หน้า InspectionSheet เปิดมาแล้วยิงทีเดียวจบ
router.get('/lookups', wrap(async (req, res) => {
  const activeOnly = req.query.all !== '1';
  const flag = activeOnly ? ' WHERE is_active = 1' : '';

  const [[divisions], [machines], [inspectors], [customers], [categories]] = await Promise.all([
    // ipbass_dept ต้องมาด้วย — ฝั่ง client ใช้เลือก dept ตอนยิง MOPLAN
    query('SELECT id, name, ipbass_dept FROM divisions ORDER BY name'),
    query(`SELECT id, division_id, code, name, is_active FROM machines${flag} ORDER BY code`),
    query(`SELECT id, emp_code, name, division_id, is_active FROM inspectors${flag} ORDER BY name`),
    query(`SELECT id, name, min_cp, min_cpk, min_cp_ctf, min_cpk_ctf, ocs_rule_set, is_active FROM customers${flag} ORDER BY name`),
    // หมวดการตรวจ (id 1 = ตรวจตามรอบ) — ตัวกรอง ?category= ของ Dashboard/SC/รายงาน และหน้า Set up ใช้
    query(`SELECT id, code, name, description, has_workflow, flow, sort_order, is_active FROM check_categories${flag} ORDER BY sort_order, id`),
  ]);

  res.json({ divisions, machines, inspectors, customers, categories });
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
    `SELECT m.*, d.name AS division_name, cu.name AS customer_name,
            (SELECT COUNT(*) FROM checkpoints c WHERE c.model_id = m.id AND c.is_active = 1) AS checkpoint_count,
            -- ใบตรวจที่ยกเลิกไปแล้วของ item นี้ — หน้า Master ใช้โชว์ปุ่ม "ล้างใบที่ยกเลิกแล้ว"
            (SELECT COUNT(*) FROM inspections i
              WHERE i.model_id = m.id AND i.voided_at IS NOT NULL) AS voided_count
       FROM models m
       JOIN divisions d ON d.id = m.division_id
       LEFT JOIN customers cu ON cu.id = m.customer_id
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
    `SELECT m.*, d.name AS division_name, cu.name AS customer_name
       FROM models m
       JOIN divisions d ON d.id = m.division_id
       LEFT JOIN customers cu ON cu.id = m.customer_id
      WHERE m.id = ?`,
    [Number(req.params.id)]
  );
  if (!model) throw new AppError('ไม่พบ item นี้', 404);

  // ⚠️ baseline ไม่ได้อยู่บนแถว checkpoint แล้ว (แยกรายเครื่องไปอยู่ checkpoint_baselines)
  //    ต้องแนบมาด้วย ไม่งั้นหน้า Master Setup จะโชว์ว่า "ยังไม่ล็อก" ทุกจุดทั้งที่ล็อกไว้แล้ว
  const [checkpoints, baselinesByCheckpoint, [settings]] = await Promise.all([
    fetchModelCheckpoints(req.params.id, { activeOnly: req.query.all !== '1' }),
    fetchModelBaselines(req.params.id),
    query(
      `SELECT s.checkpoint_id, s.category_id, s.stage, s.sample_qty
         FROM checkpoint_category_settings s
         JOIN checkpoints c ON c.id = s.checkpoint_id
        WHERE c.model_id = ?`,
      [Number(req.params.id)]
    ),
  ]);

  res.json({
    model,
    checkpoints: checkpoints.map((cp) => ({
      ...cp,
      baselines: (baselinesByCheckpoint.get(cp.id) ?? []).map(baselineOf),
      // จุดนี้ต้องตรวจในหมวด/ขั้นไหนบ้าง (Set up PD / Set up QC / Last Piece …) — ไม่มีแถว = ไม่ต้องตรวจ
      category_settings: settings
        .filter((x) => x.checkpoint_id === cp.id)
        .map(({ category_id, stage, sample_qty }) => ({ category_id, stage, sample_qty })),
    })),
  });
}));

// ── เขียน (generic CRUD) ──────────────────────────────────────────────────

router.post('/add', requireMenu((req) => (isAddInspector(req) ? 'inspect' : menuOfTable(req))), wrap(async (req, res) => {
  const { table, data } = req.body;
  if (!allowedTables.includes(table)) throw new AppError('ตารางไม่ถูกต้อง', 400);

  const { keys, invalid } = pickColumns(table, data);
  if (invalid.length) throw new AppError(`คอลัมน์ไม่ถูกต้อง: ${invalid.join(', ')}`, 400);
  if (!keys.length) throw new AppError('ไม่มีข้อมูลให้บันทึก', 400);

  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const [result] = await execute(sql, keys.map((k) => data[k]));

  logWrite(req, 'add', table, result.insertId);
  notifyMasterChanged(req);
  res.json({ success: true, id: result.insertId });
}));

router.put('/update', requireMenu(menuOfTable), wrap(async (req, res) => {
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

  logWrite(req, 'update', table, id);
  notifyMasterChanged(req);
  res.json({ success: true, baselineMayBeStale: affectsBaseline });
}));

router.delete('/delete', requireMenu(menuOfTable), wrap(async (req, res) => {
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
  logWrite(req, 'delete', table, id);

  notifyMasterChanged(req);
  res.json({ success: true });
}));

// ── ลำดับจุดตรวจ ──────────────────────────────────────────────────────────

// ── หมวดการตรวจของจุดตรวจ ────────────────────────────────────────────────
// ⚠️ ไม่ผ่าน generic CRUD (ตารางนี้ไม่มี id ที่หน้าเว็บถือไว้ และต้องแทนทั้งชุดใน transaction เดียว)
// ⚠️ หมวด 1 (ตรวจตามรอบ) ไม่ใช้ตาราง checkpoint_category_settings — ใช้ checkpoints.in_routine + sample_size
//    จึงปฏิเสธในรายการ settings · กฎตรวจค่ามีชุดเดียว (settingRows) ใช้ทั้งรายจุดและทั้งตาราง

const loadWorkflowCategories = async () => {
  const [cats] = await query('SELECT id, name, has_workflow FROM check_categories');
  return new Map(cats.map((c) => [c.id, c]));
};

// settings: [{ category_id, stage: 'pd'|'qc', sample_qty }] → แถวพร้อม INSERT · ผิดรูป = AppError 400
const settingRows = (checkpointId, list, catById, label = '') => {
  if (!Array.isArray(list)) throw new AppError(`settings${label} ต้องเป็น array`, 400);
  const seen = new Set();
  return list.map((x) => {
    const cat = catById.get(Number(x.category_id));
    if (!cat || !Number(cat.has_workflow)) throw new AppError(`หมวด id=${x.category_id} ตั้งรายจุดไม่ได้${label}`, 400);
    if (x.stage !== 'pd' && x.stage !== 'qc') throw new AppError(`stage ต้องเป็น pd หรือ qc${label}`, 400);
    const qty = Number(x.sample_qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new AppError(`จำนวนชิ้นของ ${cat.name} ต้องเป็น 1-10${label}`, 400);
    const key = `${cat.id}:${x.stage}`;
    if (seen.has(key)) throw new AppError(`ส่ง ${cat.name} (${x.stage}) ซ้ำ${label}`, 400);
    seen.add(key);
    return [checkpointId, cat.id, x.stage, qty];
  });
};

// ตั้งหมวดของจุดเดียว (แทนทั้งชุดของจุดนี้) — body: { settings: [...] } · array ว่าง = ไม่ตรวจในหมวดไหนเลย
router.put('/checkpoints/:id/categories', requireMenu('master.items'), wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const id = Number(req.params.id);
  const [[cp]] = await query('SELECT id FROM checkpoints WHERE id = ?', [id]);
  if (!cp) throw new AppError('ไม่พบจุดตรวจนี้', 404);
  const rows = settingRows(id, req.body?.settings, await loadWorkflowCategories());

  await withTransaction(async (conn) => {
    await conn.execute('DELETE FROM checkpoint_category_settings WHERE checkpoint_id = ?', [id]);
    if (rows.length) {
      await conn.query('INSERT INTO checkpoint_category_settings (checkpoint_id, category_id, stage, sample_qty) VALUES ?', [rows]);
    }
  });
  logWrite(req, 'ตั้งหมวดการตรวจของ', 'checkpoints', id);
  notifyMasterChanged(req);
  res.json({ success: true, count: rows.length });
}));

// ตารางจุดตรวจ × หมวด ของทั้ง item (หน้า Master) — บันทึกทีเดียวทั้งตาราง
// body: { points: [{ id, in_routine, sample_size, frequency, settings: [...] }] }
//   in_routine/sample_size/frequency = คอลัมน์ "Inspection Record" (ตรวจตามรอบ) · settings = หมวดอื่น (แทนทั้งชุดของจุดนั้น)
// ⚠️ ทุก id ต้องเป็นจุดของ item นี้ · ทั้งหมดใน transaction เดียว
// ⚠️ เปลี่ยน sample_size ของจุดที่มีผลตรวจแล้ว = n ของกราฟเปลี่ยน (buildSubgroups ปฏิเสธการผสม n) → คืนรายชื่อให้เตือน re-baseline
router.put('/models/:id/category-matrix', requireMenu('master.items'), wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const modelId = Number(req.params.id);
  const points = Array.isArray(req.body?.points) ? req.body.points : null;
  if (!points || points.length === 0) throw new AppError('points ต้องเป็น array ที่มีอย่างน้อย 1 จุด', 400);

  const [cps] = await query('SELECT id, name, char_type, sample_size FROM checkpoints WHERE model_id = ?', [modelId]);
  const byId = new Map(cps.map((c) => [c.id, c]));
  const catById = await loadWorkflowCategories();

  const seen = new Set();
  const updates = [];
  const settings = [];
  for (const p of points) {
    const cp = byId.get(Number(p.id));
    if (!cp) throw new AppError(`จุดตรวจ id=${p.id} ไม่ได้อยู่ใน item นี้`, 400);
    if (seen.has(cp.id)) throw new AppError(`ส่งจุด "${cp.name}" ซ้ำ`, 400);
    seen.add(cp.id);
    const label = ` (จุด "${cp.name}")`;
    const inRoutine = p.in_routine ? 1 : 0;
    // attribute มีผลเดียวต่อใบเสมอ — n ของจุด attribute = 1
    const n = cp.char_type === 'attribute' ? 1 : Number(p.sample_size);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new AppError(`จำนวนชิ้นตรวจตามรอบต้องเป็น 1-10${label}`, 400);
    const freq = p.frequency === 'day' ? 'day' : 'shift';
    updates.push({ id: cp.id, inRoutine, n, freq, nChanged: Number(cp.sample_size) !== n, name: cp.name });
    settings.push(...settingRows(cp.id, p.settings ?? [], catById, label));
  }

  // จุดที่ n เปลี่ยนและมีผลตรวจอยู่แล้ว (นับรวมใบที่ยกเลิก — กราฟช่วงเก่ายังอ้าง n เดิม)
  const changed = updates.filter((u) => u.nChanged);
  let staleN = [];
  if (changed.length) {
    const [used] = await query(
      'SELECT DISTINCT checkpoint_id FROM inspection_results WHERE checkpoint_id IN (?)',
      [changed.map((u) => u.id)]
    );
    const usedIds = new Set(used.map((r) => r.checkpoint_id));
    staleN = changed.filter((u) => usedIds.has(u.id)).map((u) => u.name);
  }

  await withTransaction(async (conn) => {
    for (const u of updates) {
      await conn.execute(
        'UPDATE checkpoints SET in_routine = ?, sample_size = ?, frequency = ? WHERE id = ? AND model_id = ?',
        [u.inRoutine, u.n, u.freq, u.id, modelId]
      );
    }
    await conn.query('DELETE FROM checkpoint_category_settings WHERE checkpoint_id IN (?)', [updates.map((u) => u.id)]);
    if (settings.length) {
      await conn.query('INSERT INTO checkpoint_category_settings (checkpoint_id, category_id, stage, sample_qty) VALUES ?', [settings]);
    }
  });
  logWrite(req, 'ตั้งตารางหมวดการตรวจของ', 'models', modelId);
  notifyMasterChanged(req);
  res.json({ success: true, points: updates.length, settings: settings.length, sampleSizeChangedWithData: staleN });
}));

// สลับ seq_no กับจุดที่อยู่ติดกัน — operator ต้องไล่ตรวจตามลำดับในแบบ ลำดับจึงเป็นข้อมูลจริง
//
// ⚠️ ต้องทำใน transaction และพักค่าไว้ที่เลขชั่วคราวก่อน เพราะมี UNIQUE(model_id, seq_no)
//    ถ้า UPDATE ตรง ๆ ทีละแถวจะชนกันเองกลางคัน
router.put('/checkpoints/:id/move', requireMenu('master.items'), wrap(async (req, res) => {
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

// ── สิทธิ์เข้าเมนู (แท็บ "ผู้ใช้ & สิทธิ์") ───────────────────────────────────────
// matrix = { <menu_key>: { GUEST|ADMIN|PD|QC: true|false } } · ช่องที่ล็อก (LOCKED) ส่งมาก็ไม่เปลี่ยน
const menuAccess = require('../services/menuAccess');

router.get('/permissions', requireMenu('master.users'), wrap(async (req, res) => {
  const perms = await menuAccess.loadPermissions();
  const matrix = Object.fromEntries(menuAccess.MENU_KEYS.map((k) => [
    k, Object.fromEntries(menuAccess.ROLES.map((r) => [r, menuAccess.isAllowed(perms, k, r)])),
  ]));
  res.json({
    menus: menuAccess.MENUS.map(({ key, label }) => ({ key, label })),
    roles: menuAccess.ROLES,
    matrix,
    locked: menuAccess.LOCKED,
  });
}));

router.put('/permissions', requireMenu('master.users'), wrap(async (req, res) => {
  const matrix = req.body?.matrix;
  if (!matrix || typeof matrix !== 'object') throw new AppError('matrix ไม่ถูกต้อง', 400);
  const rows = [];
  for (const [key, byRole] of Object.entries(matrix)) {
    if (!menuAccess.MENU_KEYS.includes(key)) throw new AppError(`ไม่รู้จักเมนู "${key}"`, 400);
    for (const [role, v] of Object.entries(byRole ?? {})) {
      if (!menuAccess.ROLES.includes(role)) throw new AppError(`ไม่รู้จัก role "${role}"`, 400);
      if (menuAccess.LOCKED[`${key}:${role}`] !== undefined) continue; // ล็อกไว้ — ข้ามเงียบ ๆ
      rows.push([key, role, v ? 1 : 0]);
    }
  }
  if (rows.length) {
    await query(
      'INSERT INTO menu_permissions (menu_key, role, allowed) VALUES ? ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)',
      [rows]
    );
  }
  menuAccess.clearPermissionCache();
  logWrite(req, 'ตั้งสิทธิ์เมนู', 'menu_permissions', rows.length);
  notifyMasterChanged(req);
  res.json({ success: true, count: rows.length });
}));

// ── หมวดการตรวจ (แท็บ "หมวดการตรวจ") ──────────────────────────────────────────
// ⚠️ ไม่มีลบ — check_jobs / inspections อ้าง id อยู่ ใช้ is_active = 0 แทน
// ⚠️ id 1 (ตรวจตามรอบ) ปิดไม่ได้ และไม่มี flow (ไม่ใช่งานส่งต่อ) · has_workflow ไม่ให้แก้ทุกหมวด
//    (routine = 0 ตายตัว · หมวดที่เพิ่มใหม่ = 1 เสมอ — หมวดตามรอบมีได้หมวดเดียว)
// flow: pd_qc = PD ตรวจ → QC ยืนยัน · pd = PD ตรวจแล้วจบ · qc = QC ตรวจเองตั้งแต่เปิดงาน
const FLOWS = ['pd_qc', 'pd', 'qc'];
const CATEGORY_CODE = /^[a-z][a-z0-9_]{1,29}$/;
const ROUTINE_CATEGORY_ID = 1;

const categoryFields = (b, { isNew }) => {
  const out = {};
  if (isNew || b.name !== undefined) {
    const name = String(b.name ?? '').trim();
    if (!name || name.length > 50) throw new AppError('ชื่อหมวดต้องมี 1-50 ตัวอักษร', 400);
    out.name = name;
  }
  if (b.description !== undefined) {
    const d = String(b.description ?? '').trim();
    if (d.length > 200) throw new AppError('คำอธิบายยาวเกิน 200 ตัวอักษร', 400);
    out.description = d || null;
  }
  if (b.flow !== undefined) {
    if (!FLOWS.includes(b.flow)) throw new AppError('ผู้ตรวจของหมวดต้องเป็น pd_qc / pd / qc', 400);
    out.flow = b.flow;
  }
  if (b.sort_order !== undefined) {
    const n = Number(b.sort_order);
    if (!Number.isInteger(n) || n < 0 || n > 999) throw new AppError('ลำดับต้องเป็น 0-999', 400);
    out.sort_order = n;
  }
  if (b.is_active !== undefined) out.is_active = b.is_active ? 1 : 0;
  return out;
};

router.get('/categories', requireMenu('master.categories'), wrap(async (req, res) => {
  const [rows] = await query(
    `SELECT c.id, c.code, c.name, c.description, c.has_workflow, c.flow, c.sort_order, c.is_active,
            (SELECT COUNT(*) FROM check_jobs j WHERE j.category_id = c.id) AS job_count
       FROM check_categories c ORDER BY c.sort_order, c.id`
  );
  res.json(rows);
}));

router.post('/categories', requireMenu('master.categories'), wrap(async (req, res) => {
  const b = req.body ?? {};
  const code = String(b.code ?? '').trim();
  if (!CATEGORY_CODE.test(code)) throw new AppError('รหัสหมวดต้องเป็นภาษาอังกฤษตัวเล็ก/ตัวเลข/_ 2-30 ตัว ขึ้นต้นด้วยตัวอักษร', 400);
  const f = categoryFields(b, { isNew: true });
  const [r] = await execute(
    `INSERT INTO check_categories (code, name, description, has_workflow, flow, sort_order, is_active)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
    [code, f.name, f.description ?? null, f.flow ?? 'pd_qc', f.sort_order ?? 99, f.is_active ?? 1]
  );
  logWrite(req, 'เพิ่มหมวดการตรวจ', 'check_categories', r.insertId);
  notifyMasterChanged(req);
  res.json({ success: true, id: r.insertId });
}));

router.put('/categories/:id', requireMenu('master.categories'), wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const id = Number(req.params.id);
  const [[cat]] = await query('SELECT id FROM check_categories WHERE id = ?', [id]);
  if (!cat) throw new AppError('ไม่พบหมวดนี้', 404);
  const f = categoryFields(req.body ?? {}, { isNew: false });
  if (id === ROUTINE_CATEGORY_ID) {
    if (f.is_active === 0) throw new AppError('หมวดตรวจตามรอบปิดไม่ได้ (ใบตรวจ/กราฟ SPC ทั้งระบบใช้หมวดนี้)', 400);
    delete f.flow; // ตรวจตามรอบไม่ใช่งานส่งต่อ PD → QC
  }
  const cols = Object.keys(f);
  if (cols.length === 0) throw new AppError('ไม่มีอะไรให้แก้', 400);
  await execute(
    `UPDATE check_categories SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => f[c]), id]
  );
  logWrite(req, 'แก้หมวดการตรวจ', 'check_categories', id);
  notifyMasterChanged(req);
  res.json({ success: true });
}));

module.exports = router;
module.exports.ALLOWED_COLUMNS = ALLOWED_COLUMNS;
