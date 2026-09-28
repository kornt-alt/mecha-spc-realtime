// backend/routes/auth.js — login สำหรับหน้า Master
//
// ไม่มีหน้าสมัครใช้งานและไม่มีหน้าจัดการผู้ใช้โดยตั้งใจ — บัญชีสร้างด้วย `npm run user:add`
// บนเครื่อง server เท่านั้น (scripts/user.js) คนที่แก้ master ได้มีไม่กี่คน
'use strict';

const express = require('express');
const env = require('../config/env');
const { query, execute } = require('../db/pool');
const { hashPassword, verifyPassword, hashPasskey, signToken } = require('../services/auth');
const { requireLogin } = require('../middleware/requireLogin');
const { rateLimit } = require('../middleware/rateLimit');
const { AppError, wrap } = require('../middleware/errorHandler');

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

const publicUser = (u) => ({ id: u.id, username: u.username, display_name: u.display_name ?? null });

// login ได้ 2 ทาง: { passkey } ช่องเดียว หรือ { username, password }
router.post('/login', pickLimiter, wrap(async (req, res) => {
  let user;
  if (req.body?.passkey !== undefined) {
    const passkey = String(req.body.passkey ?? '');
    if (!passkey) throw new AppError('กรอก passkey', 400);
    [[user]] = await query(
      'SELECT id, username, display_name, is_active FROM users WHERE passkey_hash = ?',
      [await hashPasskey(passkey)]
    );
    if (!user) throw new AppError('passkey ไม่ถูกต้อง', 401);
  } else {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!username || !password) throw new AppError('กรอกชื่อผู้ใช้และรหัสผ่าน', 400);

    [[user]] = await query(
      'SELECT id, username, display_name, password_hash, is_active FROM users WHERE username = ?',
      [username]
    );
    // ไม่พบ user ก็ยังเสียเวลา verify เท่ากัน — ไม่งั้นความเร็วของคำตอบบอกได้ว่า username มีจริงไหม
    const ok = await verifyPassword(password, user?.password_hash ?? await DUMMY_HASH);
    if (!user || !ok) throw new AppError(BAD_LOGIN, 401);
  }
  if (!Number(user.is_active)) throw new AppError('บัญชีนี้ถูกปิดใช้งาน', 403);

  await execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  // console.log(`[auth] ${user.username} เข้าสู่ระบบ${req.body?.passkey !== undefined ? ' (passkey)' : ''}`);

  res.json({
    token: signToken({ sub: user.id, username: user.username }, env.AUTH_SECRET, env.AUTH_TOKEN_HOURS),
    user: publicUser(user),
  });
}));

// หน้าเว็บใช้เช็คว่า token ที่เก็บไว้ยังใช้ได้ (ยังไม่หมดอายุ + บัญชียังไม่ถูกปิด)
router.get('/me', requireLogin, (req, res) => res.json({ user: req.user }));

module.exports = router;
