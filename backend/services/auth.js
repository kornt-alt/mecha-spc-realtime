// backend/services/auth.js — hash รหัสผ่าน + เซ็น/ตรวจ token (pure ไม่แตะ DB)
//
// ⚠️ ใช้ crypto ของ Node ล้วน ไม่ใช้ bcrypt / jsonwebtoken โดยตั้งใจ
//    bcrypt เป็น native module ต้อง compile ตอน npm install และเครื่อง server ในเครือไม่มีเน็ตออก
//    (MSE_AUTO_PLAN ต้องขน node_modules ขึ้นไปเอง) · token ของระบบนี้มีคนออกและคนตรวจเป็น
//    server ตัวเดียวกัน ไม่ต้องคุยกับระบบอื่น จึงไม่ต้องเป็น JWT มาตรฐาน
//
// รูป token: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(ส่วนแรก, secret))
// payload = { sub: user id, username, exp: วินาที epoch }
'use strict';

const crypto = require('crypto');

// ── รหัสผ่าน ────────────────────────────────────────────────────────────────
//
// เก็บเป็น 'scrypt$<salt hex>$<hash hex>' — มีชื่ออัลกอริทึมนำหน้า วันหลังเปลี่ยนวิธีได้โดยแยกของเก่าออก
const KEYLEN = 64;

const hashPassword = (password) => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16);
  crypto.scrypt(String(password), salt, KEYLEN, (err, key) => {
    if (err) return reject(err);
    resolve(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`);
  });
});

// คืน false ทุกกรณีที่ผิดรูป ไม่ throw — ค่าที่เก็บเพี้ยนต้องแปลว่า "login ไม่ผ่าน" ไม่ใช่ 500
const verifyPassword = (password, stored) => new Promise((resolve) => {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return resolve(false);
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length !== KEYLEN) return resolve(false);

  crypto.scrypt(String(password ?? ''), salt, KEYLEN, (err, key) => {
    // ⚠️ timingSafeEqual ไม่ใช่ === — เทียบ string ตรง ๆ หยุดทันทีที่เจอตัวแรกที่ต่าง
    //    เวลาที่ใช้จึงบอกได้ว่าตรงไปกี่ไบต์
    resolve(!err && crypto.timingSafeEqual(key, expected));
  });
});

// ── passkey ───────────────────────────────────────────────────────────────
//
// passkey = รหัสลับรายบัญชีที่พิมพ์ช่องเดียวแล้วเข้าได้เลย ไม่ต้องใส่ username
// ⚠️ ต้องค้นแถวจาก passkey ได้ตรง ๆ (ไม่รู้ว่าเป็นของใครจนกว่าจะเจอ) salt สุ่มรายแถวจึงใช้ไม่ได้
//    → scrypt ด้วย salt คงที่ ได้ค่าเดิมทุกครั้ง ค้นด้วย WHERE passkey_hash = ? ได้ และยังช้าพอ
//    ให้การไล่เดาจาก DB ที่หลุดไปมีราคา (ต่างจาก sha256 เปล่า ๆ ที่เดา PIN 6 หลักได้ในเสี้ยววินาที)
// ⚠️ ห้ามเปลี่ยน PASSKEY_SALT — เปลี่ยนเมื่อไหร่ passkey ทุกบัญชีใช้ไม่ได้ทันที ต้องตั้งใหม่หมด
// ⚠️ ไม่ใช้ AUTH_SECRET เป็น salt เพราะมันสุ่มใหม่ทุก start ได้เมื่อไม่ได้ตั้งใน .env
const PASSKEY_SALT = 'spc-realtime/passkey/v1';

const hashPasskey = (passkey) => new Promise((resolve, reject) => {
  crypto.scrypt(String(passkey), PASSKEY_SALT, 32, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
});

// ── token ─────────────────────────────────────────────────────────────────

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest();

const signToken = (payload, secret, ttlHours, nowMs = Date.now()) => {
  const body = { ...payload, exp: Math.floor(nowMs / 1000) + Math.round(ttlHours * 3600) };
  const head = b64url(JSON.stringify(body));
  return `${head}.${b64url(hmac(head, secret))}`;
};

// คืน payload เมื่อผ่าน ไม่ผ่าน (ลายเซ็นผิด / หมดอายุ / รูปเพี้ยน) คืน null — ไม่บอกว่าเพราะอะไร
const verifyToken = (token, secret, nowMs = Date.now()) => {
  if (typeof token !== 'string') return null;
  const [head, sig, extra] = token.split('.');
  if (!head || !sig || extra !== undefined) return null;

  const expected = hmac(head, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
  return payload;
};

module.exports = { hashPassword, verifyPassword, hashPasskey, signToken, verifyToken };
