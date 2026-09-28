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

    req.user = { id: user.id, username: user.username, display_name: user.display_name };
    next();
  } catch (err) {
    next(err);
  }
};

const findUser = async (id) => {
  const [rows] = await query(
    'SELECT id, username, display_name, is_active FROM users WHERE id = ?',
    [Number(id)]
  );
  return rows[0] ?? null;
};

const requireLogin = makeRequireLogin({ secret: () => env.AUTH_SECRET, findUser });

// ข้ามการกั้นเมื่อ pred(req) เป็นจริง — ใช้ที่เดียวคือ POST /master/add ของ inspectors
// (ปุ่ม "+ เพิ่มผู้ตรวจใหม่" ที่หน้าใบตรวจ ซึ่งต้องใช้ได้โดยไม่ login)
const requireLoginUnless = (pred, guard = requireLogin) => (req, res, next) =>
  (pred(req) ? next() : guard(req, res, next));

module.exports = { requireLogin, requireLoginUnless, makeRequireLogin, tokenOf, NEED_LOGIN };
