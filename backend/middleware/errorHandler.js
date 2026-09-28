// backend/middleware/errorHandler.js — ที่เดียวที่ตัดสินว่า error จะถูกตอบกลับหน้าเว็บยังไง
//
// ทำไมต้องมี: ระบบเดิมทุก route ตอบ 500 ด้วย `e.message` ตรง ๆ ซึ่งเป็นข้อความของ MySQL
// ชื่อตาราง ชื่อคอลัมน์ ชื่อ constraint หลุดไปโผล่บนหน้าจอผู้ใช้ (และผู้ใช้ก็อ่านไม่รู้เรื่องอยู่ดี)
//
// ข้อความที่ "ตั้งใจให้ผู้ใช้เห็น" ต้องประกาศตัวเองด้วย AppError เท่านั้น — ไม่ใช่ทุก error
// ที่มีข้อความไทยแล้วจะถูกส่งออกไปอัตโนมัติ
'use strict';

const GENERIC = 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่ หรือแจ้งผู้ดูแลระบบ';

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.expose = true;
  }
}

// ---- ส่วน pure (เทสได้ ไม่แตะ res/console) ----

// แปลง error ของ MySQL ที่ผู้ใช้ "ควรรู้" ให้เป็นข้อความที่ทำอะไรต่อได้
// นอกจากนี้ปล่อยเป็น 500 ข้อความกลาง ๆ
const mapDbError = (err) => {
  switch (err?.code) {
    case 'ER_DUP_ENTRY':
      return { status: 409, message: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว (รหัสหรือลำดับซ้ำ)' };
    case 'ER_ROW_IS_REFERENCED_2':
      // FK เป็น RESTRICT โดยตั้งใจ — ลบ master ที่มีใบตรวจอ้างอยู่ไม่ได้
      return {
        status: 409,
        message: 'ลบไม่ได้ เพราะมีใบตรวจอ้างอิงข้อมูลนี้อยู่ — ให้ปิดใช้งาน (is_active) แทนการลบ',
      };
    case 'ER_NO_REFERENCED_ROW_2':
      return { status: 400, message: 'อ้างถึงข้อมูลที่ไม่มีอยู่จริง (division / model / machine / inspector)' };
    case 'ER_NO_SUCH_TABLE':
      return { status: 500, message: 'ยังไม่ได้สร้างตารางในฐานข้อมูล — รัน npm run db:apply ก่อน' };
    default:
      return null;
  }
};

// resolveErrorResponse(err) → { status, message }
// status นอกช่วง 400-599 ถือเป็น 500 (ค่าที่หลุดมาจาก library เอาไปใส่ res.status ตรง ๆ จะ throw)
const resolveErrorResponse = (err) => {
  const mapped = mapDbError(err);
  if (mapped) return mapped;

  const raw = err?.status ?? err?.statusCode;
  const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
  const message =
    err?.expose === true && typeof err?.message === 'string' && err.message.trim() !== ''
      ? err.message
      : GENERIC;
  return { status, message };
};

// ---- middleware ----

// ต้อง mount หลัง route ทั้งหมด
const errorHandler = (err, req, res, _next) => {
  const { status, message } = resolveErrorResponse(err);
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl} →`, err);
  } else {
    console.warn(`[warn] ${req.method} ${req.originalUrl} → ${status} ${message}`);
  }
  // client อ่าน key `error` (apiCall ใน App.js อ่าน data.error) — อย่าเปลี่ยนเป็น message เฉย ๆ
  res.status(status).json({ error: message });
};

// 404 ของทุกเส้นใต้ /api ต้องเป็น JSON ไม่ใช่ HTML (หน้าเว็บเป็นหน้าที่ของ Apache)
const notFoundApi = (req, res) => {
  res.status(404).json({ error: `ไม่พบ endpoint: ${req.method} ${req.originalUrl}` });
};

// ครอบ async route ให้ error เด้งเข้า errorHandler เอง ไม่ต้องเขียน try/catch ทุกเส้น
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, errorHandler, notFoundApi, wrap, resolveErrorResponse, mapDbError };
