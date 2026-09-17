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

INSERT IGNORE INTO machines (division_id, code, name) VALUES
  ((SELECT id FROM divisions WHERE name = 'Mecha 2'), 'MC-01', 'Press #1'),
  ((SELECT id FROM divisions WHERE name = 'Mecha 2'), 'MC-02', 'Press #2'),
  ((SELECT id FROM divisions WHERE name = 'Mecha 1'), 'MC-11', 'Grinder #1');

INSERT IGNORE INTO inspectors (emp_code, name, division_id) VALUES
  ('QC001', 'สมชาย ตรวจสอบ', (SELECT id FROM divisions WHERE name = 'Mecha 2')),
  ('QC002', 'สมหญิง วัดงาน',  (SELECT id FROM divisions WHERE name = 'Mecha 2')),
  ('QC003', 'ประเสริฐ คุมคุณภาพ', (SELECT id FROM divisions WHERE name = 'Mecha 1'));

INSERT IGNORE INTO models (division_id, model_code, model_name, drawing_no, drawing_rev) VALUES
  ((SELECT id FROM divisions WHERE name = 'Mecha 2'), 'MDL-1001', 'Shaft Type A', 'DWG-1001', 'A'),
  ((SELECT id FROM divisions WHERE name = 'Mecha 2'), 'MDL-1002', 'Bracket Type B', 'DWG-1002', 'C');

-- จุดตรวจของ MDL-1001 — ครบทั้ง 3 แบบ
INSERT IGNORE INTO checkpoints
  (model_id, seq_no, name, char_type, unit, gauge, usl, lsl, target, sample_size, is_critical)
VALUES
  ((SELECT id FROM models WHERE model_code = 'MDL-1001'),
   1, 'OD (เส้นผ่านศูนย์กลางนอก)', 'variable', 'mm', 'Micrometer', 10.0500, 9.9500, 10.0000, 5, 1),
  ((SELECT id FROM models WHERE model_code = 'MDL-1001'),
   2, 'ความยาวรวม', 'variable', 'mm', 'Vernier', 25.1000, 25.0000, 25.0500, 1, 0),
  ((SELECT id FROM models WHERE model_code = 'MDL-1001'),
   3, 'รอยขีดข่วนผิวงาน', 'attribute', NULL, 'ตรวจด้วยตา', NULL, NULL, NULL, 1, 1);

-- MDL-1002 — จุดเดียว ไว้เทสว่ารุ่นที่ยังไม่มีข้อมูลแสดงผลถูก
INSERT IGNORE INTO checkpoints
  (model_id, seq_no, name, char_type, unit, gauge, usl, lsl, target, sample_size, is_critical)
VALUES
  ((SELECT id FROM models WHERE model_code = 'MDL-1002'),
   1, 'ความหนา', 'variable', 'mm', 'Micrometer', 3.2000, 2.8000, 3.0000, 5, 0);
