// services/userRules.js — กฎตรวจค่าของบัญชีผู้ใช้ ใช้ร่วมกันระหว่าง routes/users.js (ADMIN เพิ่มให้) และ POST /auth/register (สมัครเอง)
'use strict';

const { AppError } = require('../middleware/errorHandler');

const MIN_PASSWORD = 6; // เท่ากับ scripts/user.js
const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;

const usernameOf = (v) => {
  const username = String(v ?? '').trim();
  if (!USERNAME_RE.test(username)) {
    throw new AppError('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - ยาว 3-50 ตัว (ห้ามเว้นวรรค)', 400);
  }
  return username;
};

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

module.exports = { MIN_PASSWORD, USERNAME_RE, usernameOf, checkPassword, displayNameOf };
