// backend/routes/auth.js — login + สมัครใช้งาน
//
// บัญชีเกิดได้ 3 ทาง: ADMIN เพิ่มที่ Master › ผู้ใช้ & สิทธิ์ (routes/users.js) · `npm run user:add` บนเครื่อง server ·
// สมัครเองที่ /register (POST /register ข้างล่าง) — ⚠️ ทางหลังได้บัญชี pending ที่ login ไม่ได้จนกว่า ADMIN อนุมัติ
// (หน้าเว็บเปิดได้ทุกเครื่องในโรงงาน สมัครแล้วใช้ได้ทันที = login ไม่ได้กันอะไร)
'use strict';

const express = require('express');
const env = require('../config/env');
const { query, execute } = require('../db/pool');
const { hashPassword, verifyPassword, hashPasskey, signToken } = require('../services/auth');
const { requireLogin, optionalUser, rolesOf } = require('../middleware/requireLogin');
const { loadPermissions, allowedKeys } = require('../services/menuAccess');
const { rateLimit } = require('../middleware/rateLimit');
const { AppError, wrap } = require('../middleware/errorHandler');
const { usernameOf, checkPassword, displayNameOf } = require('../services/userRules');

const router = express.Router();

// ⚠️ นับต่อ IP + username ไม่ใช่ IP อย่างเดียว — backend อยู่หลัง Apache reverse proxy
//    และไม่ได้ตั้ง trust proxy ไว้ req.ip จึงอาจเป็น IP ของ Apache ตัวเดียวทั้งโรงงาน
//    นับต่อ IP ล้วน ๆ คนเดียวพิมพ์ผิดรัว ๆ จะล็อกทุกคนออกจากหน้า Master พร้อมกัน
const loginLimiter = rateLimit({
  name: 'login',
  limit: 10,
  windowMs: 15 * 60 * 1000,
  message: 'พยายามเข้าสู่ระบบถี่เกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
  keyOf: (req) => `${req.ip || 'unknown'}:${String(req.body?.username ?? '').trim().toLowerCase()}`,
});

// passkey ไม่มี username ให้แยกถัง — นับต่อ IP ล้วน จึงหลวมกว่าเล็กน้อย
// ⚠️ ถ้า req.ip เป็นของ Apache ตัวเดียว ถังนี้ใช้ร่วมกันทั้งโรงงาน เดาผิดรัว ๆ แล้วทุกคนเข้าด้วย passkey
//    ไม่ได้ 15 นาที — แต่ช่อง username + password ยังใช้ได้ตามปกติ (คนละถัง) ยอมรับได้
const passkeyLimiter = rateLimit({
  name: 'passkey',
  limit: 20,
  windowMs: 15 * 60 * 1000,
  message: 'ใส่ passkey ผิดถี่เกินไป กรุณารอ 15 นาที หรือเข้าด้วยชื่อผู้ใช้และรหัสผ่าน',
});
const pickLimiter = (req, res, next) =>
  (req.body?.passkey !== undefined ? passkeyLimiter : loginLimiter)(req, res, next);

// ข้อความเดียวกันทั้ง "ไม่พบผู้ใช้" และ "รหัสผิด" — แยกเมื่อไหร่คือบอกคนเดาว่า username ไหนมีจริง
const BAD_LOGIN = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

// hash ทิ้งไว้ใช้ตอนไม่พบ user — ต้องเป็นรูปที่ถูกต้องจริง verifyPassword ถึงจะรัน scrypt เต็มรอบ
// (ค่ามั่ว ๆ จะถูกตีกลับทันทีโดยไม่ hash ซึ่งเร็วกว่าเคสที่มี user อยู่จริงจนจับเวลาได้)
const DUMMY_HASH = hashPassword('no-such-user');

// roles/inspector_id ไปกับ session — หน้า Set up ใช้แยกมุมมอง PD/QC (ตัวกั้นจริงคือ requireRole ฝั่ง server)
// ⚠️ รูปต้องตรงกับ req.user ของ requireLogin (GET /me คืนตัวนั้น)
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  display_name: u.display_name ?? null,
  roles: rolesOf(u.role),
  inspector_id: u.inspector_id ?? null,
});

// login ได้ 2 ทาง: { passkey } ช่องเดียว หรือ { username, password }
router.post('/login', pickLimiter, wrap(async (req, res) => {
  let user;
  if (req.body?.passkey !== undefined) {
    const passkey = String(req.body.passkey ?? '');
    if (!passkey) throw new AppError('กรอก passkey', 400);
    [[user]] = await query(
      'SELECT id, username, display_name, is_active, role, inspector_id FROM users WHERE passkey_hash = ?',
      [await hashPasskey(passkey)]
    );
    if (!user) throw new AppError('passkey ไม่ถูกต้อง', 401);
  } else {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!username || !password) throw new AppError('กรอกชื่อผู้ใช้และรหัสผ่าน', 400);

    // pending มาจาก db:apply 2026-11-19 — ยังไม่รันต้องยัง login ได้ (หน้า Master/Set up ห้ามล็อกตัวเอง)
    [[user]] = await query(
      'SELECT id, username, display_name, password_hash, is_active, pending, role, inspector_id FROM users WHERE username = ?',
      [username]
    ).catch((e) => {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
      return query(
        'SELECT id, username, display_name, password_hash, is_active, 0 AS pending, role, inspector_id FROM users WHERE username = ?',
        [username]
      );
    });
    // ไม่พบ user ก็ยังเสียเวลา verify เท่ากัน — ไม่งั้นความเร็วของคำตอบบอกได้ว่า username มีจริงไหม
    const ok = await verifyPassword(password, user?.password_hash ?? await DUMMY_HASH);
    if (!user || !ok) throw new AppError(BAD_LOGIN, 401);
    // ⚠️ บอกสถานะ "รออนุมัติ" หลังรหัสถูกเท่านั้น — ไม่งั้นกลายเป็นช่องเช็คว่า username ไหนมีจริง
    if (Number(user.pending)) throw new AppError('บัญชีนี้รอ ADMIN อนุมัติ — ติดต่อ ADMIN ให้อนุมัติที่ Master › ผู้ใช้ & สิทธิ์', 403);
  }
  if (!Number(user.is_active)) throw new AppError('บัญชีนี้ถูกปิดใช้งาน', 403);

  await execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  // console.log(`[auth] ${user.username} เข้าสู่ระบบ${req.body?.passkey !== undefined ? ' (passkey)' : ''}`);

  res.json({
    token: signToken({ sub: user.id, username: user.username }, env.AUTH_SECRET, env.AUTH_TOKEN_HOURS),
    user: publicUser(user),
  });
}));

// ── สมัครใช้งานเอง (หน้า /register) ── ไม่ต้อง login
// body: { username, password, display_name, emp_code, division_id?, role: 'PD' | 'QC' }
// → บัญชี pending = 1 + is_active = 0 · role ที่ขอได้แค่ PD/QC (ADMIN ปรับได้ตอนอนุมัติ) · ยังไม่ผูกผู้ตรวจ
// ⚠️ นับต่อ IP — หลัง Apache req.ip อาจเป็นตัวเดียวทั้งโรงงาน ถังเต็ม = สมัครไม่ได้ชั่วคราว ไม่กระทบ login (คนละถัง)
const registerLimiter = rateLimit({
  name: 'register',
  limit: 5,
  windowMs: 60 * 60 * 1000,
  message: 'สมัครถี่เกินไป กรุณารอสักครู่แล้วลองใหม่ หรือให้ ADMIN เพิ่มบัญชีให้',
});
const REGISTER_ROLES = ['PD', 'QC'];

router.post('/register', registerLimiter, wrap(async (req, res) => {
  const username = usernameOf(req.body?.username);
  checkPassword(req.body?.password);
  const displayName = displayNameOf(req.body?.display_name);
  if (!displayName) throw new AppError('กรอกชื่อ-นามสกุล (ชื่อนี้จะขึ้นบนใบตรวจ)', 400);
  const empCode = String(req.body?.emp_code ?? '').trim();
  if (!empCode) throw new AppError('กรอกรหัสพนักงาน', 400);
  if (empCode.length > 50) throw new AppError('รหัสพนักงานยาวเกิน 50 ตัว', 400);
  const role = String(req.body?.role ?? '').trim().toUpperCase();
  if (!REGISTER_ROLES.includes(role)) throw new AppError('เลือกตำแหน่ง PD หรือ QC', 400);
  let divisionId = null;
  if (req.body?.division_id !== undefined && req.body?.division_id !== null && req.body?.division_id !== '') {
    divisionId = Number(req.body.division_id);
    const [[d]] = Number.isInteger(divisionId) ? await query('SELECT id FROM divisions WHERE id = ?', [divisionId]) : [[]];
    if (!d) throw new AppError('ไม่พบ Division ที่เลือก', 400);
  }

  const [[exists]] = await query('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) throw new AppError(`มีชื่อผู้ใช้ ${username} แล้ว — เลือกชื่ออื่น`, 409);

  try {
    await execute(
      `INSERT INTO users (username, password_hash, display_name, role, is_active, pending, reg_emp_code, reg_division_id)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
      [username, await hashPassword(req.body.password), displayName, role, empCode, divisionId]
    );
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') throw new AppError('ระบบยังไม่พร้อมรับสมัคร (ผู้ดูแลต้องรัน npm run db:apply) — ให้ ADMIN เพิ่มบัญชีให้ก่อน', 503);
    throw e;
  }
  console.log(`[auth] สมัครใช้งาน ${username} (${role}) — รอ ADMIN อนุมัติ`);
  res.json({ success: true });
}));

// หน้าเว็บใช้เช็คว่า token ที่เก็บไว้ยังใช้ได้ (ยังไม่หมดอายุ + บัญชียังไม่ถูกปิด)
router.get('/me', requireLogin, (req, res) => res.json({ user: req.user }));

// เมนูที่คนนี้ (หรือคนที่ไม่ได้ login) ใช้ได้ — header / การ์ดหน้าแรก / route ฝั่งหน้าเว็บซ่อนตามนี้
// ⚠️ ไม่ต้อง login · token เสีย/หมดอายุ = คำตอบของ GUEST (ไม่ 401 — หน้าแรกต้องเปิดได้เสมอ)
router.get('/menu', wrap(async (req, res) => {
  const user = await optionalUser(req);
  const perms = await loadPermissions();
  // guestKeys = เมนูที่เปิดให้คนไม่ login — หน้าเว็บใช้ตัดสินว่าหน้านั้นต้องขึ้นกล่อง login ไหม
  res.json({ keys: allowedKeys(perms, user), guestKeys: allowedKeys(perms, null), userId: user?.id ?? null });
}));

module.exports = router;
