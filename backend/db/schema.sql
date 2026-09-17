-- backend/db/schema.sql
-- DDL ของระบบตรวจสอบคุณภาพ (rewrite) — ไฟล์นี้คือ source of truth ของ schema
-- รันด้วย: node db/migrate.js schema.sql
--
-- ทุกคำสั่งรันซ้ำได้ ไม่ทำลายข้อมูล (CREATE TABLE IF NOT EXISTS + ALTER ... IF NOT EXISTS)
--
-- ⚠️ ตาราง divisions / machines มีอยู่แล้วใน DB เดิมด้วย "คนละรูป" (machines เดิมไม่มี code/is_active)
--    CREATE TABLE IF NOT EXISTS จะข้ามไปเฉย ๆ ไม่เพิ่มคอลัมน์ให้ ท้ายไฟล์นี้จึงมีส่วน ALTER
--    ไล่เติมคอลัมน์ที่ขาดให้ — ไม่ต้องลบตารางทิ้ง ชื่อ division/เครื่องที่มีอยู่จริงยังอยู่ครบ
--
-- ⚠️ `ADD COLUMN IF NOT EXISTS` / `ADD INDEX IF NOT EXISTS` เป็นไวยากรณ์ของ MariaDB
--    (เครื่องจริงคือ MariaDB 10.3 — ตรวจแล้ว) ถ้าย้ายไป MySQL 8 ต้องเขียนส่วนนั้นใหม่
--
-- นโยบาย ON DELETE (ต่างจากระบบเดิมที่ CASCADE ทั้งหมด):
--   CASCADE  = ลูกไม่มีความหมายถ้าไม่มีพ่อ (checkpoints ของ model, บรรทัดผลของใบตรวจ)
--   RESTRICT = ทุกเส้นที่ชี้จาก "ใบตรวจ" ไปหา master — ลบ master ทิ้งแล้วหลักฐานการตรวจต้องไม่หายตาม
--              ฝั่ง UI ให้ใช้ is_active = 0 (soft delete) แทนการลบจริง

SET NAMES utf8mb4;

-- ── master ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS divisions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_divisions_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS machines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  division_id  INT NOT NULL,
  code         VARCHAR(50)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_machines_code (code),
  KEY ix_machines_division (division_id),
  CONSTRAINT fk_machines_division
    FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inspectors (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  emp_code     VARCHAR(20)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  division_id  INT NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inspectors_emp_code (emp_code),
  KEY ix_inspectors_division (division_id),
  CONSTRAINT fk_inspectors_division
    FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- รุ่นสินค้า — ไม่ผูกกับเครื่องแล้ว (รุ่นเดียวรันได้หลายเครื่อง เครื่องไปอยู่ที่หัวใบตรวจ)
CREATE TABLE IF NOT EXISTS models (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  division_id  INT NOT NULL,
  model_code   VARCHAR(50)  NOT NULL,
  model_name   VARCHAR(150) NOT NULL,
  drawing_no   VARCHAR(100) NULL,
  drawing_rev  VARCHAR(20)  NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_models_code (model_code),
  KEY ix_models_division (division_id),
  CONSTRAINT fk_models_division
    FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- จุดตรวจของแต่ละรุ่น เรียงตาม seq_no ตามลำดับในแบบ
--
-- usl / lsl = spec limit จากแบบ ใช้ตัดสิน OK/NG และคิด Cp/Cpk    ← คนละอย่างกับ
-- baseline_* = ฐานคำนวณ control limit (UCL/LCL) ที่ freeze ไว้     ← สองอันนี้
-- ระบบเดิมเก็บ spec limit ในคอลัมน์ชื่อ ucl/lcl แล้วใช้ปนกัน นั่นคือบั๊กหลักที่ rewrite นี้มาแก้
--
-- baseline_n = ขนาด subgroup ตอนที่ทำ baseline ไว้ ถ้า sample_size ถูกแก้ทีหลังจนไม่ตรงกับค่านี้
--              แปลว่าค่า A2/D3/D4 คนละตัว ต้อง re-baseline ก่อนถึงจะอ่านกราฟได้
CREATE TABLE IF NOT EXISTS checkpoints (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  model_id            INT NOT NULL,
  seq_no              INT NOT NULL,
  name                VARCHAR(150) NOT NULL,
  char_type           ENUM('variable','attribute') NOT NULL DEFAULT 'variable',
  unit                VARCHAR(20)  NULL,
  gauge               VARCHAR(100) NULL,
  usl                 DECIMAL(12,4) NULL,
  lsl                 DECIMAL(12,4) NULL,
  target              DECIMAL(12,4) NULL,
  sample_size         TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_critical         TINYINT(1) NOT NULL DEFAULT 0,
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  baseline_xbarbar    DECIMAL(14,6) NULL,
  baseline_rbar       DECIMAL(14,6) NULL,
  baseline_n          TINYINT UNSIGNED NULL,
  baseline_subgroups  INT NULL,
  baseline_from       DATETIME NULL,
  baseline_to         DATETIME NULL,
  baseline_locked_at  DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_checkpoints_model_seq (model_id, seq_no),
  KEY ix_checkpoints_model (model_id),
  CONSTRAINT fk_checkpoints_model
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
  -- ตาราง A2/D3/D4 ใน spcConstants.js มีถึง n=10 เท่านั้น เกินกว่านี้คำนวณลิมิตไม่ได้
  CONSTRAINT ck_checkpoints_sample_size CHECK (sample_size BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ใบตรวจ ────────────────────────────────────────────────────────────────

-- 1 แถว = การสุ่มตรวจ 1 ครั้ง = 1 subgroup บนกราฟ
--
-- subgroup_no ให้ server แจกเองใน transaction (MAX+1 ต่อ model+mo) ห้ามรับจาก client
-- uq_inspections_subgroup คือตาข่ายกันสองคนตรวจ MO เดียวกันพร้อมกันแล้วเลขชน
-- shift: M = 07:00-18:59, N = 19:00-06:59 (ตามที่ QC_MECHA2 ใช้อยู่)
CREATE TABLE IF NOT EXISTS inspections (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  model_id        INT NOT NULL,
  machine_id      INT NOT NULL,
  inspector_id    INT NOT NULL,
  mo_no           VARCHAR(50) NOT NULL,
  lot_no          VARCHAR(50) NULL,
  shift           ENUM('M','N') NOT NULL,
  subgroup_no     INT NOT NULL,
  inspected_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remark          VARCHAR(255) NULL,
  overall_result  ENUM('OK','NG') NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inspections_subgroup (model_id, mo_no, subgroup_no),
  KEY ix_inspections_model_time (model_id, inspected_at),
  KEY ix_inspections_mo (mo_no),
  CONSTRAINT fk_inspections_model
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inspections_machine
    FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inspections_inspector
    FOREIGN KEY (inspector_id) REFERENCES inspectors(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1 แถว = 1 จุดตรวจ × 1 ชิ้น
--
-- ⚠️ usl_used / lsl_used / n_used / judgment เป็น snapshot ณ เวลาที่ตรวจ โดยตั้งใจ
--    แก้สเปกที่ Master Setup วันหลังแล้วผลตัดสินของใบเก่าต้องไม่เปลี่ยนตาม
--    ระบบที่คำนวณ OK/NG ใหม่ทุกครั้งที่อ่าน = ใช้เป็นหลักฐานไม่ได้
-- value เป็น NULL สำหรับจุด attribute (ตรวจด้วยตา ไม่มีตัวเลข) — judgment คือหลักฐานตัวจริง
CREATE TABLE IF NOT EXISTS inspection_results (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  inspection_id  INT NOT NULL,
  checkpoint_id  INT NOT NULL,
  piece_no       TINYINT UNSIGNED NOT NULL DEFAULT 1,
  value          DECIMAL(12,4) NULL,
  judgment       ENUM('OK','NG','NA') NOT NULL,
  ng_reason      VARCHAR(255) NULL,
  usl_used       DECIMAL(12,4) NULL,
  lsl_used       DECIMAL(12,4) NULL,
  n_used         TINYINT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_results_piece (inspection_id, checkpoint_id, piece_no),
  KEY ix_results_checkpoint (checkpoint_id, inspection_id),
  CONSTRAINT fk_results_inspection
    FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE,
  CONSTRAINT fk_results_checkpoint
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── อัปเกรดตารางเดิมให้เข้ารูปใหม่ ─────────────────────────────────────────
--
-- ส่วนนี้มีไว้เฉพาะ DB ที่เคยรันระบบเดิมมาก่อน (machines เดิมมีแค่ id/division_id/name)
-- บน DB เปล่า CREATE ข้างบนสร้างครบแล้ว ส่วนนี้จะไม่ทำอะไรเลย
--
-- ลำดับสำคัญ: เพิ่ม code แบบ NULL ก่อน → เติมค่าให้แถวเดิม → ค่อยใส่ UNIQUE
-- ถ้าใส่ NOT NULL UNIQUE ตั้งแต่แรก แถวเดิมจะได้ '' เหมือนกันหมดแล้วชนกันเอง

ALTER TABLE machines ADD COLUMN IF NOT EXISTS code VARCHAR(50) NULL AFTER division_id;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- เครื่องที่มีอยู่เดิมยังไม่มีรหัส — ตั้งจากเลข id ไปก่อน แก้ทีหลังที่หน้า Master Setup ได้
UPDATE machines SET code = CONCAT('MC-', LPAD(id, 2, '0')) WHERE code IS NULL OR code = '';

ALTER TABLE machines ADD UNIQUE INDEX IF NOT EXISTS uq_machines_code (code);
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE divisions ADD UNIQUE INDEX IF NOT EXISTS uq_divisions_name (name);
