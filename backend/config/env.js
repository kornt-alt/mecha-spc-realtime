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
};

module.exports = env;
