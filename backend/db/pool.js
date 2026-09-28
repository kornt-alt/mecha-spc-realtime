// backend/db/pool.js — mysql2 pool + helper ที่ routes ใช้
//
// กติกา: routes/ กับ services/ เรียกผ่าน query() / execute() / withTransaction() เท่านั้น
// ห้าม require('mysql2') ตรง ๆ ที่อื่น จะได้มี pool เดียวทั้งแอปและเปลี่ยน driver ได้ที่เดียว
'use strict';

const mysql = require('mysql2/promise');
const env = require('../config/env');

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: env.DB_POOL_MAX,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  // ⚠️ ห้ามเปิด multipleStatements ที่ pool หลัก — db/migrate.js สร้าง connection ของตัวเองต่างหาก
  // เปิดที่นี่เมื่อไหร่ = SQL injection ที่หลุดมาแถวเดียวยิงได้หลายคำสั่งรวด
  multipleStatements: false,
});

// query()  — SELECT ทั่วไป (prepared statement ไม่ได้ cache, เหมาะกับ SQL ที่ประกอบแบบ dynamic)
// execute() — INSERT/UPDATE/DELETE และ SELECT ที่ยิงซ้ำ ๆ ด้วยรูปเดิม
const query = (sql, params = []) => pool.query(sql, params);
const execute = (sql, params = []) => pool.execute(sql, params);

// withTransaction(fn) — ยืม connection มาหนึ่งเส้น เปิด transaction แล้วส่งให้ fn ใช้
//
// fn ได้ conn ไปใช้ conn.query / conn.execute ได้ตรง ๆ
// throw เมื่อไหร่ = rollback อัตโนมัติแล้ว throw ต่อ · return ปกติ = commit
// ⚠️ ต้องใช้ conn ที่ส่งเข้าไปเท่านั้น ถ้าเผลอเรียก query() ข้างบนใน fn จะเป็นคนละ connection
//    คำสั่งนั้นจะอยู่นอก transaction และไม่ถูก rollback ด้วย
const withTransaction = async (fn) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      // rollback พังเองก็ยังต้องคืน connection และโยน error ตัวจริงออกไป
      console.error('[db] rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = { pool, query, execute, withTransaction };
