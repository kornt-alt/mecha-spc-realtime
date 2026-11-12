// backend/config/env.js — ที่เดียวที่อ่าน process.env
//
// ทำไมต้องมี: เดิม index.js อ่าน process.env กระจายอยู่หลายจุด ตั้งค่าตกไปตัวหนึ่งแล้วไม่รู้ตัว
// จนกว่าจะมี request แรกเข้ามาแล้ว query พัง — ตรงนี้ fail fast ตั้งแต่ตอน start แทน
'use strict';

require('dotenv').config();

// ค่าที่ขาดไม่ได้จริง ๆ — ไม่มีแล้วต่อ DB ไม่ติดแน่นอน จึงหยุดตั้งแต่ตอน start
// (DB_PASSWORD ไม่อยู่ในลิสต์เพราะ MySQL ที่ตั้ง user ไว้แบบไม่มีรหัสผ่านก็มีจริง)
const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_NAME'];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[env] ขาดค่าใน backend/.env : ${missing.join(', ')}`);
  console.error('[env] ดูเทมเพลตได้ที่ backend/.env.example');
  process.exit(1);
}

const env = {
  PORT: parseInt(process.env.PORT, 10) || 5000,

  // Database
  DB_HOST: process.env.DB_HOST,
  DB_PORT: parseInt(process.env.DB_PORT, 10) || 3306,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME,
  DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX, 10) || 10,

  // prefix ที่แอปถูก mount ไว้หลัง Apache reverse proxy
  // ⚠️ ต้องตรงกับ APP_BASE ใน frontend/src/utils/config.js และ homepage ใน frontend/package.json
  // ย้ายมาเป็น env เพื่อให้เปลี่ยนที่เดียวได้ แต่ค่า default คือของจริงที่ production ใช้อยู่
  APP_BASE: (process.env.APP_BASE || '/Mecha-Spc-Realtime').replace(/\/+$/, ''),

  // ลายเซ็น token ของการ login หน้า Master (services/auth.js)
  // ⚠️ ไม่อยู่ใน REQUIRED โดยตั้งใจ — deploy แล้วลืมตั้ง server ต้องยังขึ้น ใบตรวจหน้าไลน์ห้ามล่ม
  //    เพราะ login ของหน้า Master · ไม่ตั้ง = สุ่มใหม่ทุกครั้งที่ start (ข้างล่าง) ผลคือ restart แล้ว
  //    ทุกคนต้อง login ใหม่ ซึ่งยอมรับได้ แต่ควรตั้งค่าจริงไว้
  AUTH_SECRET: process.env.AUTH_SECRET || '',
  // อายุ token (ชั่วโมง) — 12 = หนึ่งกะ
  AUTH_TOKEN_HOURS: Number(process.env.AUTH_TOKEN_HOURS) > 0 ? Number(process.env.AUTH_TOKEN_HOURS) : 12,

  // ชื่อ DB ของระบบ Drawing Digital (MECHA1) บน server เดียวกัน — ดึงเครื่อง/item/เครื่อง↔item (services/drawingSync.js)
  // ⚠️ ไม่บังคับ · ว่าง = ปิดฟีเจอร์ (ปุ่มไม่ขึ้น) · อ่านอย่างเดียว ไม่เขียนกลับ
  DRAWING_DB_NAME: (process.env.DRAWING_DB_NAME || '').trim(),
};

if (!env.AUTH_SECRET) {
  env.AUTH_SECRET = require('crypto').randomBytes(32).toString('hex');
  console.warn('[env] ไม่ได้ตั้ง AUTH_SECRET ใน backend/.env — สุ่มให้ชั่วคราว restart แล้วทุกคนต้อง login หน้า Master ใหม่');
}

module.exports = env;
