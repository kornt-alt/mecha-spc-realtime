-- backend/db/drop-legacy.sql
-- ⚠️ ไฟล์นี้ลบข้อมูลถาวร แยกออกมาจาก schema.sql โดยตั้งใจ — schema.sql ต้องรันซ้ำได้ปลอดภัยเสมอ
-- รันเมื่อพร้อมจะทิ้งของเดิมเท่านั้น: node db/migrate.js drop-legacy.sql
--
-- ลบอะไรบ้าง
--   measurements / specs / parts  — ตารางของระบบเดิม ไม่มีที่ใช้ในระบบใหม่
--   machines / divisions          — ชื่อชนกับของใหม่แต่ "คนละรูป" (เดิม machines ไม่มี code/is_active)
--                                   CREATE TABLE IF NOT EXISTS จึงข้ามไปไม่ยอมเพิ่มคอลัมน์ให้
--                                   ต้องลบทิ้งก่อน schema.sql ถึงจะสร้างรูปใหม่ได้
--   checkpoints.baseline_*        — คอลัมน์ baseline ชุดเดิม (1 ชุดต่อจุดตรวจ) ย้ายไป
--                                   checkpoint_baselines แล้ว (แยกรายเครื่อง)
--
-- ลำดับสำคัญ: ลบลูกก่อนพ่อเสมอ ไม่งั้น FK บล็อก
-- หลังรันไฟล์นี้ให้รัน schema.sql ต่อทันที ไม่งั้น backend หาตารางไม่เจอ

SET NAMES utf8mb4;

DROP TABLE IF EXISTS measurements;
DROP TABLE IF EXISTS specs;
DROP TABLE IF EXISTS parts;

-- ไม่ลบ machines / divisions — schema.sql เติมคอลัมน์ที่ขาดให้ในที่เดิมแล้ว
-- (ตารางใหม่ inspections มี FK ชี้มาหาสองตัวนี้ด้วย ลบทิ้งไม่ได้อยู่แล้ว)

-- ── คอลัมน์ baseline ชุดเดิมบน checkpoints ────────────────────────────────
--
-- ⚠️ ต้องรัน schema.sql อย่างน้อยหนึ่งรอบก่อน ไม่งั้นค่าที่อยู่ในคอลัมน์พวกนี้หายไปเฉย ๆ
--    schema.sql เป็นตัวย้ายค่าเดิมไปเป็นชุด "รวมทุกเครื่อง" (machine_id = 0) ให้
--    หลังย้ายเสร็จค่าในคอลัมน์เก่าจะถูกล้างเป็น NULL อยู่แล้ว ตรงนี้แค่เก็บซากคอลัมน์ทิ้ง
ALTER TABLE checkpoints DROP COLUMN IF EXISTS baseline_xbarbar;
ALTER TABLE checkpoints DROP COLUMN IF EXISTS baseline_rbar;
ALTER TABLE checkpoints DROP COLUMN IF EXISTS baseline_n;
ALTER TABLE checkpoints DROP COLUMN IF EXISTS baseline_subgroups;
ALTER TABLE checkpoints DROP COLUMN IF EXISTS baseline_from;
ALTER TABLE checkpoints DROP COLUMN IF EXISTS baseline_to;
ALTER TABLE checkpoints DROP COLUMN IF EXISTS baseline_locked_at;
