-- backend/db/seed.sql
-- master data ตัวอย่างไว้ทดสอบ รันหลัง schema.sql: node db/migrate.js seed.sql
--
-- จงใจใส่ให้ครบ 3 แบบที่ระบบต้องรองรับ เพราะเป็นเคสที่พังต่างกัน:
--   sample_size = 5  → กราฟ X-bar R  (ใช้ A2/D3/D4)
--   sample_size = 1  → กราฟ I-MR     (ใช้ E2, d2 ของ n=2)
--   char_type = attribute → ไม่มีตัวเลข ไม่มีกราฟ ตัดสิน OK/NG อย่างเดียว
--
-- ใช้ INSERT IGNORE ทุกจุด (ทุกตารางมี UNIQUE key อยู่แล้ว) จึงรันซ้ำได้ไม่เกิดข้อมูลซ้ำ

SET NAMES utf8mb4;

INSERT IGNORE INTO divisions (name) VALUES ('Mecha 1'), ('Mecha 2');

-- dept ของ IPBASS ต่อ division — ใช้เลือก token ตอนยิง MOPLAN
-- UPDATE แยกเพราะ INSERT IGNORE ข้างบนไม่แตะแถวที่มีอยู่แล้ว (DB จริงมี divisions มาก่อน)
UPDATE divisions SET ipbass_dept = 'T47563' WHERE name = 'Mecha 1' AND ipbass_dept IS NULL;
UPDATE divisions SET ipbass_dept = 'T47183' WHERE name = 'Mecha 2' AND ipbass_dept IS NULL;

INSERT IGNORE INTO machines (division_id, code, name) VALUES
  ((SELECT id FROM divisions WHERE name = 'Mecha 2'), 'MC-01', 'Press #1'),
  ((SELECT id FROM divisions WHERE name = 'Mecha 2'), 'MC-02', 'Press #2'),
  ((SELECT id FROM divisions WHERE name = 'Mecha 1'), 'MC-11', 'Grinder #1');

INSERT IGNORE INTO inspectors (emp_code, name, division_id) VALUES
  ('QC001', 'สมชาย ตรวจสอบ', (SELECT id FROM divisions WHERE name = 'Mecha 2')),
  ('QC002', 'สมหญิง วัดงาน',  (SELECT id FROM divisions WHERE name = 'Mecha 2')),
  ('QC003', 'ประเสริฐ คุมคุณภาพ', (SELECT id FROM divisions WHERE name = 'Mecha 1'));

-- "รุ่น" = item number ของ IPBASS
--
-- ตัวอย่างจงใจใส่ 2 เคสที่เคยพังต่างกัน:
--   AAB-1001-01 ซ้ำทั้ง Mecha 1 และ Mecha 2 → ทดสอบ UNIQUE (division_id, item_no)
--                และทดสอบว่าการจับคู่ MO ต้องใช้ dept ช่วยกรอง ไม่ใช่ item_no อย่างเดียว
--   AAB-1002/C  มี '/' อยู่ในเลข → ทดสอบว่าชื่อไฟล์ Excel export ไม่พัง
INSERT IGNORE INTO models (division_id, item_no, item_name, drawing_no, drawing_rev) VALUES
  ((SELECT id FROM divisions WHERE name = 'Mecha 2'), 'AAB-1001-01', 'Shaft Type A',   'DWG-1001', 'A'),
  ((SELECT id FROM divisions WHERE name = 'Mecha 2'), 'AAB-1002/C',  'Bracket Type B', 'DWG-1002', 'C'),
  ((SELECT id FROM divisions WHERE name = 'Mecha 1'), 'AAB-1001-01', 'Shaft Type A',   'DWG-1001', 'A');

-- จุดตรวจของ AAB-1001-01 (Mecha 2) — ครบทั้ง 3 แบบ
INSERT IGNORE INTO checkpoints
  (model_id, seq_no, name, char_type, unit, gauge, usl, lsl, target, sample_size, is_critical)
VALUES
  ((SELECT id FROM models WHERE item_no = 'AAB-1001-01'
                            AND division_id = (SELECT id FROM divisions WHERE name = 'Mecha 2')),
   1, 'OD (เส้นผ่านศูนย์กลางนอก)', 'variable', 'mm', 'Micrometer', 10.0500, 9.9500, 10.0000, 5, 1),
  ((SELECT id FROM models WHERE item_no = 'AAB-1001-01'
                            AND division_id = (SELECT id FROM divisions WHERE name = 'Mecha 2')),
   2, 'ความยาวรวม', 'variable', 'mm', 'Vernier', 25.1000, 25.0000, 25.0500, 1, 0),
  ((SELECT id FROM models WHERE item_no = 'AAB-1001-01'
                            AND division_id = (SELECT id FROM divisions WHERE name = 'Mecha 2')),
   3, 'รอยขีดข่วนผิวงาน', 'attribute', NULL, 'ตรวจด้วยตา', NULL, NULL, NULL, 1, 1);

-- AAB-1002/C — จุดเดียว ไว้เทสว่า item ที่ยังไม่มีข้อมูลแสดงผลถูก
-- (AAB-1001-01 ฝั่ง Mecha 1 จงใจไม่ใส่จุดตรวจ ไว้เทสว่าเลือกผิด division แล้วเห็นชัด)
INSERT IGNORE INTO checkpoints
  (model_id, seq_no, name, char_type, unit, gauge, usl, lsl, target, sample_size, is_critical)
VALUES
  ((SELECT id FROM models WHERE item_no = 'AAB-1002/C'
                            AND division_id = (SELECT id FROM divisions WHERE name = 'Mecha 2')),
   1, 'ความหนา', 'variable', 'mm', 'Micrometer', 3.2000, 2.8000, 3.0000, 5, 0);
