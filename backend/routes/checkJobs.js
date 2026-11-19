// backend/routes/checkJobs.js — งานตรวจที่ต้องส่งต่อ PD → QC (Set up / Last Piece …)
//
// ลำดับ (ชีต "SET UP & LAST PIECE INSPECTION RECORD"):
//   PD เปิดงานด้วยเลข WOS → PD กรอก Production Check → ส่ง → เข้าคิว QC (แจ้งเตือน)
//   → QC กดรับงาน → QC กรอก QC Confirm → ผ่าน (ปิดงาน) / ไม่ผ่าน (ตีกลับ PD รอบใหม่)
//
// ⚠️ ทุกเส้นต้อง login · แยกสิทธิ์ที่ server ด้วย requireRole (PD ทำขั้น PD · QC ทำขั้น QC · ADMIN ทำได้ทั้งสองขั้น)
// ⚠️ เปลี่ยนสถานะด้วย UPDATE … WHERE status = <ที่คาดไว้> แล้วเช็ค affectedRows เสมอ
//    0 แถว = มีคนทำขั้นนี้ไปก่อนแล้ว (QC สองคนกดรับงานเดียวกัน) → 409 ไม่ใช่ทับกัน
// ⚠️ ผลตรวจ + เปลี่ยนสถานะ + เขียน event อยู่ใน transaction เดียวกันเสมอ
//    แยกเมื่อไหร่ = งานขยับไปขั้นถัดไปโดยไม่มีผลตรวจ หรือมีผลตรวจแต่งานค้างขั้นเดิม
// ⚠️ เวลาของทุกขั้นอยู่ที่ check_job_events (append-only) — check_jobs เก็บแค่สถานะปัจจุบัน
'use strict';

const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { insertInspection } = require('../db/inspectionWrite');
const { evaluateCheckpoint, summarize, validateSubmission, isShift } = require('../services/judgment');
const { AppError, wrap } = require('../middleware/errorHandler');
const { requireMenu, requireRole, userHasRole } = require('../middleware/requireLogin');

const router = express.Router();
// สิทธิ์เมนู Set up (ADMIN ตั้งได้) — GUEST ของเมนูนี้ล็อกปิดเสมอ จึงมี req.user ทุกเส้น
router.use(requireMenu('setup'));

const requirePD = requireRole('PD');
const requireQC = requireRole('QC');

const OPEN_STATUSES = ['pd_checking', 'waiting_qc', 'qc_checking'];
const ALL_STATUSES = [...OPEN_STATUSES, 'passed', 'cancelled'];

const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));
const textOrNull = (v) => {
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
};
const userNameOf = (u) => u.display_name || u.username;

// จุดตรวจที่ต้องตรวจในขั้นนี้ — sample_size ถูกแทนด้วย sample_qty ของหมวด/ขั้น
// เพื่อให้ validateSubmission / evaluateCheckpoint (n_used snapshot) ใช้ตัวเดียวกับงานตามรอบได้ตรง ๆ
const stageCheckpoints = async (modelId, categoryId, stage, db = { query }) => {
  const [rows] = await db.query(
    `SELECT c.*, s.sample_qty
       FROM checkpoints c
       JOIN checkpoint_category_settings s
         ON s.checkpoint_id = c.id AND s.category_id = ? AND s.stage = ?
      WHERE c.model_id = ? AND c.is_active = 1
      ORDER BY c.seq_no ASC`,
    [Number(categoryId), stage, Number(modelId)]
  );
  return rows.map((c) => ({ ...c, sample_size: c.char_type === 'attribute' ? 1 : c.sample_qty }));
};

// ตรวจ + ตัดสินผลที่ส่งมา (ยังไม่แตะ DB) — required = ทุกจุดของขั้นนี้ต้องมี
const evaluateStage = (checkpoints, submitted, { required }) => {
  const list = Array.isArray(submitted) ? submitted : [];
  const byId = new Map(checkpoints.map((c) => [c.id, c]));
  const got = new Map();
  for (const item of list) {
    const cp = byId.get(Number(item.checkpoint_id));
    if (!cp) throw new AppError(`จุดตรวจ id=${item.checkpoint_id} ไม่ได้อยู่ในขั้นนี้`, 400);
    if (got.has(cp.id)) throw new AppError(`ส่งจุดตรวจ "${cp.name}" ซ้ำ`, 400);
    got.set(cp.id, item);
  }
  if (required) {
    const missing = checkpoints.filter((c) => !got.has(c.id));
    if (missing.length) throw new AppError(`ยังไม่ได้กรอก: ${missing.map((c) => c.name).join(', ')}`, 400);
  }
  const included = checkpoints.filter((c) => got.has(c.id));
  for (const cp of included) {
    const err = validateSubmission(cp, got.get(cp.id));
    if (err) throw new AppError(err, 400);
  }
  const linesByCheckpoint = included.map((cp) => ({ checkpoint: cp, lines: evaluateCheckpoint(cp, got.get(cp.id)) }));
  return { linesByCheckpoint, overall: summarize(linesByCheckpoint.flatMap((x) => x.lines)) };
};

const addEvent = (conn, job, roundNo, action, user, { note = null, inspectionId = null } = {}) =>
  conn.execute(
    `INSERT INTO check_job_events (job_id, round_no, action, user_id, user_name, note, inspection_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [job.id, roundNo, action, user.id, userNameOf(user).slice(0, 100), note, inspectionId]
  );

// เปลี่ยนสถานะแบบมีเงื่อนไข — 0 แถว = สถานะไม่ใช่ที่คาดไว้แล้ว (มีคนทำไปก่อน) → 409
const transition = async (conn, jobId, from, setSql, params = []) => {
  const [r] = await conn.execute(
    `UPDATE check_jobs SET ${setSql} WHERE id = ? AND status = ?`,
    [...params, jobId, from]
  );
  if (r.affectedRows === 0) {
    throw new AppError('งานนี้ถูกเปลี่ยนสถานะไปแล้ว (อาจมีคนทำขั้นนี้ไปก่อน) — กดรีเฟรชเพื่อดูสถานะล่าสุด', 409);
  }
};

// ขั้นย่อยของงาน (2026-11-19) — เป็น event ไม่ใช่ status: pd_checking ก่อน pd_start_check = Set up & Adjust
//   qc_checking ก่อน qc_start_check = QC รับงานแล้วแต่ยังไม่เริ่มเช็ค · ช่วงเวลาทั้งหมดคิดที่ frontend utils/jobTimeline.js
// ⚠️ submit / decide ต้องมี start ของ "รอบปัจจุบัน" — รอบใหม่หลังตีกลับต้องกดเริ่มเช็คใหม่ (เวลาปรับตั้งรอบ 2 ถึงแยกได้)
const START_ACTION = { pd: 'pd_start_check', qc: 'qc_start_check' };
const startedAt = async (job, stage, db = { query }) => {
  const [[row]] = await db.query(
    'SELECT at FROM check_job_events WHERE job_id = ? AND round_no = ? AND action = ? ORDER BY id DESC LIMIT 1',
    [job.id, job.round_no, START_ACTION[stage]]
  );
  return row?.at ?? null;
};
const assertStarted = async (job, stage) => {
  if (!(await startedAt(job, stage))) {
    throw new AppError(stage === 'pd' ? 'ยังไม่ได้กด "ปรับตั้งเสร็จ — เริ่มเช็คงาน"' : 'ยังไม่ได้กด "เริ่มเช็คงาน"', 409);
  }
};

const loadJob = async (id, db = { query }) => {
  const [[job]] = await db.query('SELECT * FROM check_jobs WHERE id = ?', [Number(id)]);
  if (!job) throw new AppError('ไม่พบงานนี้', 404);
  return job;
};

// ผลตรวจลงใบตรวจตารางเดิม (หมวด/งาน/ขั้นติดไปด้วย) — header ทั้งหมดมาจากงาน ไม่รับจาก client
const insertStageInspection = (conn, job, user, stage, { linesByCheckpoint, overall }, remark) => {
  if (!user.inspector_id) {
    throw new AppError('บัญชีนี้ยังไม่ได้ผูกกับผู้ตรวจ — ให้ ADMIN ตั้งที่ Master › ผู้ใช้ ก่อน', 400);
  }
  return insertInspection(conn, {
    model_id: job.model_id, machine_id: job.machine_id, inspector_id: user.inspector_id,
    mo_no: job.mo_no, lot_no: job.lot_no, shift: job.shift, remark, overall,
    mo_item_no: job.mo_item_no, mo_item_name: job.mo_item_name, mo_draw: job.mo_draw,
    category_id: job.category_id, job_id: job.id, stage,
  }, linesByCheckpoint);
};

// แจ้งทุกจอ — คิว QC ไม่ได้ join room ของ item ไหน (เหตุผลเดียวกับ master_updated)
// payload สั้น client โหลดคิว/ตัวนับใหม่เอง
const notify = (req, job, action) => req.app.get('io')?.emit('check_job_updated', {
  id: job.id,
  categoryId: job.category_id,
  status: job.status,
  roundNo: job.round_no,
  moNo: job.mo_no,
  action,
});

const emitInspectionSaved = (req, job, inspectionId, linesByCheckpoint, overall) =>
  req.app.get('io')?.to(`model:${job.model_id}`).emit('inspection_saved', {
    inspectionId,
    modelId: job.model_id,
    categoryId: job.category_id,
    machineId: job.machine_id,
    moNo: job.mo_no,
    overallResult: overall,
    checkpointIds: linesByCheckpoint.map((x) => x.checkpoint.id),
    ngCheckpointIds: linesByCheckpoint.filter((x) => x.lines.some((l) => l.judgment === 'NG')).map((x) => x.checkpoint.id),
  });

// ── อ่าน ──────────────────────────────────────────────────────────────────

const SELECT_JOBS = `
  SELECT j.*, cat.code AS category_code, cat.name AS category_name, cat.flow AS category_flow,
         m.item_no, m.item_name, m.drawing_no, m.drawing_rev,
         mc.code AS machine_code, mc.name AS machine_name,
         ou.display_name AS opened_by_name, ou.username AS opened_by_username,
         (SELECT MAX(e.at) FROM check_job_events e WHERE e.job_id = j.id) AS last_event_at,
         (SELECT e.action FROM check_job_events e WHERE e.job_id = j.id ORDER BY e.id DESC LIMIT 1) AS last_action,
         (SELECT e.user_name FROM check_job_events e WHERE e.job_id = j.id ORDER BY e.id DESC LIMIT 1) AS last_user_name,
         (SELECT e.note FROM check_job_events e
           WHERE e.job_id = j.id AND e.action IN ('qc_reject','pd_reject') ORDER BY e.id DESC LIMIT 1) AS last_reject_note,
         (SELECT MAX(e.at) FROM check_job_events e
           WHERE e.job_id = j.id AND e.round_no = j.round_no
             AND e.action = CASE j.status WHEN 'pd_checking' THEN 'pd_start_check'
                                          WHEN 'qc_checking' THEN 'qc_start_check' END) AS stage_started_at
    FROM check_jobs j
    JOIN check_categories cat ON cat.id = j.category_id
    JOIN models m             ON m.id  = j.model_id
    JOIN machines mc          ON mc.id = j.machine_id
    LEFT JOIN users ou        ON ou.id = j.opened_by
`;

// คิว — ?status=waiting_qc,qc_checking&category=2&days=7 (days = งานที่ปิดแล้วย้อนหลังกี่วัน)
// ไม่ส่ง status = งานที่ยังไม่ปิดทั้งหมด · เรียงเก่าสุดก่อน (คิว)
router.get('/', wrap(async (req, res) => {
  const statuses = String(req.query.status ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const bad = statuses.filter((s) => !ALL_STATUSES.includes(s));
  if (bad.length) throw new AppError(`status "${bad.join(', ')}" ไม่ถูกต้อง`, 400);

  const where = [];
  const params = [];
  where.push(`j.status IN (${(statuses.length ? statuses : OPEN_STATUSES).map(() => '?').join(', ')})`);
  params.push(...(statuses.length ? statuses : OPEN_STATUSES));
  if (isIntLike(req.query.category)) { where.push('j.category_id = ?'); params.push(Number(req.query.category)); }
  if (req.query.mo_no) { where.push('j.mo_no = ?'); params.push(String(req.query.mo_no).trim()); }
  if (isIntLike(req.query.days)) {
    where.push('(j.closed_at IS NULL OR j.closed_at >= NOW() - INTERVAL ? DAY)');
    params.push(Number(req.query.days));
  }

  const [rows] = await query(
    `${SELECT_JOBS} WHERE ${where.join(' AND ')} ORDER BY j.updated_at ASC, j.id ASC LIMIT 300`,
    params
  );
  res.json(rows);
}));

// ตัวนับ badge — คำนวณที่ server (client เลือกตัวที่ตรงกับ role ของตัวเอง)
//   waiting_qc = รอ QC รับ · qc_checking = QC รับแล้วกำลังตรวจ
//   pd_returned = ถูก QC ตีกลับ รอ PD ตรวจใหม่ (pd_checking ที่ round_no > 1) · pd_checking = PD ยังไม่ส่ง
router.get('/counts', wrap(async (req, res) => {
  const [rows] = await query(
    `SELECT category_id,
            SUM(status = 'waiting_qc')                  AS waiting_qc,
            SUM(status = 'qc_checking')                 AS qc_checking,
            SUM(status = 'pd_checking' AND round_no > 1) AS pd_returned,
            SUM(status = 'pd_checking')                 AS pd_checking
       FROM check_jobs
      WHERE status IN ('pd_checking','waiting_qc','qc_checking')
      GROUP BY category_id`
  );
  const byCategory = {};
  const total = { waiting_qc: 0, qc_checking: 0, pd_returned: 0, pd_checking: 0 };
  for (const r of rows) {
    const c = {};
    for (const k of Object.keys(total)) { c[k] = Number(r[k]) || 0; total[k] += c[k]; }
    byCategory[r.category_id] = c;
  }
  res.json({ total, byCategory });
}));

// จุดตรวจของทั้งสองขั้นของ item + หมวด — หน้าเปิดงานใช้โชว์ล่วงหน้าว่าต้องตรวจอะไร
router.get('/form', wrap(async (req, res) => {
  if (!isIntLike(req.query.model_id) || !isIntLike(req.query.category)) {
    throw new AppError('ต้องระบุ model_id และ category', 400);
  }
  const [pd, qc] = await Promise.all([
    stageCheckpoints(req.query.model_id, req.query.category, 'pd'),
    stageCheckpoints(req.query.model_id, req.query.category, 'qc'),
  ]);
  res.json({ pd, qc });
}));

// ตัวเลือก dropdown ของหัวงาน = ค่าที่เคยกรอก (ใช้ล่าสุดก่อน) — พิมพ์ค่าใหม่ได้เสมอ (datalist)
// ⚠️ ต้องอยู่ก่อน /:id
router.get('/header-options', wrap(async (req, res) => {
  const pick = async (col) => {
    const [rows] = await query(
      `SELECT ${col} AS v, MAX(opened_at) AS last FROM check_jobs
        WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY ${col} ORDER BY last DESC LIMIT 100`
    );
    return rows.map((r) => r.v);
  };
  const [processes, materials] = await Promise.all([pick('process'), pick('material')]);
  res.json({ processes, materials });
}));

// งานเดียว: หัว + timeline + ผลตรวจทุกใบ (ทุกรอบ ทั้ง PD/QC) + จุดตรวจของแต่ละขั้น
router.get('/:id', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const [[job]] = await query(`${SELECT_JOBS} WHERE j.id = ?`, [Number(req.params.id)]);
  if (!job) throw new AppError('ไม่พบงานนี้', 404);

  const [[events], [inspections], pd, qc] = await Promise.all([
    query('SELECT * FROM check_job_events WHERE job_id = ? ORDER BY at ASC, id ASC', [job.id]),
    query(
      `SELECT i.id, i.stage, i.subgroup_no, i.inspected_at, i.overall_result, i.voided_at,
              ins.name AS inspector_name,
              (SELECT e.round_no FROM check_job_events e WHERE e.inspection_id = i.id LIMIT 1) AS round_no
         FROM inspections i
         JOIN inspectors ins ON ins.id = i.inspector_id
        WHERE i.job_id = ?
        ORDER BY i.inspected_at ASC, i.id ASC`,
      [job.id]
    ),
    stageCheckpoints(job.model_id, job.category_id, 'pd'),
    stageCheckpoints(job.model_id, job.category_id, 'qc'),
  ]);

  const ids = inspections.map((i) => i.id);
  const [results] = ids.length
    ? await query(
      `SELECT inspection_id, checkpoint_id, piece_no, value, judgment, ng_reason
         FROM inspection_results WHERE inspection_id IN (?)
        ORDER BY checkpoint_id, piece_no`,
      [ids]
    )
    : [[]];

  res.json({
    job,
    events,
    inspections: inspections.map((i) => ({ ...i, results: results.filter((r) => r.inspection_id === i.id) })),
    checkpoints: { pd, qc },
  });
}));

// ── เขียน ─────────────────────────────────────────────────────────────────

// ── ใครตรวจ: check_categories.flow (ตั้งที่ Master › หมวดการตรวจ) ───────────────────────
//   pd_qc = PD เปิด → PD ตรวจ → ส่ง QC → QC รับ → ผ่าน/ไม่ผ่าน (ไม่ผ่าน = กลับ PD รอบใหม่)   ← ค่าเริ่ม
//   pd    = PD เปิด → PD ตรวจแล้วตัดสินผ่าน/ไม่ผ่านเอง (/decide) · ไม่ผ่าน = PD ตรวจซ้ำรอบใหม่
//   qc    = QC เปิด (= รับงานไว้เอง) → QC ตรวจแล้วตัดสิน (/decide) · ไม่ผ่าน = QC ตรวจซ้ำรอบใหม่
// ⚠️ ขั้นของจุดตรวจ: pd_qc ใช้ settings ขั้น pd + qc · pd ใช้ขั้น pd · qc ใช้ขั้น qc
const FLOW_STAGES = { pd_qc: ['pd', 'qc'], pd: ['pd'], qc: ['qc'] };
const flowOf = async (categoryId) => {
  const [[c]] = await query('SELECT flow FROM check_categories WHERE id = ?', [Number(categoryId)]);
  return FLOW_STAGES[c?.flow] ? c.flow : 'pd_qc';
};
// role ที่เปิดงานของแต่ละ flow
const OPENER = { pd_qc: 'PD', pd: 'PD', qc: 'QC' };
const requireOpener = (req, res, next) => {
  flowOf(req.body?.category_id)
    .then((flow) => requireRole(OPENER[flow])(req, res, next))
    .catch(next);
};

// เปิดงาน — body: { category_id, model_id, machine_id, mo_no, lot_no?, shift, process, material?, material_lot?,
//                   mo_item_no?, mo_item_name?, mo_draw? } · หัวงานตามหัวใบ SET UP (process บังคับ)
router.post('/', requireOpener, wrap(async (req, res) => {
  const b = req.body ?? {};
  for (const [key, label] of [['category_id', 'หมวด'], ['model_id', 'item'], ['machine_id', 'เครื่อง']]) {
    if (!isIntLike(b[key])) throw new AppError(`ยังไม่ได้เลือก${label}`, 400);
  }
  const moNo = String(b.mo_no ?? '').trim();
  if (!moNo) throw new AppError('ยังไม่ได้กรอกเลข WOS', 400);
  if (!b.shift) throw new AppError('ยังไม่ได้เลือกกะ', 400);
  if (!isShift(b.shift)) throw new AppError(`กะ "${b.shift}" ไม่ใช่กะที่ระบบรับ`, 400);
  const head = (v) => textOrNull(v)?.slice(0, 100) ?? null;
  const process = head(b.process);
  if (!process) throw new AppError('ยังไม่ได้กรอก Process', 400);

  const [[cat]] = await query('SELECT id, name, has_workflow, flow FROM check_categories WHERE id = ? AND is_active = 1', [Number(b.category_id)]);
  if (!cat || !Number(cat.has_workflow)) throw new AppError('หมวดนี้ไม่ใช่งานที่ต้องส่งต่อ PD → QC', 400);
  const flow = FLOW_STAGES[cat.flow] ? cat.flow : 'pd_qc';
  const firstStage = FLOW_STAGES[flow][0];
  const [[model]] = await query('SELECT id, division_id FROM models WHERE id = ? AND is_active = 1', [Number(b.model_id)]);
  if (!model) throw new AppError('ไม่พบ item นี้ หรือถูกปิดใช้งาน', 400);
  const [[machine]] = await query('SELECT id, division_id FROM machines WHERE id = ? AND is_active = 1', [Number(b.machine_id)]);
  if (!machine) throw new AppError('ไม่พบเครื่องนี้ หรือถูกปิดใช้งาน', 400);
  if (Number(machine.division_id) !== Number(model.division_id)) throw new AppError('เครื่องกับ item อยู่คนละ Division', 400);

  const first = await stageCheckpoints(model.id, cat.id, firstStage);
  if (!first.length) {
    throw new AppError(`item นี้ยังไม่ได้ตั้งจุดตรวจ ${cat.name} ขั้น ${firstStage.toUpperCase()} — ตั้งที่ Master › ตารางหมวดการตรวจ`, 400);
  }

  // งานที่ยังไม่ปิดของ หมวด + item + เครื่อง + WOS เดียวกันมีได้ใบเดียว — เปิดซ้ำ = คิวซ้อนกันสองใบ
  const [[dup]] = await query(
    `SELECT id FROM check_jobs
      WHERE category_id = ? AND model_id = ? AND machine_id = ? AND mo_no = ?
        AND status IN ('pd_checking','waiting_qc','qc_checking')`,
    [cat.id, model.id, machine.id, moNo]
  );
  if (dup) throw new AppError(`WOS ${moNo} มีงาน ${cat.name} ที่ยังไม่ปิดอยู่แล้ว (งาน #${dup.id})`, 409);

  const job = await withTransaction(async (conn) => {
    const [r] = await conn.execute(
      `INSERT INTO check_jobs
         (category_id, model_id, machine_id, mo_no, lot_no, shift, process, material, material_lot,
          mo_item_no, mo_item_name, mo_draw, opened_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cat.id, model.id, machine.id, moNo, textOrNull(b.lot_no), b.shift, process, head(b.material), head(b.material_lot),
        textOrNull(b.mo_item_no), textOrNull(b.mo_item_name), textOrNull(b.mo_draw), req.user.id,
        flow === 'qc' ? 'qc_checking' : 'pd_checking']
    );
    const created = await loadJob(r.insertId, conn);
    await addEvent(conn, created, 1, 'open', req.user);
    // flow qc: คนเปิด = QC ที่รับงานไว้เลย (ตัดสินผลได้เฉพาะคนที่ qc_accept ล่าสุด)
    if (flow === 'qc') await addEvent(conn, created, 1, 'qc_accept', req.user);
    return created;
  });

  notify(req, job, 'open');
  res.json({ success: true, id: job.id });
}));

// PD ส่งผลให้ QC — body: { results: [...] (รูปเดียวกับ POST /inspections), remark? }
router.post('/:id/submit', requirePD, wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const job = await loadJob(req.params.id);
  if (job.status !== 'pd_checking') throw new AppError('งานนี้ไม่ได้อยู่ขั้น PD ตรวจ', 409);
  if ((await flowOf(job.category_id)) !== 'pd_qc') {
    throw new AppError('หมวดนี้ PD ตัดสินผลเอง ไม่ต้องส่ง QC — ใช้ปุ่มผ่าน/ไม่ผ่าน', 409);
  }

  await assertStarted(job, 'pd');
  const evaluated = evaluateStage(await stageCheckpoints(job.model_id, job.category_id, 'pd'), req.body?.results, { required: true });

  const saved = await withTransaction(async (conn) => {
    await transition(conn, job.id, 'pd_checking', "status = 'waiting_qc', result = NULL");
    const ins = await insertStageInspection(conn, job, req.user, 'pd', evaluated, textOrNull(req.body?.remark));
    await addEvent(conn, job, job.round_no, 'pd_submit', req.user, { inspectionId: ins.inspectionId });
    return ins;
  });

  notify(req, { ...job, status: 'waiting_qc' }, 'pd_submit');
  emitInspectionSaved(req, job, saved.inspectionId, evaluated.linesByCheckpoint, evaluated.overall);
  res.json({ success: true, inspection_id: saved.inspectionId, overall_result: evaluated.overall });
}));

// QC รับงาน
router.post('/:id/accept', requireQC, wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const job = await loadJob(req.params.id);

  await withTransaction(async (conn) => {
    await transition(conn, job.id, 'waiting_qc', "status = 'qc_checking'");
    await addEvent(conn, job, job.round_no, 'qc_accept', req.user);
  });

  notify(req, { ...job, status: 'qc_checking' }, 'qc_accept');
  res.json({ success: true });
}));

// ปรับตั้งเสร็จ / QC เริ่มเช็ค — ขั้นอ่านจากสถานะงาน (pd_checking → PD · qc_checking → QC คนที่รับงานล่าสุด)
// ⚠️ ล็อกแถวงาน (FOR UPDATE) แล้วเช็คซ้ำในนั้น — กดพร้อมกันสองเครื่องต้องได้ start เดียวต่อรอบ
router.post('/:id/start-check', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const job = await loadJob(req.params.id);
  const flow = await flowOf(job.category_id);
  const stage = job.status === 'pd_checking' && flow !== 'qc' ? 'pd'
    : job.status === 'qc_checking' ? 'qc'
      : null;
  if (!stage) throw new AppError('งานนี้ไม่ได้อยู่ในขั้นที่ต้องเริ่มเช็ค', 409);
  const role = stage === 'pd' ? 'PD' : 'QC';
  if (!userHasRole(req.user, role)) throw new AppError(`บัญชีนี้ไม่มีสิทธิ์ (ต้องเป็น ${role})`, 403);
  if (stage === 'qc') {
    const [[accept]] = await query(
      "SELECT user_id, user_name FROM check_job_events WHERE job_id = ? AND action = 'qc_accept' ORDER BY id DESC LIMIT 1",
      [job.id]
    );
    if (accept && Number(accept.user_id) !== Number(req.user.id)) {
      throw new AppError(`งานนี้ ${accept.user_name} รับไว้ — ให้คนที่รับงานเป็นคนเริ่มเช็ค`, 409);
    }
  }

  const action = START_ACTION[stage];
  await withTransaction(async (conn) => {
    const [[locked]] = await conn.query('SELECT status, round_no FROM check_jobs WHERE id = ? FOR UPDATE', [job.id]);
    if (!locked || locked.status !== job.status || Number(locked.round_no) !== Number(job.round_no)) {
      throw new AppError('งานนี้ถูกเปลี่ยนสถานะไปแล้ว — กดรีเฟรชเพื่อดูสถานะล่าสุด', 409);
    }
    if (await startedAt(job, stage, conn)) throw new AppError('รอบนี้กดเริ่มเช็คไปแล้ว', 409);
    await conn.execute('UPDATE check_jobs SET updated_at = NOW() WHERE id = ?', [job.id]);
    await addEvent(conn, job, job.round_no, action, req.user);
  });

  notify(req, job, action);
  res.json({ success: true });
}));

// QC ยืนยันผล — body: { result: 'pass'|'fail', note?, results: [...] }
//   pass: ต้องกรอกครบทุกจุดของขั้น QC และห้ามมี NG · fail: ต้องมีเหตุผล ผลตรวจกรอกเท่าที่ตรวจได้ (ว่างได้)
// ⚠️ คนกดยืนยันต้องเป็น QC คนที่รับงานไว้ — กันอีกคนมาปิดงานที่คนอื่นกำลังตรวจอยู่
// ตัดสินผล — body: { result: 'pass'|'fail', note?, results: [...] }
//   flow pd_qc / qc: QC ที่รับงานไว้ ตอน qc_checking · flow pd: PD ตอน pd_checking
//   pass: ต้องกรอกครบทุกจุดของขั้นนั้นและห้ามมี NG · fail: ต้องมีเหตุผล ผลตรวจกรอกเท่าที่ตรวจได้ (ว่างได้)
// ⚠️ ขั้น QC: คนกดยืนยันต้องเป็น QC คนที่รับงานไว้ — กันอีกคนมาปิดงานที่คนอื่นกำลังตรวจอยู่
router.post('/:id/decide', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const result = req.body?.result;
  if (result !== 'pass' && result !== 'fail') throw new AppError('result ต้องเป็น pass หรือ fail', 400);
  const note = textOrNull(req.body?.note);
  if (result === 'fail' && !note) throw new AppError('ไม่ผ่าน ต้องระบุเหตุผล', 400);

  const job = await loadJob(req.params.id);
  const flow = await flowOf(job.category_id);
  const stage = flow === 'pd' ? 'pd' : 'qc';
  const role = stage === 'pd' ? 'PD' : 'QC';
  const fromStatus = stage === 'pd' ? 'pd_checking' : 'qc_checking';
  if (!userHasRole(req.user, role)) throw new AppError(`บัญชีนี้ไม่มีสิทธิ์ (ต้องเป็น ${role})`, 403);
  if (job.status !== fromStatus) {
    throw new AppError(stage === 'qc' ? 'งานนี้ยังไม่ได้อยู่ขั้น QC ตรวจ (ต้องกดรับงานก่อน)' : 'งานนี้ไม่ได้อยู่ขั้น PD ตรวจ', 409);
  }
  if (stage === 'qc') {
    const [[accept]] = await query(
      "SELECT user_id, user_name FROM check_job_events WHERE job_id = ? AND action = 'qc_accept' ORDER BY id DESC LIMIT 1",
      [job.id]
    );
    if (accept && Number(accept.user_id) !== Number(req.user.id)) {
      throw new AppError(`งานนี้ ${accept.user_name} รับไว้ — ให้คนที่รับงานเป็นคนยืนยันผล`, 409);
    }
  }

  await assertStarted(job, stage);

  const submitted = Array.isArray(req.body?.results) ? req.body.results : [];
  const evaluated = submitted.length || result === 'pass'
    ? evaluateStage(await stageCheckpoints(job.model_id, job.category_id, stage), submitted, { required: result === 'pass' })
    : null;
  if (result === 'pass' && evaluated.overall === 'NG') {
    throw new AppError('มีค่า NG อยู่ ยืนยันผ่านไม่ได้ — กดไม่ผ่าน', 400);
  }

  // ไม่ผ่าน = รอบใหม่ · pd_qc กลับไป PD · pd / qc ตรวจซ้ำที่ขั้นเดิม
  const failStatus = flow === 'qc' ? 'qc_checking' : 'pd_checking';
  const action = `${stage}_${result === 'pass' ? 'pass' : 'reject'}`;
  const saved = await withTransaction(async (conn) => {
    if (result === 'pass') {
      await transition(conn, job.id, fromStatus, "status = 'passed', result = 'pass', closed_at = NOW()");
    } else {
      // event ของการตีกลับยังเป็นของรอบเดิม (round_no ก่อนบวก)
      await transition(conn, job.id, fromStatus, `status = '${failStatus}', result = 'fail', round_no = round_no + 1`);
    }
    const ins = evaluated && evaluated.linesByCheckpoint.length
      ? await insertStageInspection(conn, job, req.user, stage, evaluated, note)
      : null;
    await addEvent(conn, job, job.round_no, action, req.user, { note, inspectionId: ins?.inspectionId ?? null });
    return ins;
  });

  const after = result === 'pass'
    ? { ...job, status: 'passed' }
    : { ...job, status: failStatus, round_no: job.round_no + 1 };
  notify(req, after, action);
  if (saved) emitInspectionSaved(req, job, saved.inspectionId, evaluated.linesByCheckpoint, evaluated.overall);
  res.json({ success: true, status: after.status, round_no: after.round_no, inspection_id: saved?.inspectionId ?? null });
}));

// ยกเลิกงาน (เปิดผิด WOS / ไม่ผลิตแล้ว) — เหตุผลบังคับ · ใบตรวจที่บันทึกไปแล้วอยู่ต่อ (หลักฐาน)
router.post('/:id/cancel', requireRole('PD', 'QC', 'ADMIN'), wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const note = textOrNull(req.body?.reason);
  if (!note) throw new AppError('ต้องระบุเหตุผลที่ยกเลิกงาน', 400);
  const job = await loadJob(req.params.id);
  if (!OPEN_STATUSES.includes(job.status)) throw new AppError('งานนี้ปิดไปแล้ว', 409);

  await withTransaction(async (conn) => {
    await transition(conn, job.id, job.status, "status = 'cancelled', closed_at = NOW()");
    await addEvent(conn, job, job.round_no, 'cancel', req.user, { note });
  });

  notify(req, { ...job, status: 'cancelled' }, 'cancel');
  res.json({ success: true });
}));

module.exports = router;
module.exports.stageCheckpoints = stageCheckpoints;
