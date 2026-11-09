-- backend/db/purge-inspections.sql
-- ⚠️ ไฟล์นี้ลบข้อมูลถาวร แยกออกมาจาก schema.sql โดยตั้งใจ — schema.sql ต้องรันซ้ำได้ปลอดภัยเสมอ
-- รันเมื่อพร้อมจะทิ้งผลตรวจทั้งหมดเท่านั้น: npm run db:purge-inspections
--
-- ลบอะไรบ้าง
--   inspection_results / inspections  — ผลตรวจทั้งหมดทั้งระบบ
--   checkpoint_baselines              — baseline ทุกชุดทุกเครื่อง ดูเหตุผลข้างล่าง
--   check_jobs / check_job_events     — งาน Set up / Last Piece (ใบตรวจของงานพวกนี้หายไปกับบรรทัดบนแล้ว)
--
-- ไม่แตะอะไรบ้าง
--   models / checkpoints / machines / inspectors / divisions — master ที่ตั้งไว้ต้องอยู่ครบ
--   ไฟล์นี้ล้าง "ผลตรวจ" ไม่ใช่ "การตั้งค่า"
--
-- ลำดับสำคัญ: ลบลูกก่อนพ่อเสมอ ไม่งั้น FK บล็อก
-- (inspection_results ผูกกับ inspections แบบ CASCADE อยู่แล้ว แต่เขียนให้ชัดดีกว่าพึ่ง side effect)

SET NAMES utf8mb4;

DELETE FROM inspection_results;
DELETE FROM inspections;

-- งานส่งต่อ PD → QC อ้างใบตรวจที่เพิ่งลบไป (inspections.job_id) — ค้างไว้ = timeline ชี้ใบที่ไม่มีอยู่
-- check_job_events หายตาม CASCADE แต่เขียนให้ชัด
DELETE FROM check_job_events;
DELETE FROM check_jobs;

-- เริ่มนับ id ใหม่ — ไม่มีอะไรอ้างถึงเลขเก่าแล้ว
ALTER TABLE inspections AUTO_INCREMENT = 1;

-- ⚠️ ต้องล้าง baseline ด้วย ห้ามเก็บไว้
--    checkpoint_baselines คือ control limit ที่ freeze ไว้จากข้อมูลที่บรรทัดข้างบนเพิ่งลบไป
--    เก็บไว้แปลว่ากราฟจะวาดเส้น UCL/LCL ที่คำนวณจากข้อมูลซึ่งไม่มีอยู่ในระบบแล้ว
--    หน้าจอจะดูปกติทุกอย่าง ไม่มีอะไรเตือน แต่เส้นที่ใช้ตัดสินว่า process ผิดปกติหรือไม่
--    มาจากของที่ทิ้งไปแล้ว — ทุกจุดจะกลับไปเป็น provisional ซึ่งถูกต้อง
--
-- ⚠️ ล้างทุกชุด ทั้งชุดรวม (machine_id = 0) และรายเครื่อง — ข้อมูลที่มันอ้างอิงหายไปหมดแล้ว
--    เหมือนกันทุกชุด ไม่มีชุดไหนรอด
DELETE FROM checkpoint_baselines;

-- ⚠️ ไม่แตะคอลัมน์ baseline_* ชุดเดิมบน checkpoints โดยตั้งใจ — schema.sql ล้างให้ตั้งแต่ตอน
--    migration แล้ว และ drop-legacy.sql ลบคอลัมน์ทิ้งได้ · เขียน UPDATE ไว้ตรงนี้เมื่อไหร่
--    ไฟล์นี้จะพังทันทีบน DB ที่ลบคอลัมน์ไปแล้ว (UPDATE คอลัมน์ที่ไม่มีอยู่ = error ทันที
--    ไม่มี IF EXISTS ให้ใช้เหมือน ALTER)
