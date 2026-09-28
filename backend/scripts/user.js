// backend/scripts/user.js — จัดการบัญชีที่ login เข้าหน้า Master ได้
//
// ใช้ (บนเครื่อง server):
//   npm run user:add -- <username> "<ชื่อที่แสดง>"   สร้างบัญชี (ถามรหัสผ่าน)
//   npm run user:passwd -- <username>               ตั้งรหัสผ่านใหม่ + เปิดใช้งานกลับ
//   npm run user:disable -- <username>              ปิดบัญชี (มีผลทันที ไม่ต้องรอ token หมดอายุ)
//   npm run user:list                               ดูรายชื่อ
//
// ⚠️ ไม่รับรหัสผ่านทาง argument โดยตั้งใจ — ค้างอยู่ใน shell history / ในรายการ process
//    ถามแบบไม่แสดงบนจอแทน · ไม่มีหน้าจัดการผู้ใช้ในเว็บ คนที่แก้ master ได้มีไม่กี่คน
'use strict';

const readline = require('readline');
const mysql = require('mysql2/promise');
const env = require('../config/env');
const { hashPassword } = require('../services/auth');

const MIN_PASSWORD = 6;

// readline ที่ไม่ echo ตัวอักษร — แสดงแค่ข้อความคำถาม
const askHidden = (question) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let asked = false;
  rl._writeToOutput = (s) => {
    if (!asked) { rl.output.write(s); asked = true; }
  };
  rl.question(question, (answer) => {
    rl.close();
    process.stdout.write('\n');
    resolve(answer);
  });
});

const askNewPassword = async () => {
  const a = await askHidden('รหัสผ่านใหม่: ');
  if (a.length < MIN_PASSWORD) throw new Error(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว`);
  const b = await askHidden('พิมพ์ซ้ำอีกครั้ง: ');
  if (a !== b) throw new Error('รหัสผ่านสองครั้งไม่ตรงกัน');
  return hashPassword(a);
};

const USAGE = 'ใช้: node scripts/user.js add <username> "<ชื่อ>" | passwd <username> | disable <username> | list';

const main = async () => {
  const [cmd, username, displayName] = process.argv.slice(2);
  if (!cmd || (cmd !== 'list' && !username)) throw new Error(USAGE);

  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });
  try {
    if (cmd === 'add') {
      const [[exists]] = await conn.query('SELECT id FROM users WHERE username = ?', [username]);
      if (exists) throw new Error(`มี ${username} อยู่แล้ว — เปลี่ยนรหัสใช้ passwd`);
      const hash = await askNewPassword();
      await conn.execute(
        'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
        [username, hash, displayName || null]
      );
      console.log(`สร้างบัญชี ${username} แล้ว`);
    } else if (cmd === 'passwd') {
      const hash = await askNewPassword();
      const [r] = await conn.execute(
        'UPDATE users SET password_hash = ?, is_active = 1 WHERE username = ?', [hash, username]
      );
      if (!r.affectedRows) throw new Error(`ไม่พบ ${username}`);
      console.log(`ตั้งรหัสผ่านใหม่ให้ ${username} แล้ว (เปิดใช้งานด้วย)`);
    } else if (cmd === 'disable') {
      const [r] = await conn.execute('UPDATE users SET is_active = 0 WHERE username = ?', [username]);
      if (!r.affectedRows) throw new Error(`ไม่พบ ${username}`);
      console.log(`ปิดบัญชี ${username} แล้ว — หน้า Master ที่เปิดค้างอยู่จะบันทึกไม่ได้ทันที`);
    } else if (cmd === 'list') {
      const [rows] = await conn.query(
        'SELECT username, display_name, is_active, last_login_at FROM users ORDER BY username'
      );
      if (!rows.length) console.log('ยังไม่มีบัญชี — สร้างด้วย npm run user:add -- <username> "<ชื่อ>"');
      for (const u of rows) {
        console.log(`${u.is_active ? '✓' : '✗'} ${u.username.padEnd(16)} ${u.display_name ?? ''}` +
          `  (login ล่าสุด: ${u.last_login_at ? new Date(u.last_login_at).toLocaleString('th-TH') : '—'})`);
      }
    } else {
      throw new Error(USAGE);
    }
  } finally {
    await conn.end();
  }
};

main().catch((err) => {
  // ER_NO_SUCH_TABLE = ยังไม่ได้รัน schema.sql รอบที่มีตาราง users
  console.error(err.code === 'ER_NO_SUCH_TABLE' ? 'ยังไม่มีตาราง users — รัน npm run db:apply ก่อน' : err.message);
  process.exit(1);
});
