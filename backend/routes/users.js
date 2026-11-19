// backend/routes/users.js — จัดการบัญชี login หน้า Master (แท็บ "ผู้ใช้" ในหน้า Master)
//
// ⚠️ ทุกเส้นต้อง login (master.users) — คนที่ login อยู่เพิ่มบัญชีให้คนอื่น หรืออนุมัติคำขอจากหน้า /register
//    (สมัครเองได้บัญชี pending ที่ login ไม่ได้ — หน้าเว็บเปิดได้ทุกเครื่องในโรงงาน สมัครแล้วใช้ได้ทันที = login ไม่ได้กันอะไร)
// ⚠️ ไม่ผ่าน generic CRUD ของ routes/master.js และ users ห้ามอยู่ใน ALLOWED_COLUMNS —
//    รหัสผ่านต้อง hash ก่อนลง DB และ password_hash ห้ามถูกส่งกลับไปหน้าเว็บ
// ไม่มีการลบบัญชี ใช้ปิดใช้งานแทน (ร่องรอยใน log ยังอ้างชื่อนี้อยู่)
'use strict';

const express = require('express');
const { query, execute, withTransaction } = require('../db/pool');
const { hashPassword, hashPasskey } = require('../services/auth');
const { requireMenu } = require('../middleware/requireLogin');
const { AppError, wrap } = require('../middleware/errorHandler');
const { usernameOf, checkPassword, displayNameOf } = require('../services/userRules');

const router = express.Router();
router.use(requireMenu('master.users'));

// passkey ใช้เข้าได้ด้วยช่องเดียว (ไม่มี username ช่วย) จึงสั้นกว่านี้ไม่ได้
const MIN_PASSKEY = 6;

const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));

const ROLES = ['ADMIN', 'PD', 'QC'];
// รับ array หรือ 'ADMIN,QC' → string สำหรับคอลัมน์ SET · ว่าง = ไม่มีสิทธิ์อะไรเลย ไม่ยอม
const roleOf = (v) => {
  const list = (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((r) => String(r).trim().toUpperCase()).filter(Boolean);
  const bad = list.filter((r) => !ROLES.includes(r));
  if (bad.length) throw new AppError(`role "${bad.join(', ')}" ไม่มีในระบบ (มี ${ROLES.join(' / ')})`, 400);
  if (!list.length) throw new AppError('ต้องเลือก role อย่างน้อย 1 อย่าง', 400);
  return [...new Set(list)].join(',');
};

// ผู้ตรวจที่บัญชีนี้เป็น — ว่าง = ไม่ผูก (ADMIN ล้วนไม่ต้องผูก · PD/QC ไม่ผูกจะส่งผลตรวจไม่ได้)
const inspectorIdOf = async (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (!isIntLike(v)) throw new AppError('inspector_id ไม่ถูกต้อง', 400);
  const [[ins]] = await query('SELECT id FROM inspectors WHERE id = ?', [Number(v)]);
  if (!ins) throw new AppError('ไม่พบผู้ตรวจที่เลือก', 400);
  return Number(v);
};

// ⚠️ ต้องเหลือ ADMIN ที่ใช้งานได้อย่างน้อย 1 บัญชีเสมอ (ไม่ใช่แค่ "บัญชีไหนก็ได้")
//    เหลือแต่ PD/QC = ไม่มีใครเข้า Master ได้อีก ต้องไปรันสคริปต์บนเครื่อง server
const assertOtherAdmin = async (exceptId) => {
  const [[{ n }]] = await query(
    "SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND FIND_IN_SET('ADMIN', role) > 0 AND id <> ?",
    [exceptId]
  );
  if (Number(n) === 0) throw new AppError('ต้องเหลือบัญชี ADMIN ที่ใช้งานได้อย่างน้อย 1 บัญชี', 400);
};

const log = (req, action, username) => console.log(`[users] ${req.user.username} ${action} ${username}`);

const findById = async (id) => {
  const [[u]] = await query('SELECT id, username, is_active, role FROM users WHERE id = ?', [Number(id)]);
  if (!u) throw new AppError('ไม่พบบัญชีนี้', 404);
  return u;
};

// ⚠️ ไม่มี password_hash ในผลลัพธ์ — SELECT ระบุคอลัมน์เอง ห้ามเปลี่ยนเป็น SELECT *
// pending/reg_* (คำขอจากหน้า /register) มาจาก db:apply 2026-11-19 — ยังไม่รัน = ไม่มีคำขอ
// matched_* = ผู้ตรวจที่ emp_code ตรงกับที่คนสมัครกรอก (กล่องอนุมัติเลือก "ผูกกับคนนี้" ให้เป็นค่าเริ่ม)
router.get('/', wrap(async (req, res) => {
  const base = `SELECT u.id, u.username, u.display_name, u.is_active, u.last_login_at, u.created_at,
            (u.passkey_hash IS NOT NULL) AS has_passkey,
            u.role, u.inspector_id, ins.name AS inspector_name, ins.emp_code AS inspector_code`;
  const [rows] = await query(
    `${base}, u.pending, u.reg_emp_code, u.reg_division_id, d.name AS reg_division_name,
            mi.id AS matched_inspector_id, mi.name AS matched_inspector_name
       FROM users u
       LEFT JOIN inspectors ins ON ins.id = u.inspector_id
       LEFT JOIN divisions d ON d.id = u.reg_division_id
       LEFT JOIN inspectors mi ON u.pending = 1 AND mi.emp_code = u.reg_emp_code
      ORDER BY u.username`
  ).catch((e) => {
    if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    return query(`${base}, 0 AS pending FROM users u LEFT JOIN inspectors ins ON ins.id = u.inspector_id ORDER BY u.username`);
  });
  res.json(rows);
}));

// ── คำขอสมัคร (หน้า /register) ──
// อนุมัติ: { roles, inspector: { mode: 'create' | 'link' | 'none', id?, name?, emp_code?, division_id? } }
//   create = สร้างผู้ตรวจใหม่ (emp_code ซ้ำ = 409 ให้เลือกผูกกับคนเดิม) · link = ผูกผู้ตรวจที่มีอยู่ · none = ไม่ผูก
//   ⚠️ UPDATE … AND pending = 1 → affectedRows 0 = มีคนอนุมัติ/ปฏิเสธไปแล้ว (409) · ทั้งหมดใน transaction เดียว
router.post('/:id/approve', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const id = Number(req.params.id);
  const role = roleOf(req.body?.roles);
  const ins = req.body?.inspector ?? { mode: 'none' };
  if (!['create', 'link', 'none'].includes(ins.mode)) throw new AppError('inspector.mode ต้องเป็น create / link / none', 400);

  const result = await withTransaction(async (conn) => {
    const [[u]] = await conn.query('SELECT id, username, pending FROM users WHERE id = ? FOR UPDATE', [id]);
    if (!u) throw new AppError('ไม่พบคำขอนี้', 404);
    if (!Number(u.pending)) throw new AppError(`${u.username} ถูกอนุมัติ/จัดการไปแล้ว — โหลดหน้าใหม่`, 409);
    let inspectorId = null;
    if (ins.mode === 'link') {
      if (!isIntLike(ins.id)) throw new AppError('เลือกผู้ตรวจที่จะผูก', 400);
      const [[x]] = await conn.query('SELECT id FROM inspectors WHERE id = ?', [Number(ins.id)]);
      if (!x) throw new AppError('ไม่พบผู้ตรวจที่เลือก', 400);
      inspectorId = x.id;
    } else if (ins.mode === 'create') {
      const name = String(ins.name ?? '').trim();
      const code = String(ins.emp_code ?? '').trim();
      if (!name || !code) throw new AppError('ผู้ตรวจใหม่ต้องมีชื่อและรหัสพนักงาน', 400);
      if (name.length > 100 || code.length > 50) throw new AppError('ชื่อ/รหัสผู้ตรวจยาวเกิน', 400);
      const [[dup]] = await conn.query('SELECT id, name FROM inspectors WHERE emp_code = ?', [code]);
      if (dup) throw new AppError(`รหัสพนักงาน ${code} เป็นของผู้ตรวจ "${dup.name}" อยู่แล้ว — เลือก "ผูกกับผู้ตรวจที่มีอยู่"`, 409);
      const div = ins.division_id === null || ins.division_id === undefined || ins.division_id === '' ? null : Number(ins.division_id);
      const [r] = await conn.execute('INSERT INTO inspectors (emp_code, name, division_id) VALUES (?, ?, ?)', [code, name, div]);
      inspectorId = r.insertId;
    }
    const [r] = await conn.execute(
      `UPDATE users SET pending = 0, is_active = 1, role = ?, inspector_id = ?, reg_emp_code = NULL, reg_division_id = NULL
        WHERE id = ? AND pending = 1`,
      [role, inspectorId, id]
    );
    if (!r.affectedRows) throw new AppError('คำขอนี้ถูกจัดการไปแล้ว — โหลดหน้าใหม่', 409);
    return { username: u.username, inspectorId };
  });
  log(req, `อนุมัติคำขอสมัคร (${role}${result.inspectorId ? ` · ผู้ตรวจ #${result.inspectorId}` : ''})`, result.username);
  if (ins.mode === 'create') req.app.get('io')?.emit('master_updated');
  res.json({ success: true, inspector_id: result.inspectorId });
}));

// ปฏิเสธ = ลบแถว — ได้เฉพาะ pending = 1 (ยังไม่เคย login ไม่มีร่องรอยในระบบ) · บัญชีจริงยังไม่มีการลบ
router.delete('/:id/pending', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const [[u]] = await query('SELECT id, username, pending FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!u) throw new AppError('ไม่พบคำขอนี้', 404);
  if (!Number(u.pending)) throw new AppError('ลบได้เฉพาะคำขอที่ยังไม่อนุมัติ — บัญชีที่ใช้งานแล้วให้ปิดใช้งานแทน', 400);
  await execute('DELETE FROM users WHERE id = ? AND pending = 1', [u.id]);
  log(req, 'ปฏิเสธคำขอสมัคร', u.username);
  res.json({ success: true });
}));

router.post('/', wrap(async (req, res) => {
  const username = usernameOf(req.body?.username);
  checkPassword(req.body?.password);
  const displayName = displayNameOf(req.body?.display_name);
  // บัญชีเดิมทุกบัญชีเป็น ADMIN — ไม่ส่ง role มาจึงได้ ADMIN เหมือนพฤติกรรมเดิมของแท็บนี้
  const role = req.body?.role === undefined ? 'ADMIN' : roleOf(req.body.role);
  const inspectorId = await inspectorIdOf(req.body?.inspector_id);

  // เช็คก่อนให้ได้ข้อความตรงจุด (UNIQUE ดักอีกชั้น → ER_DUP_ENTRY ใน errorHandler)
  const [[exists]] = await query('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) throw new AppError(`มีบัญชี ${username} อยู่แล้ว`, 409);

  const [r] = await execute(
    'INSERT INTO users (username, password_hash, display_name, role, inspector_id) VALUES (?, ?, ?, ?, ?)',
    [username, await hashPassword(req.body.password), displayName, role, inspectorId]
  );
  log(req, 'เพิ่มบัญชี', username);
  res.json({ success: true, id: r.insertId });
}));

// แก้ชื่อที่แสดง / เปิด-ปิดใช้งาน
router.put('/:id', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const target = await findById(req.params.id);

  const sets = [];
  const params = [];
  if ('display_name' in (req.body ?? {})) {
    sets.push('display_name = ?');
    params.push(displayNameOf(req.body.display_name));
  }
  if ('is_active' in (req.body ?? {})) {
    const active = req.body.is_active ? 1 : 0;
    if (!active) {
      // ⚠️ ปิดตัวเองไม่ได้ — กดพลาดแล้วหลุดทันทีและอาจไม่เหลือใครเปิดคืนให้
      if (target.id === req.user.id) throw new AppError('ปิดบัญชีของตัวเองไม่ได้', 400);
      await assertOtherAdmin(target.id);
    }
    sets.push('is_active = ?');
    params.push(active);
  }
  if ('role' in (req.body ?? {})) {
    const role = roleOf(req.body.role);
    if (!role.split(',').includes('ADMIN') && String(target.role ?? '').split(',').includes('ADMIN')) {
      // ⚠️ ถอด ADMIN ตัวเองไม่ได้ — กดพลาดแล้วหลุดจากหน้านี้ทันที (เหตุผลเดียวกับปิดบัญชีตัวเอง)
      if (target.id === req.user.id) throw new AppError('ถอดสิทธิ์ ADMIN ของตัวเองไม่ได้', 400);
      await assertOtherAdmin(target.id);
    }
    sets.push('role = ?');
    params.push(role);
  }
  if ('inspector_id' in (req.body ?? {})) {
    sets.push('inspector_id = ?');
    params.push(await inspectorIdOf(req.body.inspector_id));
  }
  if (!sets.length) throw new AppError('ไม่มีข้อมูลให้แก้ไข', 400);

  await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, target.id]);
  log(req, 'แก้บัญชี', target.username);
  res.json({ success: true });
}));

// ตั้งรหัสผ่านใหม่ — ของตัวเองหรือของคนอื่นที่ลืมรหัส
router.put('/:id/password', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const target = await findById(req.params.id);
  checkPassword(req.body?.password);

  await execute('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(req.body.password), target.id]);
  log(req, 'ตั้งรหัสผ่านใหม่ให้', target.username);
  res.json({ success: true });
}));

// ตั้ง / เปลี่ยน passkey — { passkey } · ลบทิ้งด้วย DELETE
router.put('/:id/passkey', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const target = await findById(req.params.id);
  const passkey = req.body?.passkey;
  if (typeof passkey !== 'string' || passkey.length < MIN_PASSKEY) {
    throw new AppError(`passkey ต้องยาวอย่างน้อย ${MIN_PASSKEY} ตัว`, 400);
  }

  const hash = await hashPasskey(passkey);
  // ⚠️ passkey ห้ามซ้ำกับของบัญชีอื่น — login ด้วย passkey ไม่มี username จะไม่รู้ว่าเป็นของใคร
  //    ข้อความไม่บอกว่าซ้ำกับใคร (ไม่งั้นกลายเป็นช่องทดลองเดา passkey ของคนอื่น)
  const [[taken]] = await query('SELECT id FROM users WHERE passkey_hash = ? AND id <> ?', [hash, target.id]);
  if (taken) throw new AppError('ใช้ passkey นี้ไม่ได้ — เลือกอันอื่น', 409);

  await execute('UPDATE users SET passkey_hash = ? WHERE id = ?', [hash, target.id]);
  log(req, 'ตั้ง passkey ให้', target.username);
  res.json({ success: true });
}));

router.delete('/:id/passkey', wrap(async (req, res) => {
  if (!isIntLike(req.params.id)) throw new AppError('id ไม่ถูกต้อง', 400);
  const target = await findById(req.params.id);
  await execute('UPDATE users SET passkey_hash = NULL WHERE id = ?', [target.id]);
  log(req, 'ลบ passkey ของ', target.username);
  res.json({ success: true });
}));

module.exports = router;
