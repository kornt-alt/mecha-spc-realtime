// backend/routes/master.js — master data ทั้งหมด (division / machine / inspector / model / checkpoint)
'use strict';

const express = require('express');
const { query, execute, withTransaction } = require('../db/pool');
const { fetchModelCheckpoints, fetchModelBaselines } = require('../db/queries');
const { baselineOf } = require('../services/baseline');
const { AppError, wrap } = require('../middleware/errorHandler');
const { requireMenu, userHasRole } = require('../middleware/requireLogin');
const drawingSync = require('../services/drawingSync');

// generic CRUD เลือกเมนูตามตาราง — item/จุดตรวจ = master.items · ที่เหลือ = master.base
// ⚠️ เพิ่มผู้ตรวจจากหน้าใบตรวจ (ปุ่ม "+ เพิ่มผู้ตรวจใหม่") ใช้สิทธิ์ของเมนูใบตรวจ (inspect) ไม่ใช่ Master
const MENU_OF_TABLE = { models: 'master.items', checkpoints: 'master.items' };
const menuOfTable = (req) => MENU_OF_TABLE[req.body?.table ?? req.query?.table] ?? 'master.base';

const router = express.Router();

// ชื่อตารางและชื่อคอลัมน์ต่อเข้า SQL ตรง ๆ (parameterize ชื่อคอลัมน์ไม่ได้) จึงต้อง whitelist ทั้งคู่
// ⚠️ เพิ่มฟิลด์ใหม่ที่หน้า MasterSetup ต้องมาเพิ่มที่นี่ด้วยเสมอ ไม่งั้นถูกตอบ 400
const ALLOWED_COLUMNS = {
  divisions:   ['name', 'ipbass_dept', 'is_active'],
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

  // ⚠️ คอลัมน์ allow_all_items / synced_at + ตาราง machine_items มาจาก db:apply รอบ Drawing sync —
  //    ยังไม่รันก็ต้องไม่ทำให้หน้าใบตรวจพัง (fallback เป็นค่าเดิม: ทุกเครื่องรันได้ทุก item)
  const machinesQuery = query(`SELECT id, division_id, code, name, is_active, allow_all_items, synced_at FROM machines${flag} ORDER BY code`)
    .catch((e) => {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
      return query(`SELECT id, division_id, code, name, is_active, 1 AS allow_all_items, NULL AS synced_at FROM machines${flag} ORDER BY code`);
    });
  const divisionsQuery = query('SELECT id, name, ipbass_dept, is_active FROM divisions ORDER BY name')
    .catch((e) => {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
      return query('SELECT id, name, ipbass_dept, 1 AS is_active FROM divisions ORDER BY name');
    });
  const linksQuery = query('SELECT machine_id, model_id FROM machine_items')
    .catch((e) => { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; return [[]]; });

  const [[divisions], [machines], [inspectors], [customers], [categories], [machineItems]] = await Promise.all([
    // ipbass_dept ต้องมาด้วย — ฝั่ง client ใช้เลือก dept ตอนยิง MOPLAN
    // ⚠️ คืนทุก division (รวมที่ปิด) — เครื่อง/item เดิมยังอ้างอยู่ต้องแสดงชื่อได้ · หน้าเว็บกรองเฉพาะตอนเลือกให้ของใหม่
    //    is_active มาจาก db:apply 2026-11-12 — ยังไม่รัน = ถือว่าเปิดทุกตัว
    divisionsQuery,
    machinesQuery,
    query(`SELECT id, emp_code, name, division_id, is_active FROM inspectors${flag} ORDER BY name`),
    query(`SELECT id, name, min_cp, min_cpk, min_cp_ctf, min_cpk_ctf, ocs_rule_set, is_active FROM customers${flag} ORDER BY name`),
    // หมวดการตรวจ (id 1 = ตรวจตามรอบ) — ตัวกรอง ?category= ของ Dashboard/SC/รายงาน และหน้า Set up ใช้
    query(`SELECT id, code, name, description, has_workflow, flow, sort_order, is_active FROM check_categories${flag} ORDER BY sort_order, id`),
    linksQuery,
  ]);

  // machineItems = [[machine_id, model_id]] (เครื่อง allow_all_items = 0 เท่านั้นที่มีแถว) · drawingSync = เปิดฟีเจอร์ดึงจาก Drawing ไหม
  res.json({
    divisions, machines, inspectors, customers, categories,
    machineItems: machineItems.map((l) => [l.machine_id, l.model_id]),
    drawingSync: drawingSync.enabled(),
  });
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

// ── ลบ master: ดูผลกระทบก่อน · ปิดใช้งาน (soft) หรือ ลบถาวรพร้อมใบที่อ้าง (force) ───────────────
//
// FK ของทุกเส้นที่ชี้จากใบตรวจมาหา master เป็น RESTRICT โดยตั้งใจ — หลักฐานการตรวจต้องไม่หายเพราะมีคนลบ master
// ค่าเริ่มของหน้าเว็บจึงเป็น "ปิดใช้งาน" (is_active = 0 ผ่าน PUT /update) · ลบถาวรพร้อมใบ = ADMIN + พิมพ์ชื่อยืนยัน
// (Korn สั่ง 2026-11-12: "ให้โปรแกรมบอกได้มั้ยว่าใบอะไรที่ค้างอยู่ ให้เลือกเป็น soft delete และลบจริงได้")
//
// ⚠️ จุดตรวจที่มีผลวัด: ลบถาวร = ลบ "ทั้งใบ" ที่มีจุดนี้ ไม่ใช่ลบแค่แถวผล — ลบแค่แถวผลใบเก่าจะกลายเป็นใบที่กรอกไม่ครบ
//    (สิ่งที่ validateSubmission ปฏิเสธไม่ให้เกิดตั้งแต่ตอนบันทึก)
// ⚠️ Division ที่ยังมีเครื่อง/ผู้ตรวจ/item ลบถาวรไม่ได้ (ไม่ cascade ลบ master ทั้ง division) — ปิดใช้งานได้
const REF_LIMIT = 50;
const LABEL_SQL = {
  divisions: 'SELECT name AS label, is_active FROM divisions WHERE id = ?',
  machines: "SELECT CONCAT(code, ' — ', name) AS label, is_active FROM machines WHERE id = ?",
  inspectors: 'SELECT name AS label, is_active FROM inspectors WHERE id = ?',
  customers: 'SELECT name AS label, is_active FROM customers WHERE id = ?',
  models: 'SELECT item_no AS label, is_active FROM models WHERE id = ?',
  checkpoints: 'SELECT name AS label, is_active FROM checkpoints WHERE id = ?',
};
// ใบตรวจ / งาน Set up ที่อ้าง master นี้ — คืน { where, params } ต่อท้าย FROM inspections i / check_jobs j
const inspectionRef = (table, id) => ({
  models: { where: 'i.model_id = ?', params: [id] },
  machines: { where: 'i.machine_id = ?', params: [id] },
  inspectors: { where: 'i.inspector_id = ?', params: [id] },
  checkpoints: { where: 'i.id IN (SELECT DISTINCT inspection_id FROM inspection_results WHERE checkpoint_id = ?)', params: [id] },
}[table] ?? null);
const jobRef = (table, id) => ({
  models: { where: 'j.model_id = ?', params: [id] },
  machines: { where: 'j.machine_id = ?', params: [id] },
}[table] ?? null);

// divisions.is_active มาจาก db:apply รอบนี้ — ยังไม่รัน = ถือว่าเปิดอยู่ (ปิดไม่ได้จนกว่าจะรัน)
const loadTarget = async (q, table, id) => {
  try {
    const [[row]] = await q(LABEL_SQL[table], [id]);
    return row ? { label: String(row.label), isActive: Number(row.is_active) === 1, softDelete: true } : null;
  } catch (e) {
    if (e.code !== 'ER_BAD_FIELD_ERROR' || table !== 'divisions') throw e;
    const [[row]] = await q('SELECT name AS label FROM divisions WHERE id = ?', [id]);
    return row ? { label: String(row.label), isActive: true, softDelete: false } : null;
  }
};

const deleteImpact = async (table, id) => {
  const target = await loadTarget(query, table, id);
  if (!target) throw new AppError('ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)', 404);
  const out = {
    table, id, ...target,
    refs: { inspections: { total: 0, voided: 0, models: [], list: [] }, checkJobs: { total: 0, open: 0, list: [] } },
    children: [], blockedReason: null,
  };
  const ir = inspectionRef(table, id);
  if (ir) {
    const [[c]] = await query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(i.voided_at IS NOT NULL), 0) AS voided FROM inspections i WHERE ${ir.where}`, ir.params
    );
    const [list] = await query(
      `SELECT i.id, i.inspected_at, i.mo_no, i.overall_result, i.voided_at, i.model_id,
              m.item_no, mc.code AS machine, cc.name AS category
         FROM inspections i
         JOIN models m ON m.id = i.model_id
         LEFT JOIN machines mc ON mc.id = i.machine_id
         LEFT JOIN check_categories cc ON cc.id = i.category_id
        WHERE ${ir.where} ORDER BY i.inspected_at DESC, i.id DESC LIMIT ${REF_LIMIT}`, ir.params
    );
    const [models] = await query(
      `SELECT DISTINCT m.id, m.item_no FROM inspections i JOIN models m ON m.id = i.model_id WHERE ${ir.where} ORDER BY m.item_no`, ir.params
    );
    out.refs.inspections = { total: Number(c.total), voided: Number(c.voided), models, list };
  }
  const jr = jobRef(table, id);
  if (jr) {
    const [[c]] = await query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(j.status NOT IN ('passed','cancelled')), 0) AS open FROM check_jobs j WHERE ${jr.where}`, jr.params
    );
    const [list] = await query(
      `SELECT j.id, j.mo_no, j.status, j.round_no, j.opened_at, m.item_no, mc.code AS machine, cc.name AS category
         FROM check_jobs j
         JOIN models m ON m.id = j.model_id
         LEFT JOIN machines mc ON mc.id = j.machine_id
         LEFT JOIN check_categories cc ON cc.id = j.category_id
        WHERE ${jr.where} ORDER BY j.opened_at DESC, j.id DESC LIMIT ${REF_LIMIT}`, jr.params
    );
    out.refs.checkJobs = { total: Number(c.total), open: Number(c.open), list };
  }
  const count = async (sql) => Number((await query(sql, [id]))[0][0].n);
  if (table === 'models') {
    const n = await count('SELECT COUNT(*) AS n FROM checkpoints WHERE model_id = ?');
    if (n) out.children.push(`จุดตรวจ ${n} จุด (ถูกลบไปด้วย)`);
  }
  if (table === 'inspectors') {
    const n = await count('SELECT COUNT(*) AS n FROM users WHERE inspector_id = ?');
    if (n) out.children.push(`บัญชีผู้ใช้ที่ผูกผู้ตรวจนี้ ${n} บัญชี (จะถูกถอดผูก — PD/QC ต้องผูกใหม่ก่อนตรวจ)`);
  }
  if (table === 'customers') {
    const n = await count('SELECT COUNT(*) AS n FROM models WHERE customer_id = ?');
    if (n) out.children.push(`item ที่ตั้งลูกค้านี้ ${n} ตัว (จะเป็น "ไม่มีลูกค้า" — เกณฑ์ Cp/Cpk กลับเป็นค่าระบบ)`);
  }
  if (table === 'machines') {
    const n = await count('SELECT COUNT(*) AS n FROM checkpoint_baselines WHERE machine_id = ?');
    if (n) out.children.push(`baseline ที่ล็อกไว้ของเครื่องนี้ ${n} ชุด (ถูกลบไปด้วย)`);
  }
  if (table === 'divisions') {
    const parts = [];
    for (const [t, name] of [['machines', 'เครื่องจักร'], ['inspectors', 'ผู้ตรวจ'], ['models', 'item']]) {
      const n = await count(`SELECT COUNT(*) AS n FROM ${t} WHERE division_id = ?`);
      if (n) parts.push(`${name} ${n}`);
    }
    if (parts.length) {
      out.children.push(`ใน division นี้มี ${parts.join(' · ')}`);
      out.blockedReason = `ลบถาวรไม่ได้ — ยังมี ${parts.join(' · ')} อยู่ใน division นี้ ต้องลบหรือย้ายออกก่อน (ปิดใช้งานได้)`;
    }
  }
  return out;
};

router.get('/delete-impact', requireMenu(menuOfTable), wrap(async (req, res) => {
  const { table, id } = req.query;
  if (!allowedTables.includes(table)) throw new AppError('ตารางไม่ถูกต้อง', 400);
  if (!isIntLike(id)) throw new AppError('id ไม่ถูกต้อง', 400);
  res.json(await deleteImpact(table, Number(id)));
}));

// body: { table, id, force?, confirm? }
//   ไม่ force = ลบเมื่อไม่มีใครอ้าง (มีใบ/งานอ้าง = 409 · ที่เหลือ DB ตัดสินด้วย FK RESTRICT)
//   force = ADMIN เท่านั้น + confirm ต้องตรงชื่อ → ลบใบตรวจ/งาน Set up ที่อ้าง + ตาม แล้วลบ master ใน transaction เดียว
// ⚠️ ไม่ล้าง baseline ของ item อื่นให้เอง — ใบที่ถูกลบอาจอยู่ในช่วงที่ล็อกไว้ คืน staleBaselines ให้หน้าเว็บเตือน
router.delete('/delete', requireMenu(menuOfTable), wrap(async (req, res) => {
  const { table, id, force, confirm } = req.body ?? {};
  if (!allowedTables.includes(table)) throw new AppError('ตารางไม่ถูกต้อง', 400);
  if (!isIntLike(id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const rowId = Number(id);
  const impact = await deleteImpact(table, rowId);
  const nIns = impact.refs.inspections.total;
  const nJobs = impact.refs.checkJobs.total;

  if (!force) {
    if (nIns || nJobs) {
      throw new AppError(
        `ลบไม่ได้ — มีใบตรวจ ${nIns} ใบ${nJobs ? ` และงาน Set up ${nJobs} งาน` : ''} อ้างอยู่ · ปิดใช้งานแทน หรือ ADMIN เลือกลบถาวรพร้อมใบพวกนี้`,
        409
      );
    }
    await execute(`DELETE FROM ${table} WHERE id = ?`, [rowId]);
    logWrite(req, 'delete', table, rowId);
    notifyMasterChanged(req);
    return res.json({ success: true, deletedInspections: 0, deletedJobs: 0, staleBaselines: [] });
  }

  if (!userHasRole(req.user, 'ADMIN')) throw new AppError('ลบถาวรพร้อมใบตรวจได้เฉพาะ ADMIN', 403);
  if (String(confirm ?? '').trim().toLowerCase() !== impact.label.trim().toLowerCase()) {
    throw new AppError(`พิมพ์ "${impact.label}" ให้ตรงเพื่อยืนยันการลบถาวร`, 400);
  }
  if (impact.blockedReason) throw new AppError(impact.blockedReason, 409);

  const ir = inspectionRef(table, rowId);
  const jr = jobRef(table, rowId);
  const result = await withTransaction(async (conn) => {
    let affected = [];
    let deletedInspections = 0;
    let deletedJobs = 0;
    if (ir) {
      // เลือก id ก่อนแล้วค่อยลบ (MariaDB ไม่ให้ DELETE อ้างตารางตัวเองใน subquery)
      const [rows] = await conn.query(`SELECT i.id, i.model_id FROM inspections i WHERE ${ir.where} FOR UPDATE`, ir.params);
      affected = [...new Set(rows.map((r) => r.model_id))];
      if (rows.length) {
        const [r] = await conn.query('DELETE FROM inspections WHERE id IN (?)', [rows.map((x) => x.id)]);
        deletedInspections = r.affectedRows;
      }
    }
    if (jr) {
      const [rows] = await conn.query(`SELECT j.id FROM check_jobs j WHERE ${jr.where} FOR UPDATE`, jr.params);
      if (rows.length) {
        const [r] = await conn.query('DELETE FROM check_jobs WHERE id IN (?)', [rows.map((x) => x.id)]);
        deletedJobs = r.affectedRows;
      }
    }
    if (table === 'machines') await conn.execute('DELETE FROM checkpoint_baselines WHERE machine_id = ?', [rowId]);
    if (table === 'inspectors') await conn.execute('UPDATE users SET inspector_id = NULL WHERE inspector_id = ?', [rowId]);
    if (table === 'customers') await conn.execute('UPDATE models SET customer_id = NULL WHERE customer_id = ?', [rowId]);
    await conn.execute(`DELETE FROM ${table} WHERE id = ?`, [rowId]);
    return { affected, deletedInspections, deletedJobs };
  });

  // item ที่โดนลบใบ (และยังอยู่) ที่มี baseline ล็อก = เส้นลิมิตอาจมาจากข้อมูลที่หายไป
  const survivors = result.affected.filter((m) => !(table === 'models' && m === rowId));
  let staleBaselines = [];
  if (survivors.length) {
    const [rows] = await query(
      `SELECT DISTINCT m.id, m.item_no FROM checkpoint_baselines b
         JOIN checkpoints c ON c.id = b.checkpoint_id JOIN models m ON m.id = c.model_id
        WHERE m.id IN (?) ORDER BY m.item_no`, [survivors]
    );
    staleBaselines = rows;
  }
  logWrite(req, `ลบถาวร (ใบตรวจ ${result.deletedInspections} ใบ · งาน ${result.deletedJobs} งาน)`, table, rowId);
  const io = req.app.get('io');
  for (const modelId of result.affected) {
    io?.to(`model:${modelId}`).emit('inspection_saved', {
      modelId, machineId: null, purged: result.deletedInspections, checkpointIds: [], ngCheckpointIds: [],
    });
  }
  if (result.deletedJobs) io?.emit('check_job_updated', { action: 'deleted' });
  notifyMasterChanged(req);
  res.json({ success: true, ...result, staleBaselines });
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
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new AppError(`จำนวนชิ้น Regular time ต้องเป็น 1-10${label}`, 400);
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
    if (f.is_active === 0) throw new AppError('หมวด Regular time ปิดไม่ได้ (ใบตรวจ/กราฟ SPC ทั้งระบบใช้หมวดนี้)', 400);
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

// ── ตั้งจุดตรวจทีละหลายจุด (หน้า Master: วางจาก Excel / นำเข้าไฟล์ / คัดลอกจาก item อื่น) ─────────
// ⚠️ ทุกทางเข้าจบที่ POST /models/:id/checkpoints/bulk เส้นเดียว — parse ไม่เขียน DB (หน้าเว็บโชว์ให้ตรวจก่อน)
const { parseWorkbook, buildTemplate } = require('../services/checkpointImport');

const SPEC_COLUMNS = ['usl', 'lsl', 'target'];
const strOrNull = (v, max) => {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t ? t.slice(0, max) : null;
};

// แถวเดียว → ค่าที่พร้อม INSERT · ผิด = AppError 400 (label บอกว่าแถวไหน) — กฎเดียวกับฟอร์มจุดตรวจ (submitCp)
const bulkPoint = (p, label) => {
  const name = strOrNull(p?.name, 150);
  if (!name) throw new AppError(`ต้องมีชื่อจุดตรวจ${label}`, 400);
  if (p.char_type && !['variable', 'attribute'].includes(p.char_type)) throw new AppError(`ชนิดต้องเป็น variable หรือ attribute${label}`, 400);
  const charType = p.char_type === 'attribute' ? 'attribute' : 'variable';
  const isAttr = charType === 'attribute';
  const spec = {};
  for (const k of SPEC_COLUMNS) {
    const v = p[k];
    if (isAttr || v === null || v === undefined || v === '') { spec[k] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n)) throw new AppError(`${k.toUpperCase()} ต้องเป็นตัวเลข${label}`, 400);
    spec[k] = n;
  }
  // สเปกกลับหัว = ทุกชิ้นเป็น NG และ judgment ถูก snapshot ลงใบตรวจ แก้ย้อนหลังไม่ได้
  if (spec.lsl !== null && spec.usl !== null && spec.lsl > spec.usl) throw new AppError(`LSL มากกว่า USL${label}`, 400);
  const n = isAttr ? 1 : Number(p.sample_size);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new AppError(`ชิ้น/ครั้ง ต้องเป็น 1-10${label}`, 400);
  return {
    name,
    char_type: charType,
    unit: isAttr ? null : strOrNull(p.unit, 20),
    gauge: strOrNull(p.gauge, 100),
    characteristic: strOrNull(p.characteristic, 64),
    ...spec,
    sample_size: n,
    frequency: p.frequency === 'day' ? 'day' : 'shift',
    is_critical: p.is_critical ? 1 : 0,
    in_routine: p.in_routine === undefined || p.in_routine === null ? 1 : (p.in_routine ? 1 : 0),
  };
};

// body: { points: [{ name, char_type, unit, gauge, characteristic, usl, lsl, target, sample_size, frequency,
//                    is_critical, in_routine, settings: [{ category_id, stage, sample_qty }] }],
//         mode: 'add' | 'upsert' | 'replace' }  (เดิม deactivateExisting: true = replace — ยังรับอยู่)
//   add     = เพิ่มต่อท้าย (seq_no) · ชื่อซ้ำจุดที่เปิดอยู่ = 409 ทั้งชุด (กันนำเข้าไฟล์เดิมสองรอบ)
//   upsert  = ชื่อตรงจุดที่เปิดอยู่ (trim + ไม่สนตัวพิมพ์) → UPDATE จุดนั้น (id/seq_no/ผลตรวจ/baseline คงเดิม)
//             + แทน category settings ของจุดนั้น · ชื่อใหม่ = เพิ่มต่อท้าย · จุดที่ไม่อยู่ในชุด = ไม่แตะ
//             ⚠️ แต่ละแถวต้องเป็นค่าเต็ม (หน้าเว็บ merge จุดเดิมกับช่องที่วางมาให้แล้ว — utils/checkpointBulk.js mergeOnto)
//   replace = ปิดใช้งานจุดเดิมทั้งหมด (ไม่ลบ — จุดที่มีผลวัดแล้วต้องอยู่เป็นหลักฐาน) แล้วเพิ่มชุดนี้
// ซ้ำกันเองในชุด = 409 ทุกโหมด · ทั้งหมดใน transaction เดียว
// ⚠️ เปลี่ยน sample_size ของจุดเดิม = คืน baselineMayBeStale (กฎเดียวกับ PUT /update) — ห้ามล้าง baseline ให้เอง
const BULK_MODES = ['add', 'upsert', 'replace'];
router.post('/models/:id/checkpoints/bulk', requireMenu('master.items'), wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const modelId = Number(req.params.id);
  const list = Array.isArray(req.body?.points) ? req.body.points : null;
  if (!list || list.length === 0) throw new AppError('ไม่มีจุดตรวจให้บันทึก', 400);
  if (list.length > 300) throw new AppError('บันทึกได้ครั้งละไม่เกิน 300 จุด', 400);
  const mode = req.body?.mode ?? (req.body?.deactivateExisting ? 'replace' : 'add');
  if (!BULK_MODES.includes(mode)) throw new AppError('mode ต้องเป็น add / upsert / replace', 400);

  const [[model]] = await query('SELECT id FROM models WHERE id = ?', [modelId]);
  if (!model) throw new AppError('ไม่พบ item นี้', 404);
  const catById = await loadWorkflowCategories();
  const points = prepareBulkPoints(list, catById);

  const result = await withTransaction((conn) => upsertCheckpoints(conn, modelId, points, mode));
  logWrite(req, `เพิ่มจุดตรวจ ${result.ids.length} จุด / แก้ ${result.updatedIds.length} จุด ให้`, 'models', modelId);
  notifyMasterChanged(req);
  res.json({
    success: true,
    added: result.ids.length,
    ids: result.ids,
    updated: result.updatedIds.length,
    updatedIds: result.updatedIds,
    deactivated: result.deactivated,
    baselineMayBeStale: result.baselineMayBeStale,
  });
}));

// แถวดิบจาก client → แถวที่ตรวจแล้ว (bulkPoint + settings) · ชื่อซ้ำกันเองในชุด = 409
// labelPrefix ไว้บอกว่าเป็นของ item ไหน (นำเข้าหลาย item)
const prepareBulkPoints = (list, catById, labelPrefix = '') => {
  const points = list.map((p, i) => {
    const label = ` (${labelPrefix}แถว ${i + 1}${p?.name ? ` "${String(p.name).trim()}"` : ''})`;
    const row = bulkPoint(p, label);
    // ตรวจรูป settings ก่อนเข้า transaction (checkpoint_id ยังไม่มี — ใส่ 0 ไว้ก่อน)
    row.settings = settingRows(0, p.settings ?? [], catById, label).map(([, cat, stage, qty]) => [cat, stage, qty]);
    return row;
  });
  const seenNames = new Set();
  for (const p of points) {
    const key = p.name.toLowerCase();
    if (seenNames.has(key)) throw new AppError(`ชื่อจุด "${p.name}" ซ้ำกันในชุดที่ส่งมา${labelPrefix ? ` (${labelPrefix.trim()})` : ''}`, 409);
    seenNames.add(key);
  }
  return points;
};

// เขียนจุดตรวจชุดหนึ่งของ item เดียว (ใน transaction ของผู้เรียก) — ใช้ทั้ง /models/:id/checkpoints/bulk และ /items/bulk
// ⚠️ แก้กฎ add/upsert/replace ที่นี่ที่เดียว
const upsertCheckpoints = async (conn, modelId, points, mode) => {
  const deactivateExisting = mode === 'replace';
  {
    const [existing] = await conn.query(
      'SELECT id, name, seq_no, is_active, sample_size FROM checkpoints WHERE model_id = ? FOR UPDATE', [modelId]
    );
    // ชื่อของจุดที่เปิดอยู่ → แถว (ชื่อซ้ำในจุดที่เปิดอยู่เอง = เอาตัวแรกตาม seq — ไม่ควรมี)
    const activeByName = new Map();
    for (const c of [...existing].sort((a, b) => a.seq_no - b.seq_no)) {
      const k = c.name.trim().toLowerCase();
      if (c.is_active && !activeByName.has(k)) activeByName.set(k, c);
    }
    if (mode === 'add') {
      const dup = points.filter((p) => activeByName.has(p.name.toLowerCase()));
      if (dup.length) {
        throw new AppError(`มีจุดชื่อนี้เปิดใช้งานอยู่แล้ว: ${dup.map((p) => p.name).join(', ')} — เปลี่ยนชื่อ หรือเลือก "อัปเดตจุดเดิม"`, 409);
      }
    }
    let deactivated = 0;
    if (deactivateExisting) {
      const [r] = await conn.execute('UPDATE checkpoints SET is_active = 0 WHERE model_id = ? AND is_active = 1', [modelId]);
      deactivated = r.affectedRows;
    }
    // upsert: แก้จุดเดิมก่อน (ไม่แตะ seq_no / is_active) แล้วที่เหลือไปเพิ่ม
    const updatedIds = [];
    const baselineMayBeStale = [];
    const toInsert = [];
    for (const p of points) {
      const cur = mode === 'upsert' ? activeByName.get(p.name.toLowerCase()) : null;
      if (!cur) { toInsert.push(p); continue; }
      await conn.execute(
        `UPDATE checkpoints SET name = ?, char_type = ?, unit = ?, gauge = ?, usl = ?, lsl = ?, target = ?,
                sample_size = ?, frequency = ?, characteristic = ?, is_critical = ?, in_routine = ?
          WHERE id = ? AND model_id = ?`,
        [p.name, p.char_type, p.unit, p.gauge, p.usl, p.lsl, p.target, p.sample_size, p.frequency,
          p.characteristic, p.is_critical, p.in_routine, cur.id, modelId]
      );
      await conn.execute('DELETE FROM checkpoint_category_settings WHERE checkpoint_id = ?', [cur.id]);
      if (p.settings.length) {
        await conn.query(
          'INSERT INTO checkpoint_category_settings (checkpoint_id, category_id, stage, sample_qty) VALUES ?',
          [p.settings.map((s) => [cur.id, ...s])]
        );
      }
      updatedIds.push(cur.id);
      if (Number(cur.sample_size) !== p.sample_size) baselineMayBeStale.push({ id: cur.id, name: p.name });
    }
    let seq = existing.reduce((m, c) => Math.max(m, c.seq_no), 0);
    const ids = [];
    for (const p of toInsert) {
      seq += 1;
      const [r] = await conn.execute(
        `INSERT INTO checkpoints
           (model_id, seq_no, name, char_type, unit, gauge, usl, lsl, target, sample_size, frequency,
            characteristic, is_critical, is_active, in_routine)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [modelId, seq, p.name, p.char_type, p.unit, p.gauge, p.usl, p.lsl, p.target, p.sample_size, p.frequency,
          p.characteristic, p.is_critical, p.in_routine]
      );
      ids.push(r.insertId);
      if (p.settings.length) {
        await conn.query(
          'INSERT INTO checkpoint_category_settings (checkpoint_id, category_id, stage, sample_qty) VALUES ?',
          [p.settings.map((s) => [r.insertId, ...s])]
        );
      }
    }
    return { ids, deactivated, updatedIds, baselineMayBeStale };
  }
};

// ทำกับจุดตรวจหลายจุดที่ติ๊กเลือก — body: { ids: [...], action: 'activate' | 'deactivate' | 'delete' }
// ⚠️ delete ลบเฉพาะจุดที่ยังไม่มีผลตรวจ — จุดที่มีผลแล้ว "ข้าม" (คืนใน skipped) ไม่ลบใบตรวจตาม
//    ลบพร้อมใบต้องทำทีละจุดผ่านกล่องลบ (DeleteMasterModal · ADMIN + พิมพ์ชื่อ) · ทั้งหมดใน transaction เดียว
router.post('/models/:id/checkpoints/batch', requireMenu('master.items'), wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const modelId = Number(req.params.id);
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number))] : [];
  const action = req.body?.action;
  if (!ids.length || ids.some((x) => !Number.isInteger(x))) throw new AppError('ids ต้องเป็น array ของ id จุดตรวจ', 400);
  if (!['activate', 'deactivate', 'delete'].includes(action)) throw new AppError('action ต้องเป็น activate / deactivate / delete', 400);

  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT id, name FROM checkpoints WHERE model_id = ? AND id IN (?) FOR UPDATE', [modelId, ids]);
    if (rows.length !== ids.length) throw new AppError('มีจุดที่ไม่ใช่ของ item นี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง', 409);
    if (action !== 'delete') {
      const [r] = await conn.query('UPDATE checkpoints SET is_active = ? WHERE id IN (?)', [action === 'activate' ? 1 : 0, ids]);
      return { changed: r.affectedRows, skipped: [] };
    }
    const [used] = await conn.query('SELECT DISTINCT checkpoint_id FROM inspection_results WHERE checkpoint_id IN (?)', [ids]);
    const usedIds = new Set(used.map((u) => u.checkpoint_id));
    const free = ids.filter((x) => !usedIds.has(x));
    if (free.length) {
      await conn.query('DELETE FROM checkpoint_baselines WHERE checkpoint_id IN (?)', [free]);
      await conn.query('DELETE FROM checkpoints WHERE id IN (?)', [free]);
    }
    return { changed: free.length, skipped: rows.filter((r) => usedIds.has(r.id)) };
  });
  logWrite(req, `${action} จุดตรวจ ${result.changed} จุด (ข้าม ${result.skipped.length}) ของ`, 'models', modelId);
  notifyMasterChanged(req);
  res.json({ success: true, action, ...result });
}));

// เรียงจุดตรวจทั้ง item ใหม่ (ลากเรียงในหน้า Master) — body: { ids: [ลำดับใหม่ ครบทุกจุดของ item] }
// ⚠️ UNIQUE(model_id, seq_no) — ย้ายไปเลขติดลบชั่วคราวก่อนแล้วค่อยเขียน 1..n (หลักเดียวกับ /checkpoints/:id/move)
router.put('/models/:id/checkpoints/order', requireMenu('master.items'), wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const modelId = Number(req.params.id);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
  if (!ids || ids.length === 0 || ids.some((x) => !Number.isInteger(x))) throw new AppError('ids ต้องเป็น array ของ id จุดตรวจ', 400);
  if (new Set(ids).size !== ids.length) throw new AppError('ids มีจุดซ้ำ', 400);

  await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT id FROM checkpoints WHERE model_id = ? FOR UPDATE', [modelId]);
    const own = new Set(rows.map((r) => r.id));
    if (rows.length !== ids.length || ids.some((x) => !own.has(x))) {
      throw new AppError('ลำดับที่ส่งมาไม่ครบหรือมีจุดของ item อื่น — โหลดหน้าใหม่แล้วลองอีกครั้ง', 409);
    }
    await conn.query('UPDATE checkpoints SET seq_no = -seq_no - 1000 WHERE model_id = ?', [modelId]);
    for (let i = 0; i < ids.length; i += 1) {
      await conn.execute('UPDATE checkpoints SET seq_no = ? WHERE id = ? AND model_id = ?', [i + 1, ids[i], modelId]);
    }
  });
  logWrite(req, 'เรียงลำดับจุดตรวจของ', 'models', modelId);
  notifyMasterChanged(req);
  res.json({ success: true });
}));

// อ่านไฟล์ Excel ที่ลากมาวาง (ไม่เขียน DB) — body = ไฟล์ดิบ (application/octet-stream)
// ใบ SET UP → จุดพร้อมค่า Set up PD/QC · ไฟล์ตาราง/แม่แบบ → ตารางข้อความ (หน้าเว็บแมปหัวคอลัมน์เอง)
router.post(
  '/models/:id/import/parse',
  requireMenu('master.items'),
  express.raw({ type: () => true, limit: '5mb' }),
  wrap(async (req, res) => {
    if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new AppError('ไม่ได้รับไฟล์', 400);
    const [[model]] = await query('SELECT id, item_no FROM models WHERE id = ?', [Number(req.params.id)]);
    if (!model) throw new AppError('ไม่พบ item นี้', 404);

    const r = await parseWorkbook(req.body);
    if (!r.format) throw new AppError(r.reason, 400);
    if (r.format === 'table') return res.json({ format: 'table', rows: r.rows });

    const [[setup]] = await query("SELECT id FROM check_categories WHERE code = 'setup'");
    const warnings = [];
    if (r.itemNo && String(model.item_no).trim() !== r.itemNo) {
      warnings.push(`Item No ในใบ (${r.itemNo}) ไม่ตรงกับ item ที่เลือก (${model.item_no})`);
    }
    if (!setup) warnings.push('ไม่พบหมวด Set up ในระบบ — จำนวนชิ้นของ Set up ไม่ถูกตั้ง');
    res.json({
      format: 'setup',
      itemNo: r.itemNo,
      warnings,
      errors: r.errors,
      points: r.points.map(({ qty, ...p }) => ({
        ...p,
        settings: setup && qty ? [
          { category_id: setup.id, stage: 'pd', sample_qty: qty },
          { category_id: setup.id, stage: 'qc', sample_qty: qty },
        ] : [],
      })),
    });
  })
);

// ไฟล์แม่แบบ (สร้างสด — คอลัมน์หมวดตามที่มีใน DB ตอนนี้)
router.get('/checkpoint-template', requireMenu('master.items'), wrap(async (req, res) => {
  const [cats] = await query('SELECT id, name, has_workflow, flow, is_active FROM check_categories ORDER BY sort_order, id');
  const wb = buildTemplate(cats);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="checkpoint-template.xlsx"; filename*=UTF-8''${encodeURIComponent('แม่แบบจุดตรวจ.xlsx')}`
  );
  await wb.xlsx.write(res);
  res.end();
}));

// จุดตรวจปัจจุบันของ item เป็นไฟล์แม่แบบ (โหลดไปแก้ใน Excel แล้วลากกลับมา = อัปเดตจุดเดิมตามชื่อ)
// เฉพาะจุดที่เปิดใช้งาน เรียงตาม seq_no · ⚠️ item_no sanitize ก่อนตั้งชื่อไฟล์ (กฎเดียวกับ routes/reports.js)
router.get('/models/:id/checkpoints/export', requireMenu('master.items'), wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const modelId = Number(req.params.id);
  const [[model]] = await query('SELECT id, item_no FROM models WHERE id = ?', [modelId]);
  if (!model) throw new AppError('ไม่พบ item นี้', 404);
  const [cats] = await query('SELECT id, name, has_workflow, flow, is_active FROM check_categories ORDER BY sort_order, id');
  const [points] = await query(
    `SELECT id, name, characteristic, char_type, unit, gauge, lsl, target, usl, sample_size, frequency, in_routine, is_critical
       FROM checkpoints WHERE model_id = ? AND is_active = 1 ORDER BY seq_no`, [modelId]
  );
  const [settings] = points.length
    ? await query(
      'SELECT checkpoint_id, category_id, stage, sample_qty FROM checkpoint_category_settings WHERE checkpoint_id IN (?)',
      [points.map((p) => p.id)]
    )
    : [[]];
  for (const p of points) p.settings = settings.filter((s) => s.checkpoint_id === p.id);
  const wb = buildTemplate(cats, points);
  const safeItemNo = String(model.item_no || 'item').replace(/[^\w.-]+/g, '_');
  const fname = `${safeItemNo}-checkpoints.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
  await wb.xlsx.write(res);
  res.end();
}));

// จุดตรวจของ item เป็นใบ "SET UP & LAST PIECE INSPECTION RECORD" (หน้าตาแบบใบจริง — services/setupSheetExport.js)
// จำนวนชิ้น = ที่ตั้งไว้ของหมวด Set up (PD / QC) · ไม่ได้ตั้ง = sample_size · ลากกลับมาที่การ์ดจุดตรวจได้ (ตัวอ่านใบ SET UP เดิม)
// จุดตรวจที่เปิดใช้งาน + จำนวนชิ้นของหมวด Set up (PD/QC) ของหลาย item → Map(model_id → points)
const loadSetupPoints = async (modelIds) => {
  const out = new Map(modelIds.map((id) => [id, []]));
  if (!modelIds.length) return out;
  const [points] = await query(
    `SELECT id, model_id, name, characteristic, char_type, unit, gauge, lsl, target, usl, sample_size, is_critical
       FROM checkpoints WHERE model_id IN (?) AND is_active = 1 ORDER BY model_id, seq_no`, [modelIds]
  );
  const [settings] = points.length
    ? await query(
      `SELECT s.checkpoint_id, s.stage, s.sample_qty FROM checkpoint_category_settings s
         JOIN check_categories c ON c.id = s.category_id
        WHERE c.code = 'setup' AND s.checkpoint_id IN (?)`, [points.map((p) => p.id)]
    )
    : [[]];
  const qty = new Map(settings.map((s) => [`${s.checkpoint_id}:${s.stage}`, s.sample_qty]));
  for (const p of points) {
    p.qty = qty.get(`${p.id}:pd`) ?? null;
    p.qcQty = qty.get(`${p.id}:qc`) ?? null;
    out.get(p.model_id).push(p);
  }
  return out;
};
const safeFile = (v) => String(v || 'item').replace(/[^\w.-]+/g, '_');
const sendXlsx = async (res, wb, fname) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
  await wb.xlsx.write(res);
  res.end();
};

router.get('/models/:id/setup-sheet', requireMenu('master.items'), wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const modelId = Number(req.params.id);
  const [[model]] = await query('SELECT id, item_no, item_name, drawing_no, drawing_rev FROM models WHERE id = ?', [modelId]);
  if (!model) throw new AppError('ไม่พบ item นี้', 404);
  const { buildSetupSheet } = require('../services/setupSheetExport');
  const wb = buildSetupSheet(model, (await loadSetupPoints([modelId])).get(modelId));
  await sendXlsx(res, wb, `${safeFile(model.item_no)}-SET-UP.xlsx`);
}));

// ใบ SET UP ของหลาย item ในไฟล์เดียว (ชีตละ item) — body: { ids: [model id ที่เห็นในลิสต์] } · ข้าม item ที่ไม่มีจุดตรวจ
router.post('/setup-sheets', requireMenu('master.items'), wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number))].filter(Number.isInteger) : [];
  if (!ids.length) throw new AppError('ไม่มี item ให้ดาวน์โหลด', 400);
  if (ids.length > 200) throw new AppError('ดาวน์โหลดใบ SET UP ได้ครั้งละไม่เกิน 200 item — ค้นหาให้แคบลงก่อน', 400);
  const [models] = await query(
    'SELECT id, item_no, item_name, drawing_no, drawing_rev FROM models WHERE id IN (?) ORDER BY item_no', [ids]
  );
  const pts = await loadSetupPoints(models.map((m) => m.id));
  const list = models.map((model) => ({ model, points: pts.get(model.id) })).filter((x) => x.points.length);
  if (!list.length) throw new AppError('item ที่เลือกยังไม่มีจุดตรวจ', 400);
  const { buildSetupWorkbook } = require('../services/setupSheetExport');
  const stampNow = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  await sendXlsx(res, buildSetupWorkbook(list), list.length === 1 ? `${safeFile(list[0].model.item_no)}-SET-UP.xlsx` : `SET-UP-${list.length}items-${stampNow}.xlsx`);
}));

// ── ดาวน์โหลด master / นำเข้า item หลายตัว (services/masterExport.js) ─────────────────────────────
// ไฟล์ item = ชีต ITEMS + ITEM_CHECKPOINTS · ไฟล์ master รวม = Division/เครื่อง/ผู้ตรวจ/ลูกค้า + ไฟล์ item
// ⚠️ ไฟล์ที่โหลดออกไปลากกลับมานำเข้า item ได้ (ชีตอื่นไม่สนใจ) — หน้าเว็บแมป/ตรวจ/merge เอง (utils/itemBulk.js)
//    server รับค่าเต็มที่ merge แล้ว (หลักเดียวกับ checkpoints/bulk)
const { buildMasterWorkbook, buildItemTemplate, ITEM_SHEET, ITEM_POINT_SHEET } = require('../services/masterExport');
const { sheetToTable, loadWorkbook, looksLikeSetup, parseSetupSheet } = require('../services/checkpointImport');

const EXPORT_TABLES = ['divisions', 'machines', 'inspectors', 'customers', 'models'];
const ITEM_PARSE_ROWS = 20000;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sendWorkbook = async (res, wb, fname) => {
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
  await wb.xlsx.write(res);
  res.end();
};
// วันที่ตามเวลาไทยสำหรับชื่อไฟล์ (YYYYMMDD)
const stamp = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');

// ไฟล์รวม = ต้องมีสิทธิ์ทั้ง master.base และ master.items · รายแท็บ = เมนูของตารางนั้น
const requireExportMenu = (req, res, next) => {
  const t = req.body?.table;
  if (t) return requireMenu(MENU_OF_TABLE[t] ?? 'master.base')(req, res, next);
  return requireMenu('master.base')(req, res, (err) => (err ? next(err) : requireMenu('master.items')(req, res, next)));
};

const loadExportData = async (table, ids) => {
  const where = ids ? 'WHERE x.id IN (?)' : '';
  const p = ids ? [ids] : [];
  switch (table) {
    case 'divisions': {
      const [rows] = await query(`SELECT x.* FROM divisions x ${where} ORDER BY x.name`, p);
      return rows;
    }
    case 'machines': {
      const [rows] = await query(
        `SELECT x.*, d.name AS division_name FROM machines x LEFT JOIN divisions d ON d.id = x.division_id ${where} ORDER BY d.name, x.code`, p
      );
      return rows;
    }
    case 'inspectors': {
      const [rows] = await query(
        `SELECT x.*, d.name AS division_name FROM inspectors x LEFT JOIN divisions d ON d.id = x.division_id ${where} ORDER BY x.name`, p
      );
      return rows;
    }
    case 'customers': {
      const [rows] = await query(`SELECT x.* FROM customers x ${where} ORDER BY x.name`, p);
      return rows;
    }
    case 'models': {
      const [items] = await query(
        `SELECT x.*, d.name AS division_name, cu.name AS customer_name
           FROM models x JOIN divisions d ON d.id = x.division_id LEFT JOIN customers cu ON cu.id = x.customer_id
          ${where} ORDER BY d.name, x.item_no`, p
      );
      const points = await loadActivePoints(items.map((m) => m.id));
      return { items, points };
    }
    default: return [];
  }
};

// จุดตรวจที่เปิดใช้งานของหลาย item พร้อม settings (เรียง item → seq_no)
const loadActivePoints = async (modelIds) => {
  if (!modelIds.length) return [];
  const [points] = await query(
    `SELECT id, model_id, seq_no, name, characteristic, char_type, unit, gauge, lsl, target, usl, sample_size,
            frequency, in_routine, is_critical, is_active
       FROM checkpoints WHERE model_id IN (?) AND is_active = 1 ORDER BY model_id, seq_no`, [modelIds]
  );
  const [settings] = points.length
    ? await query(
      'SELECT checkpoint_id, category_id, stage, sample_qty FROM checkpoint_category_settings WHERE checkpoint_id IN (?)',
      [points.map((x) => x.id)]
    )
    : [[]];
  const byCp = new Map();
  for (const s of settings) {
    if (!byCp.has(s.checkpoint_id)) byCp.set(s.checkpoint_id, []);
    byCp.get(s.checkpoint_id).push({ category_id: s.category_id, stage: s.stage, sample_qty: s.sample_qty });
  }
  for (const x of points) x.settings = byCp.get(x.id) ?? [];
  return points;
};

const loadCategories = async () => {
  const [cats] = await query('SELECT id, name, has_workflow, flow, is_active FROM check_categories ORDER BY sort_order, id');
  return cats;
};

// body: { table?: ตารางเดียว, ids?: [แถวที่กรองบนจอ] } — ไม่ส่ง table = ไฟล์ master รวม (ทุกแถว รวมที่ปิดใช้งาน)
router.post('/export', requireExportMenu, wrap(async (req, res) => {
  const table = req.body?.table ?? null;
  if (table && !EXPORT_TABLES.includes(table)) throw new AppError('ตารางไม่ถูกต้อง', 400);
  let ids = null;
  if (Array.isArray(req.body?.ids)) {
    ids = req.body.ids.map(Number).filter(Number.isInteger);
    if (ids.length === 0) throw new AppError('ไม่มีแถวให้ดาวน์โหลด', 400);
    if (ids.length > 5000) throw new AppError('เลือกได้ไม่เกิน 5000 แถว', 400);
  }
  const sheets = table ? [table] : EXPORT_TABLES;
  const data = {};
  for (const s of sheets) {
    const r = await loadExportData(s, table ? ids : null);
    if (s === 'models') Object.assign(data, r);
    else data[s] = r;
  }
  const categories = sheets.includes('models') ? await loadCategories() : [];
  const wb = buildMasterWorkbook({ sheets, data, categories });
  const prefix = table ? { divisions: 'divisions', machines: 'machines', inspectors: 'inspectors', customers: 'customers', models: 'items' }[table] : 'master';
  console.log(`[master] ${req.user?.username ?? '-'} ดาวน์โหลด ${prefix}${ids ? ` ${ids.length} แถว` : ''}`);
  await sendWorkbook(res, wb, `${prefix}-${stamp()}.xlsx`);
}));

// แม่แบบไฟล์ item เปล่า (แถวตัวอย่างใช้ชื่อ division แรกที่เปิดอยู่)
router.get('/item-template', requireMenu('master.items'), wrap(async (req, res) => {
  const [[div]] = await query('SELECT name FROM divisions ORDER BY id LIMIT 1');
  const wb = buildItemTemplate({ categories: await loadCategories(), division: div?.name ?? 'Mecha 1' });
  await sendWorkbook(res, wb, 'item-template.xlsx');
}));

// อ่านไฟล์ item (ไม่เขียน DB) → { items: ตารางข้อความ, checkpoints: ตารางข้อความ | [] }
router.post(
  '/items/import/parse',
  requireMenu('master.items'),
  express.raw({ type: () => true, limit: '5mb' }),
  wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new AppError('ไม่ได้รับไฟล์', 400);
    const wb = await loadWorkbook(req.body);
    if (!wb || wb.worksheets.length === 0) throw new AppError('เปิดไฟล์ไม่ได้ — ต้องเป็นไฟล์ Excel .xlsx', 400);
    const find = (name) => wb.worksheets.find((w) => w.name.trim().toUpperCase() === name);
    const wsItems = find(ITEM_SHEET);
    // ใบ SET UP ใบเดียว = item เดียว + จุดตรวจ (หัวใบให้ Item No / ชื่อ / Drawing) — หน้าเว็บถาม Division ถ้ายังไม่มี item นี้
    if (!wsItems && looksLikeSetup(wb.worksheets[0])) {
      const r = parseSetupSheet(wb.worksheets[0]);
      const [[setup]] = await query("SELECT id FROM check_categories WHERE code = 'setup'");
      return res.json({
        format: 'setup',
        itemNo: r.itemNo,
        header: r.header,
        errors: r.errors,
        points: r.points.map(({ qty, ...p }) => ({
          ...p,
          settings: setup && qty ? [
            { category_id: setup.id, stage: 'pd', sample_qty: qty },
            { category_id: setup.id, stage: 'qc', sample_qty: qty },
          ] : [],
        })),
      });
    }
    if (!wsItems) {
      throw new AppError('ไฟล์นี้ไม่ใช่ใบ SET UP และไม่มีชีต ITEMS — ใช้ใบ SET UP หรือไฟล์จาก "ดาวน์โหลด item" · ไฟล์จุดตรวจของ item เดียวให้นำเข้าที่การ์ดจุดตรวจ', 400);
    }
    const wsPoints = find(ITEM_POINT_SHEET);
    // ⚠️ ไฟล์ทั้งระบบ (ดาวน์โหลด Master) มีจุดตรวจเป็นพันแถว — อ่านได้ถึง ITEM_PARSE_ROWS · เกิน = ปฏิเสธ ไม่ตัดเงียบ ๆ
    //    (POST /items/bulk จำกัดเฉพาะ item/จุดที่เปลี่ยน — หน้าเว็บไม่ส่งของที่ไม่เปลี่ยน)
    const items = sheetToTable(wsItems, ITEM_PARSE_ROWS + 1);
    const checkpoints = wsPoints ? sheetToTable(wsPoints, ITEM_PARSE_ROWS + 1) : [];
    if (items.length > ITEM_PARSE_ROWS + 1 || checkpoints.length > ITEM_PARSE_ROWS + 1) {
      throw new AppError(`ไฟล์ใหญ่เกิน ${ITEM_PARSE_ROWS} แถวต่อชีต — แบ่งเป็นหลายไฟล์`, 400);
    }
    res.json({ items, checkpoints });
  })
);

// จุดตรวจที่เปิดใช้งานของหลาย item (หน้าเว็บใช้ merge/diff ตอนนำเข้า) — ?model_ids=1,2,3
router.get('/checkpoints', requireMenu('master.items'), wrap(async (req, res) => {
  const ids = String(req.query.model_ids ?? '').split(',').filter(Boolean).map(Number);
  if (ids.some((x) => !Number.isInteger(x))) throw new AppError('model_ids ไม่ถูกต้อง', 400);
  if (ids.length > 300) throw new AppError('ขอได้ครั้งละไม่เกิน 300 item', 400);
  const points = await loadActivePoints(ids);
  res.json(points.map(({ settings, ...p }) => ({ ...p, category_settings: settings })));
}));

// แถว item ที่ตรวจแล้ว · ผิด = AppError 400 (กฎเดียวกับฟอร์ม item / SimpleTab: min_* 0 < x < 100 หรือ null)
const ITEM_MIN_KEYS = ['min_cp', 'min_cpk', 'min_cp_ctf', 'min_cpk_ctf'];
const bulkItem = (it, label, { divisionIds, customerIds }) => {
  const d = it?.data ?? {};
  const divisionId = Number(it?.division_id);
  if (!divisionIds.has(divisionId)) throw new AppError(`ไม่พบ Division${label}`, 400);
  const itemNo = strOrNull(it?.item_no, 50);
  if (!itemNo) throw new AppError(`ต้องมี Item No${label}`, 400);
  const itemName = strOrNull(d.item_name, 150);
  if (!itemName) throw new AppError(`ต้องมีชื่อ item${label}`, 400);
  const customerId = d.customer_id === null || d.customer_id === undefined || d.customer_id === '' ? null : Number(d.customer_id);
  if (customerId !== null && !customerIds.has(customerId)) throw new AppError(`ไม่พบลูกค้า${label}`, 400);
  const row = {
    division_id: divisionId,
    item_no: itemNo,
    item_name: itemName,
    drawing_no: strOrNull(d.drawing_no, 100),
    drawing_rev: strOrNull(d.drawing_rev, 20),
    customer_id: customerId,
    is_active: d.is_active === undefined || d.is_active === null ? 1 : (Number(d.is_active) ? 1 : 0),
  };
  for (const k of ITEM_MIN_KEYS) {
    const v = d[k];
    if (v === null || v === undefined || v === '') { row[k] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n >= 100) throw new AppError(`${k} ต้องเป็นตัวเลขมากกว่า 0 และน้อยกว่า 100${label}`, 400);
    row[k] = n;
  }
  return row;
};
const ITEM_WRITE_COLUMNS = ['item_name', 'drawing_no', 'drawing_rev', 'customer_id', ...ITEM_MIN_KEYS, 'is_active'];

// body: { items: [{ division_id, item_no, data: {คอลัมน์ item ครบ}, points?: [แถวจุดตรวจเต็ม] }] }
//   item: division + item_no ตรง = UPDATE · ไม่ตรง = INSERT · จุดตรวจ = upsertCheckpoints(…, 'upsert') ทีละ item
//   ทั้งหมดใน transaction เดียว — แถวไหนผิด = ไม่บันทึกอะไรเลย
router.post('/items/bulk', requireMenu('master.items'), wrap(async (req, res) => {
  const list = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!list || list.length === 0) throw new AppError('ไม่มี item ให้บันทึก', 400);
  if (list.length > 300) throw new AppError('บันทึกได้ครั้งละไม่เกิน 300 item', 400);
  const totalPoints = list.reduce((n, it) => n + (Array.isArray(it?.points) ? it.points.length : 0), 0);
  if (totalPoints > 3000) throw new AppError('จุดตรวจรวมต้องไม่เกิน 3000 จุดต่อครั้ง', 400);

  const [[divs], [custs]] = await Promise.all([
    query('SELECT id FROM divisions'), query('SELECT id FROM customers'),
  ]);
  const ctx = { divisionIds: new Set(divs.map((x) => x.id)), customerIds: new Set(custs.map((x) => x.id)) };
  const catById = await loadWorkflowCategories();
  const seen = new Set();
  const prepared = list.map((it, i) => {
    const label = ` (item แถว ${i + 1}${it?.item_no ? ` "${String(it.item_no).trim()}"` : ''})`;
    const row = bulkItem(it, label, ctx);
    const key = `${row.division_id}|${row.item_no.toLowerCase()}`;
    if (seen.has(key)) throw new AppError(`item "${row.item_no}" ซ้ำกันในชุดที่ส่งมา`, 409);
    seen.add(key);
    const points = Array.isArray(it.points) && it.points.length
      ? prepareBulkPoints(it.points, catById, `${row.item_no} `)
      : [];
    return { row, points };
  });

  const result = await withTransaction(async (conn) => {
    const out = { added: [], updated: [], pointsAdded: 0, pointsUpdated: 0, baselineMayBeStale: [] };
    for (const { row, points } of prepared) {
      const [[cur]] = await conn.query(
        'SELECT id FROM models WHERE division_id = ? AND item_no = ? FOR UPDATE', [row.division_id, row.item_no]
      );
      let modelId;
      if (cur) {
        modelId = cur.id;
        await conn.execute(
          `UPDATE models SET ${ITEM_WRITE_COLUMNS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...ITEM_WRITE_COLUMNS.map((k) => row[k]), modelId]
        );
        out.updated.push(modelId);
      } else {
        const cols = ['division_id', 'item_no', ...ITEM_WRITE_COLUMNS];
        const [r] = await conn.execute(
          `INSERT INTO models (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((k) => row[k])
        );
        modelId = r.insertId;
        out.added.push(modelId);
      }
      if (points.length) {
        const r = await upsertCheckpoints(conn, modelId, points, 'upsert');
        out.pointsAdded += r.ids.length;
        out.pointsUpdated += r.updatedIds.length;
        out.baselineMayBeStale.push(...r.baselineMayBeStale.map((b) => ({ ...b, item_no: row.item_no })));
      }
    }
    return out;
  });
  logWrite(req, `นำเข้า item (เพิ่ม ${result.added.length} · แก้ ${result.updated.length} · จุดตรวจ +${result.pointsAdded} ~${result.pointsUpdated})`, 'models', '-');
  notifyMasterChanged(req);
  res.json({
    success: true,
    added: result.added.length,
    updated: result.updated.length,
    addedIds: result.added,
    pointsAdded: result.pointsAdded,
    pointsUpdated: result.pointsUpdated,
    baselineMayBeStale: result.baselineMayBeStale,
  });
}));

// ── ดึงเครื่องจักร / item / เครื่อง↔item จาก Drawing Digital (services/drawingSync.js) ──────────────
// ⚠️ แตะทั้งเครื่อง (master.base) และ item (master.items) → ต้องมีสิทธิ์ทั้งสอง · apply คำนวณแผนใหม่ใน transaction (ไม่เชื่อแผนจาก client)
const requireDrawingSync = (req, res, next) => (drawingSync.enabled()
  ? next()
  : next(new AppError('ยังไม่ได้ตั้ง DRAWING_DB_NAME ใน backend/.env — ฟีเจอร์ดึงจาก Drawing Digital ปิดอยู่', 400)));

router.get('/drawing-sync/preview', requireMenu('master.base'), requireMenu('master.items'), requireDrawingSync, wrap(async (req, res) => {
  res.json(await drawingSync.buildPlan((sql, p) => query(sql, p)));
}));

router.post('/drawing-sync/apply', requireMenu('master.base'), requireMenu('master.items'), requireDrawingSync, wrap(async (req, res) => {
  const result = await withTransaction(async (conn) => {
    const plan = await drawingSync.buildPlan((sql, p) => conn.query(sql, p));
    return { plan, summary: await drawingSync.applyPlan(conn, plan) };
  });
  logWrite(req, `ดึงจาก Drawing Digital ${JSON.stringify(result.summary)}`, 'machines/models', '-');
  notifyMasterChanged(req);
  res.json({ success: true, summary: result.summary, warnings: result.plan.warnings });
}));

module.exports = router;
module.exports.ALLOWED_COLUMNS = ALLOWED_COLUMNS;
