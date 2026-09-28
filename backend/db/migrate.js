// backend/db/migrate.js — รันไฟล์ .sql ในโฟลเดอร์นี้
//
// ทำไมต้องมี: เครื่องที่ใช้งานไม่มี mysql CLI และ DB อยู่บนเซิร์ฟเวอร์ LAN (192.168.3.18)
// จึงต้องยิง DDL ผ่าน mysql2 แทน
//
// ใช้:
//   node db/migrate.js schema.sql        สร้างตารางใหม่ (รันซ้ำได้ ปลอดภัย)
//   node db/migrate.js seed.sql          ใส่ master data ตัวอย่างไว้เทส
//   node db/migrate.js drop-legacy.sql   ⚠️ ลบตารางเดิมถาวร ต้องยืนยันก่อน
//   node db/migrate.js purge-inspections.sql  ⚠️ ล้างผลตรวจทั้งระบบ + baseline ต้องยืนยันก่อน
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mysql = require('mysql2/promise');
const env = require('../config/env');

// ไฟล์ที่ลบข้อมูล ต้องให้คนยืนยันด้วยมือก่อนเสมอ
const DESTRUCTIVE = new Set(['drop-legacy.sql', 'purge-inspections.sql']);

const confirm = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

const main = async () => {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('ใช้: node db/migrate.js <ไฟล์.sql>');
    console.error('มีให้เลือก: schema.sql | seed.sql | drop-legacy.sql | purge-inspections.sql');
    process.exit(1);
  }

  // กัน path traversal — รับเฉพาะชื่อไฟล์ในโฟลเดอร์ db/ เท่านั้น
  const fileName = path.basename(fileArg);
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) {
    console.error(`ไม่พบไฟล์ ${filePath}`);
    process.exit(1);
  }

  if (DESTRUCTIVE.has(fileName)) {
    console.log(`\n⚠️  ${fileName} จะลบตารางและข้อมูลถาวรใน ${env.DB_NAME} ที่ ${env.DB_HOST}`);
    const answer = await confirm('พิมพ์ชื่อ database เพื่อยืนยัน: ');
    if (answer !== env.DB_NAME) {
      console.log('ยกเลิก — ไม่ได้รันอะไรทั้งนั้น');
      process.exit(0);
    }
  }

  const sql = fs.readFileSync(filePath, 'utf8');

  // connection แยกต่างหากจาก pool หลัก เพราะต้องเปิด multipleStatements
  // (pool.js ปิดไว้โดยตั้งใจ — ดูคอมเมนต์ในไฟล์นั้น)
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: true,
  });

  try {
    console.log(`[migrate] ${fileName} → ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
    await conn.query(sql);
    console.log('[migrate] สำเร็จ');
  } catch (err) {
    console.error(`[migrate] ล้มเหลว: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
};

main().catch((err) => {
  console.error(`[migrate] ${err.message}`);
  process.exit(1);
});
