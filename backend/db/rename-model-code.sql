-- backend/db/rename-model-code.sql
-- เปลี่ยนตัวตนของ "รุ่น" ให้เป็น item number ของ IPBASS
--   models.model_code → models.item_no
--   models.model_name → models.item_name
--   UNIQUE (model_code) → UNIQUE (division_id, item_no)
--
-- รันด้วย: node db/migrate.js rename-model-code.sql
--
-- ไม่ลบข้อมูล ไม่แตะแถวไหน — ค่าเดิมในคอลัมน์ติดไปกับชื่อใหม่ทั้งหมด
-- รันซ้ำได้: ทุกคำสั่งห่อด้วย guard ที่อ่าน information_schema ก่อน
--
-- ⚠️ ทำไมต้องห่อ guard: เครื่องจริงคือ MariaDB 10.3 ซึ่ง
--    (1) ไม่มี `RENAME COLUMN` (มาตอน 10.5.2) ต้องใช้ `CHANGE COLUMN`
--    (2) `CHANGE COLUMN` ไม่มี `IF EXISTS` รันรอบสองจะ error ว่าไม่รู้จัก model_code
--    ต่างจากส่วนท้าย schema.sql ที่ใช้ `ADD COLUMN IF NOT EXISTS` ได้ตรง ๆ
--
-- ⚠️ UNIQUE key กว้างขึ้นกว่าเดิมโดยตั้งใจ — model_code เดิม unique ทั้งตาราง
--    แต่ item เลขเดียวกันผลิตได้ทั้ง Mecha 1 (T47563) และ Mecha 2 (T47183)
--    และคนละ division ใช้ใบตรวจคนละใบ จึงต้อง unique ต่อ division

SET NAMES utf8mb4;

-- ── model_code → item_no ──────────────────────────────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'models' AND COLUMN_NAME = 'model_code') > 0,
  'ALTER TABLE models CHANGE COLUMN model_code item_no VARCHAR(50) NOT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── model_name → item_name ────────────────────────────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'models' AND COLUMN_NAME = 'model_name') > 0,
  'ALTER TABLE models CHANGE COLUMN model_name item_name VARCHAR(150) NOT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── UNIQUE (model_code) → UNIQUE (division_id, item_no) ───────────────────
--
-- ลำดับสำคัญ: สร้าง index ใหม่ให้สำเร็จก่อน ค่อยทิ้งของเดิม
-- ถ้าทิ้งก่อนแล้ว index ใหม่สร้างไม่ผ่าน (ข้อมูลเดิมซ้ำ) จะเหลือตารางที่ไม่มี unique เลย
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'models' AND INDEX_NAME = 'uq_models_division_item') = 0,
  'ALTER TABLE models ADD UNIQUE INDEX uq_models_division_item (division_id, item_no)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'models' AND INDEX_NAME = 'ix_models_item_no') = 0,
  'ALTER TABLE models ADD INDEX ix_models_item_no (item_no)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'models' AND INDEX_NAME = 'uq_models_code') > 0,
  'ALTER TABLE models DROP INDEX uq_models_code',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
