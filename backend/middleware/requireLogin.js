// backend/middleware/requireLogin.js — กั้นเส้นที่แก้ข้อมูล Master ให้ต้อง login
//
// ขอบเขต: **เฉพาะเส้นที่เขียน master / baseline / ล้างใบที่ยกเลิก** ส่วนใบตรวจ Dashboard รายงาน
// เปิดได้โดยไม่ต้อง login ตามเดิม (หน้าไลน์ห้ามติด login) — ลิสต์เส้นที่ใช้อยู่ใน CLAUDE.md
//
// ⚠️ เช็ค is_active ใน DB ทุก request ไม่เชื่อ token อย่างเดียว — ปิดบัญชีคนที่ลาออกแล้ว
//    ต้องมีผลทันที ไม่ใช่รอ token หมดอายุอีก 12 ชั่วโมง
'use strict';

const env = require('../config/env');
const { query } = require('../db/pool');
const { verifyToken } = require('../services/auth');
const { AppError } = require('./errorHandler');

const NEED_LOGIN = 'กรุณาเข้าสู่ระบบก่อนแก้ไขข้อมูล Master';

const tokenOf = (req) => {
  const h = req.get?.('Authorization') ?? req.headers?.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

// แยก dependency ออกมาเป็นพารามิเตอร์ เทสได้โดยไม่ต้องมี DB
const makeRequireLogin = ({ secret, findUser }) => async (req, res, next) => {
  try {
    const payload = verifyToken(tokenOf(req), secret());
    if (!payload) throw new AppError(NEED_LOGIN, 401);

    const user = await findUser(payload.sub);
    if (!user || !Number(user.is_active)) throw new AppError(NEED_LOGIN, 401);

    req.user = {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      roles: rolesOf(user.role),
      inspector_id: user.inspector_id ?? null,
    };
    next();
  } catch (err) {
    next(err);
  }
};

// users.role เป็น SET → mysql2 คืน string 'ADMIN,QC' · แตกเป็น array ที่เดียว
const rolesOf = (v) => String(v ?? '').split(',').map((r) => r.trim()).filter(Boolean);

const findUser = async (id) => {
  const [rows] = await query(
    'SELECT id, username, display_name, is_active, role, inspector_id FROM users WHERE id = ?',
    [Number(id)]
  );
  return rows[0] ?? null;
};

const requireLogin = makeRequireLogin({ secret: () => env.AUTH_SECRET, findUser });

// ข้ามการกั้นเมื่อ pred(req) เป็นจริง — ใช้ที่เดียวคือ POST /master/add ของ inspectors
// (ปุ่ม "+ เพิ่มผู้ตรวจใหม่" ที่หน้าใบตรวจ ซึ่งต้องใช้ได้โดยไม่ login)
const requireLoginUnless = (pred, guard = requireLogin) => (req, res, next) =>
  (pred(req) ? next() : guard(req, res, next));

// login แล้ว + ต้องมีอย่างน้อยหนึ่ง role ในลิสต์ — ไม่มี = 403 (ไม่ใช่ 401: login ถูกแล้วแต่ไม่มีสิทธิ์
// ฝั่ง client 401 = ล้าง session · 403 ต้องไม่ล้าง ไม่งั้น QC กดเข้า Master แล้วหลุดออกจากหน้า Set up ด้วย)
//
// ⚠️ ทุกเส้นที่เคยเป็น requireLogin (แก้ master / baseline / ล้างใบ / แก้ค่า / users) ต้องเป็น
//    requireRole('ADMIN') — บัญชี PD/QC ที่เพิ่มมาเพื่อหน้า Set up ห้ามเข้าไปแก้ Master ได้
//    กั้นที่ server จริง ไม่ใช่ซ่อนปุ่มฝั่ง client อย่างเดียว
const makeRequireRole = (guard) => (...roles) => (req, res, next) =>
  guard(req, res, (err) => {
    if (err) return next(err);
    if (!req.user.roles.some((r) => roles.includes(r))) {
      return next(new AppError(`บัญชีนี้ไม่มีสิทธิ์ (ต้องเป็น ${roles.join(' หรือ ')})`, 403));
    }
    next();
  });
const requireRole = makeRequireRole(requireLogin);
const requireAdmin = requireRole('ADMIN');

module.exports = {
  requireLogin, requireLoginUnless, requireRole, requireAdmin, makeRequireLogin, makeRequireRole,
  rolesOf, tokenOf, NEED_LOGIN,
};
