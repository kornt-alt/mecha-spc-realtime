// backend/routes/users.js — จัดการบัญชี login หน้า Master (แท็บ "ผู้ใช้" ในหน้า Master)
//
// ⚠️ ทุกเส้นต้อง login — คนที่ login อยู่เป็นคนเพิ่มบัญชีให้คนอื่น ไม่มีหน้าสมัครสาธารณะโดยตั้งใจ
//    (หน้าเว็บเปิดได้ทุกเครื่องในโรงงาน ใครก็สมัครแล้วแก้ master ได้ = login ไม่ได้กันอะไร)
// ⚠️ ไม่ผ่าน generic CRUD ของ routes/master.js และ users ห้ามอยู่ใน ALLOWED_COLUMNS —
//    รหัสผ่านต้อง hash ก่อนลง DB และ password_hash ห้ามถูกส่งกลับไปหน้าเว็บ
// ไม่มีการลบบัญชี ใช้ปิดใช้งานแทน (ร่องรอยใน log ยังอ้างชื่อนี้อยู่)
'use strict';

const express = require('express');
const { query, execute } = require('../db/pool');
const { hashPassword, hashPasskey } = require('../services/auth');
const { requireAdmin } = require('../middleware/requireLogin');
const { AppError, wrap } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAdmin);

const MIN_PASSWORD = 6; // เท่ากับ scripts/user.js
// passkey ใช้เข้าได้ด้วยช่องเดียว (ไม่มี username ช่วย) จึงสั้นกว่านี้ไม่ได้
const MIN_PASSKEY = 6;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;

const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));

const checkPassword = (pw) => {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
    throw new AppError(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว`, 400);
  }
};

const displayNameOf = (v) => {
  const s = String(v ?? '').trim();
  if (s.length > 100) throw new AppError('ชื่อที่แสดงยาวเกิน 100 ตัวอักษร', 400);
  return s || null;
};

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
router.get('/', wrap(async (req, res) => {
  const [rows] = await query(
    `SELECT u.id, u.username, u.display_name, u.is_active, u.last_login_at, u.created_at,
            (u.passkey_hash IS NOT NULL) AS has_passkey,
            u.role, u.inspector_id, ins.name AS inspector_name, ins.emp_code AS inspector_code
       FROM users u
       LEFT JOIN inspectors ins ON ins.id = u.inspector_id
      ORDER BY u.username`
  );
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  if (!USERNAME_RE.test(username)) {
    throw new AppError('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - ยาว 3-50 ตัว (ห้ามเว้นวรรค)', 400);
  }
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
