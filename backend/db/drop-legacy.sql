-- backend/db/drop-legacy.sql
-- ⚠️ ไฟล์นี้ลบข้อมูลถาวร แยกออกมาจาก schema.sql โดยตั้งใจ — schema.sql ต้องรันซ้ำได้ปลอดภัยเสมอ
-- รันเมื่อพร้อมจะทิ้งของเดิมเท่านั้น: node db/migrate.js drop-legacy.sql
--
-- ลบอะไรบ้าง
--   measurements / specs / parts  — ตารางของระบบเดิม ไม่มีที่ใช้ในระบบใหม่
--   machines / divisions          — ชื่อชนกับของใหม่แต่ "คนละรูป" (เดิม machines ไม่มี code/is_active)
--                                   CREATE TABLE IF NOT EXISTS จึงข้ามไปไม่ยอมเพิ่มคอลัมน์ให้
--                                   ต้องลบทิ้งก่อน schema.sql ถึงจะสร้างรูปใหม่ได้
--
-- ลำดับสำคัญ: ลบลูกก่อนพ่อเสมอ ไม่งั้น FK บล็อก
-- หลังรันไฟล์นี้ให้รัน schema.sql ต่อทันที ไม่งั้น backend หาตารางไม่เจอ

SET NAMES utf8mb4;

DROP TABLE IF EXISTS measurements;
DROP TABLE IF EXISTS specs;
DROP TABLE IF EXISTS parts;

-- ไม่ลบ machines / divisions — schema.sql เติมคอลัมน์ที่ขาดให้ในที่เดิมแล้ว
-- (ตารางใหม่ inspections มี FK ชี้มาหาสองตัวนี้ด้วย ลบทิ้งไม่ได้อยู่แล้ว)
