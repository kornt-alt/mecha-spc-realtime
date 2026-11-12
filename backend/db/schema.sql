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

-- ผู้ใช้ที่ login เข้าหน้า Master ได้ — หน้าอื่นไม่ต้อง login (ใบตรวจหน้าไลน์ห้ามติด login)
-- สร้าง/เปลี่ยนรหัส/ปิดบัญชีด้วย npm run user:add / user:passwd / user:disable (scripts/user.js)
-- password_hash = 'scrypt$<salt>$<hash>' (services/auth.js) · ไม่มี FK จากตารางไหนมาหาโดยตั้งใจ
CREATE TABLE IF NOT EXISTS users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(50)  NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  display_name   VARCHAR(100) NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at  DATETIME     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- passkey = รหัสลับรายบัญชี พิมพ์ช่องเดียวเข้าได้เลย (hashPasskey ใน services/auth.js)
-- ⚠️ UNIQUE โดยตั้งใจ — login ด้วย passkey ไม่มี username passkey ซ้ำกันจะไม่รู้ว่าเป็นของใคร
--    NULL = ยังไม่ได้ตั้ง (UNIQUE ยอมให้ NULL ซ้ำได้)
ALTER TABLE users ADD COLUMN IF NOT EXISTS passkey_hash CHAR(64) NULL;
ALTER TABLE users ADD UNIQUE INDEX IF NOT EXISTS uq_users_passkey (passkey_hash);

-- ลูกค้าเจ้าของ item + เกณฑ์ Cp/Cpk ขั้นต่ำที่ลูกค้ากำหนด
--
-- เกณฑ์ที่ใช้จริงเลือกที่ services/capabilityTarget.js ที่เดียว:
--   models.min_* (override ราย item) ?? customers.min_* ?? 1.33 (ค่าระบบ)
-- แยก 2 ชุด: จุดทั่วไป (min_cp/min_cpk) กับจุด CTF = checkpoints.is_critical (min_*_ctf)
-- เพราะลูกค้ามักกำหนดจุดวิกฤตสูงกว่า
--
-- ⚠️ เป็นเกณฑ์ "แสดงผล" เท่านั้น ไม่ได้ตัดสิน OK/NG ของใบตรวจ และไม่ได้ snapshot ลงใบตรวจ
--    แก้เกณฑ์แล้วรายงานย้อนหลังเปลี่ยนสีตามได้ — ตั้งใจ เพราะ Cp/Cpk เองก็คำนวณสดทุกครั้ง
CREATE TABLE IF NOT EXISTS customers (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  min_cp       DECIMAL(4,2) NOT NULL DEFAULT 1.33,
  min_cpk      DECIMAL(4,2) NOT NULL DEFAULT 1.33,
  min_cp_ctf   DECIMAL(4,2) NOT NULL DEFAULT 1.33,
  min_cpk_ctf  DECIMAL(4,2) NOT NULL DEFAULT 1.33,
  -- ชุดกฎ OCS ของลูกค้ารายนี้ ตามคู่มือ "ลักษณะกราฟที่ไม่อยู่ภายใต้การควบคุม"
  --   basic = กฎ 1-4 (Mechanical Div.) · full = ครบ 8 กฎ (MAMM) — ตัวเลือกอยู่ที่ services/capabilityTarget.js
  ocs_rule_set ENUM('basic','full') NOT NULL DEFAULT 'basic',
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "รุ่น" ของระบบนี้คือ item number ของ IPBASS — ไม่ผูกกับเครื่อง (item เดียวรันได้หลายเครื่อง
-- เครื่องไปอยู่ที่หัวใบตรวจ) ตารางยังชื่อ models และคอลัมน์อ้างอิงยังชื่อ model_id ตามเดิม
-- เพราะชื่อพวกนั้นลามไป FK / socket room / URL param โดยไม่ได้อะไรกลับมา
--
-- ⚠️ UNIQUE เป็น (division_id, item_no) ไม่ใช่ item_no เดี่ยว — item เลขเดียวกันผลิตได้ทั้ง
--    Mecha 1 (T47563) และ Mecha 2 (T47183) และคนละ division ใช้ใบตรวจคนละใบ
CREATE TABLE IF NOT EXISTS models (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  division_id  INT NOT NULL,
  item_no      VARCHAR(50)  NOT NULL,
  item_name    VARCHAR(150) NOT NULL,
  drawing_no   VARCHAR(100) NULL,
  drawing_rev  VARCHAR(20)  NULL,
  -- NULL = ไม่ระบุลูกค้า · min_* NULL = ใช้ค่าของลูกค้า (ดูคอมเมนต์ที่ตาราง customers)
  customer_id  INT NULL,
  min_cp       DECIMAL(4,2) NULL,
  min_cpk      DECIMAL(4,2) NULL,
  min_cp_ctf   DECIMAL(4,2) NULL,
  min_cpk_ctf  DECIMAL(4,2) NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_models_division_item (division_id, item_no),
  KEY ix_models_item_no (item_no),
  KEY ix_models_division (division_id),
  KEY ix_models_customer (customer_id),
  CONSTRAINT fk_models_division
    FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_models_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
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
  -- ความถี่ที่ต้องตรวจ (หัวชีต Input "2 pcs / shift", "1 pcs / day") ดู fetchDoneCheckpointIds
  frequency           ENUM('shift','day') NOT NULL DEFAULT 'shift',
  -- ลักษณะที่วัด (Slot / OD / Rz / Position) แยกจาก name ที่เป็นเลขจุดบนแบบ ("Dimension 3.1")
  characteristic      VARCHAR(64)  NULL,
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

-- ── baseline ของ control limit ────────────────────────────────────────────
--
-- ⚠️ baseline แยกตาม "จุดตรวจ × เครื่อง" ไม่ใช่ต่อจุดตรวจเฉย ๆ อย่างเดิม
--    หลายเครื่องผลิต item เดียวกันได้ และแต่ละเครื่องคือคนละ process — เอาข้อมูลมารวมกัน
--    แล้วคิดเส้นกลางชุดเดียว จะได้ X̿ ที่ไม่ใช่ของเครื่องไหนเลย เครื่องที่ค่ากลางเบี่ยงจาก
--    กลุ่มจะติดกฎ OCS shift 7 จุด ค้างตลอดโดยไม่มีอะไรผิดจริง แล้วคนจะเลิกเชื่อคำเตือนทั้งหมด
--
-- ⚠️ machine_id = 0 คือชุด "รวมทุกเครื่อง" ไม่ใช่รหัสเครื่องจริง (machines.id เป็น
--    AUTO_INCREMENT จึงเริ่มที่ 1 เสมอ เลข 0 ว่างอยู่) — ที่ไม่ใช้ NULL เพราะ MySQL/MariaDB
--    ถือว่า NULL แต่ละตัวไม่ซ้ำกัน UNIQUE จึงกันชุดรวมซ้ำไม่ได้
--
-- ⚠️ ไม่มี FK ไป machines โดยตั้งใจ — baseline เป็นข้อมูลที่คำนวณใหม่ได้ ไม่ใช่หลักฐานการตรวจ
--    ลบเครื่องทิ้งแล้วแถวนี้ค้างอยู่ไม่ทำให้อะไรพัง และไม่ควรไปขวางการลบเครื่องด้วย
--    (ต่างจาก inspections.machine_id ที่เป็น RESTRICT เพราะใบตรวจคือหลักฐาน)
--
-- n = ขนาด subgroup ตอนที่ล็อก · sample_size ถูกแก้ทีหลังจนไม่ตรงกับค่านี้เมื่อไหร่
--     แปลว่าค่า A2/D3/D4 คนละตัว ต้อง re-baseline ก่อนถึงจะอ่านกราฟได้
CREATE TABLE IF NOT EXISTS checkpoint_baselines (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  checkpoint_id INT NOT NULL,
  machine_id    INT NOT NULL DEFAULT 0,
  xbarbar       DECIMAL(14,6) NOT NULL,
  rbar          DECIMAL(14,6) NOT NULL,
  n             TINYINT UNSIGNED NOT NULL,
  subgroups     INT NULL,
  baseline_from DATETIME NULL,
  baseline_to   DATETIME NULL,
  locked_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cpbl_checkpoint_machine (checkpoint_id, machine_id),
  CONSTRAINT fk_cpbl_checkpoint
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ใบตรวจ ────────────────────────────────────────────────────────────────

-- 1 แถว = การสุ่มตรวจ 1 ครั้ง = 1 subgroup บนกราฟ
--
-- subgroup_no ให้ server แจกเองใน transaction (MAX+1 ต่อ model+mo) ห้ามรับจาก client
-- uq_inspections_subgroup คือตาข่ายกันสองคนตรวจ MO เดียวกันพร้อมกันแล้วเลขชน
-- shift: รหัสกะที่โรงงานใช้จริง (M/N ของเดิม + A/B/C/D)
-- ⚠️ ENUM นี้ต้องตรงกับ SHIFT_CODES ใน backend/services/judgment.js และ SHIFTS ใน
--    frontend/src/utils/config.js · เพิ่มกะใหม่ต้องแก้ครบทั้งสามที่ ไม่งั้นเลือกได้แต่บันทึกไม่ได้
CREATE TABLE IF NOT EXISTS inspections (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  model_id        INT NOT NULL,
  machine_id      INT NOT NULL,
  inspector_id    INT NOT NULL,
  mo_no           VARCHAR(50) NOT NULL,
  lot_no          VARCHAR(50) NULL,
  shift           ENUM('M','N','A','B','C','D') NOT NULL,
  subgroup_no     INT NOT NULL,
  inspected_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remark          VARCHAR(255) NULL,
  overall_result  ENUM('OK','NG') NOT NULL,
  -- ⚠️ mo_* = สิ่งที่ IPBASS MOPLAN ตอบมาสำหรับ MO ใบนี้ ณ เวลาที่ตรวจ
  --    ไม่ใช่ item ที่ผู้ตรวจเลือก (อันนั้นอยู่ที่ model_id → models.item_no)
  --    เก็บไว้เป็น audit trail ล้วน ๆ ไม่มีตรรกะไหนอ่านไปตัดสินอะไร
  --    ไม่ตรงกับ models.item_no เมื่อไหร่ = ติดใบตรวจผิด
  mo_item_no      VARCHAR(50) NULL,
  mo_item_name    VARCHAR(150) NULL,
  mo_draw         VARCHAR(100) NULL,
  mo_model_group  VARCHAR(50) NULL,
  -- ⚠️ ยกเลิกใบตรวจ = voided_at ไม่ใช่ DELETE — แถวต้องอยู่ต่อเพราะเป็นหลักฐานการตรวจ
  --    NULL = ใช้งานอยู่ · ใบที่ยกเลิกถูกตัดออกจากกราฟ/รายงาน/Excel/Cp-Cpk/baseline
  --    ที่ buildInspectionFilter() ใน db/queries.js จุดเดียว
  --    ไม่มี voided_by เพราะระบบนี้ไม่มี auth — voided_reason จึงเป็นสิ่งที่ต้องกรอก
  voided_at       DATETIME NULL,
  voided_reason   VARCHAR(255) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- ⚠️ subgroup_no ถูกแจกด้วย MAX+1 ที่นับรวมใบที่ยกเลิกด้วย เลขจึงมีช่องว่างได้
  --    ห้ามแก้ให้ใช้เลขซ้ำ ไม่งั้นชน UNIQUE นี้กับใบที่ยกเลิกไว้
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

-- ── Event Log ของจุดที่ผิดกฎ OCS (ท้ายชีต SC ของฟอร์ม SP-QC-214C) ──────────────
--
-- 1 แถว = สาเหตุ + มาตรการแก้ไข ของ 1 จุดบนกราฟ 1 เส้น (X̄ หรือ R) ที่ผิดกฎ OCS
-- จุดที่ผิดกฎแต่ยังไม่มีแถวในตารางนี้ = "ยังไม่ได้บันทึกสาเหตุ" (หน้า /sc โชว์เป็นสีเหลือง)
--
-- rules = snapshot ของกฎที่ผิด ณ ตอนบันทึก (เช่น 'out,shift_up') — กฎคำนวณสดจากข้อมูล
--         ยกเลิกใบตรวจหรือล็อก baseline ใหม่แล้วจุดนี้อาจไม่ผิดกฎแล้ว แต่สิ่งที่คนเขียนไว้ต้องอยู่
-- recorded_by บังคับกรอก — บันทึกได้โดยไม่ต้อง login (คนหน้าไลน์เป็นคนเขียน) ชื่อที่พิมพ์คือร่องรอยเดียว
-- CASCADE ทั้งสองเส้น: DELETE /inspections/voided กับ purge-inspections.sql ลบใบตรวจจริงได้
CREATE TABLE IF NOT EXISTS ocs_events (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  checkpoint_id     INT NOT NULL,
  inspection_id     INT NOT NULL,
  chart             ENUM('xbar','range') NOT NULL,
  rules             VARCHAR(64)  NULL,
  man_pd            VARCHAR(255) NULL,
  man_qc            VARCHAR(255) NULL,
  machine_note      VARCHAR(255) NULL,
  method            VARCHAR(255) NULL,
  material          VARCHAR(255) NULL,
  measurement       VARCHAR(255) NULL,
  corrective_action TEXT NULL,
  recorded_by       VARCHAR(100) NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ocs_events_point (checkpoint_id, inspection_id, chart),
  KEY ix_ocs_events_inspection (inspection_id),
  CONSTRAINT fk_ocs_events_checkpoint
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE,
  CONSTRAINT fk_ocs_events_inspection
    FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ประวัติการแก้ค่าในใบตรวจเดิม (PUT /inspections/:id/results · ต้อง login) ──────────
--
-- 1 แถว = ค่า 1 ชิ้นของ 1 จุดตรวจที่ถูกแก้ 1 ครั้ง · เก็บค่าเดิมกับค่าใหม่คู่กัน
-- ⚠️ ห้ามลบ/แก้แถวในตารางนี้ — มันคือเหตุผลเดียวที่ใบตรวจที่ถูกแก้ยังใช้เป็นหลักฐานได้
-- ⚠️ edited_by ไม่มี FK ไป users โดยตั้งใจ (users ไม่มีการลบอยู่แล้ว) · edited_by_name เป็น snapshot
CREATE TABLE IF NOT EXISTS inspection_result_edits (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  inspection_id  INT NOT NULL,
  checkpoint_id  INT NOT NULL,
  piece_no       TINYINT UNSIGNED NOT NULL DEFAULT 1,
  old_value      DECIMAL(12,4) NULL,
  new_value      DECIMAL(12,4) NULL,
  old_judgment   ENUM('OK','NG','NA') NOT NULL,
  new_judgment   ENUM('OK','NG','NA') NOT NULL,
  reason         VARCHAR(255) NOT NULL,
  edited_by      INT NULL,
  edited_by_name VARCHAR(100) NULL,
  edited_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_result_edits_inspection (inspection_id),
  CONSTRAINT fk_result_edits_inspection
    FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE
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

-- ── IPBASS ────────────────────────────────────────────────────────────────
--
-- dept ของ IPBASS ต่อ division (T47563 = Mecha 1, T47183 = Mecha 2) เก็บใน DB
-- ไม่ hardcode map จากชื่อ division ในโค้ด — เพิ่ม division ใหม่แล้วไม่ต้องแก้ JS
-- ⚠️ ว่างได้ ฝั่ง client ต้องดักก่อนยิง ไม่งั้นจะรายงานว่า "ไม่พบ MO" ทั้งที่ยังไม่ได้ยิง
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS ipbass_dept VARCHAR(10) NULL;

ALTER TABLE inspections ADD COLUMN IF NOT EXISTS mo_item_no     VARCHAR(50)  NULL;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS mo_item_name   VARCHAR(150) NULL;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS mo_draw        VARCHAR(100) NULL;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS mo_model_group VARCHAR(50)  NULL;

-- ── ยกเลิกใบตรวจ ──────────────────────────────────────────────────────────
--
-- ไม่เพิ่ม index ให้ voided_at โดยตั้งใจ — คอลัมน์นี้เป็น NULL แทบทุกแถว index เดี่ยว
-- บนมันจะไม่ถูกเลือกใช้ · query จริงถูกขับด้วย ix_inspections_model_time กับ
-- ix_results_checkpoint อยู่แล้ว voided_at เป็นแค่เงื่อนไขกรองหลัง join
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS voided_at     DATETIME     NULL;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS voided_reason VARCHAR(255) NULL;

-- ── กะ A/B/C/D ────────────────────────────────────────────────────────────
--
-- ของเดิมเป็น ENUM('M','N') · MODIFY COLUMN ไม่มี IF NOT EXISTS แต่รันซ้ำได้อยู่แล้ว
-- (เขียนทับด้วยนิยามเดิม) และเป็นการ "เพิ่ม" ค่าใน ENUM ล้วน ๆ แถวเก่าที่เป็น M/N
-- จึงไม่ถูกแตะ · ⚠️ ห้ามลบค่าออกจาก ENUM นี้ แถวที่ใช้ค่านั้นอยู่จะกลายเป็น '' เงียบ ๆ
ALTER TABLE inspections MODIFY COLUMN shift ENUM('M','N','A','B','C','D') NOT NULL;

-- ── ย้าย baseline เดิมมาไว้ที่ checkpoint_baselines ────────────────────────
--
-- ของเดิม baseline ถูกเก็บเป็นคอลัมน์ baseline_* บน checkpoints = 1 ชุดต่อจุดตรวจ
-- ตอนนี้แยกรายเครื่องแล้ว ค่าเดิมที่มีอยู่คือค่าที่คิดจากข้อมูลทุกเครื่องรวมกัน
-- จึงย้ายไปเป็นชุด "รวมทุกเครื่อง" (machine_id = 0)
--
-- ⚠️ สองคำสั่งนี้ต้องอยู่คู่กันเสมอ ห้ามลบ UPDATE ทิ้ง — ถ้าปล่อยค่าเดิมค้างไว้ในคอลัมน์เก่า
--    พอมีคนล้าง baseline ชุดรวมทิ้ง แล้ววันหลังรัน db:apply อีกรอบ ค่าที่ล้างไปแล้วจะ
--    ถูก INSERT กลับเข้ามาเงียบ ๆ · ล้างคอลัมน์เก่าทิ้งแล้วสคริปต์นี้จึงรันซ้ำได้จริง
--    (ตัวคอลัมน์ยังอยู่จนกว่าจะรัน drop-legacy.sql — เผื่อต้องย้อนกลับ)
--
-- ⚠️ ทั้งสองคำสั่งห่อ guard ที่อ่าน information_schema ก่อน (ไวยากรณ์เดียวกับ rename-model-code.sql)
--    เพราะ drop-legacy.sql ลบคอลัมน์ baseline_* ทิ้งได้ แล้วไฟล์นี้จะอ้างคอลัมน์ที่ไม่มีอยู่
--    → error ทันที และ `npm run db:apply` จะใช้ไม่ได้อีกเลย · ซึ่งเป็นลำดับที่เอกสารสั่งไว้เองด้วย
--    ("หลังรัน drop-legacy ให้รัน schema.sql ต่อทันที") · UPDATE/SELECT ไม่มี IF EXISTS ให้ใช้
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'checkpoints' AND COLUMN_NAME = 'baseline_xbarbar') > 0,
  'INSERT IGNORE INTO checkpoint_baselines
     (checkpoint_id, machine_id, xbarbar, rbar, n, subgroups, baseline_from, baseline_to, locked_at)
   SELECT id, 0, baseline_xbarbar, baseline_rbar, COALESCE(baseline_n, sample_size),
          baseline_subgroups, baseline_from, baseline_to, COALESCE(baseline_locked_at, NOW())
     FROM checkpoints
    WHERE baseline_xbarbar IS NOT NULL AND baseline_rbar IS NOT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'checkpoints' AND COLUMN_NAME = 'baseline_xbarbar') > 0,
  'UPDATE checkpoints
      SET baseline_xbarbar = NULL, baseline_rbar = NULL, baseline_n = NULL,
          baseline_subgroups = NULL, baseline_from = NULL, baseline_to = NULL,
          baseline_locked_at = NULL
    WHERE baseline_xbarbar IS NOT NULL OR baseline_locked_at IS NOT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── ลูกค้า + เกณฑ์ Cp/Cpk ของ item ──────────────────────────────────────────
--
-- ตาราง customers สร้างด้วย CREATE TABLE ข้างบนแล้ว (ตารางใหม่ ไม่มีรูปเก่า)
ALTER TABLE models ADD COLUMN IF NOT EXISTS customer_id INT          NULL;
ALTER TABLE models ADD COLUMN IF NOT EXISTS min_cp      DECIMAL(4,2) NULL;
ALTER TABLE models ADD COLUMN IF NOT EXISTS min_cpk     DECIMAL(4,2) NULL;
ALTER TABLE models ADD COLUMN IF NOT EXISTS min_cp_ctf  DECIMAL(4,2) NULL;
ALTER TABLE models ADD COLUMN IF NOT EXISTS min_cpk_ctf DECIMAL(4,2) NULL;
ALTER TABLE models ADD INDEX IF NOT EXISTS ix_models_customer (customer_id);

-- ⚠️ FK ห่อ guard information_schema — ADD CONSTRAINT ไม่มี IF NOT EXISTS ที่ไว้ใจได้บน 10.3
--    รันซ้ำแล้วชนชื่อ constraint เดิม db:apply จะพังทั้งไฟล์
-- RESTRICT: ลบลูกค้าที่ยังมี item ผูกอยู่ไม่ได้ ให้ปิดใช้งาน (is_active = 0) แทน
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'models' AND CONSTRAINT_NAME = 'fk_models_customer') = 0,
  'ALTER TABLE models ADD CONSTRAINT fk_models_customer
     FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── ความถี่ต่อจุดตรวจ + Characteristic (ฟอร์มชีต Input) ─────────────────────
--
-- จุดเดิมทั้งหมดได้ 'shift' = ต้องตรวจทุกกะ ตรงกับพฤติกรรมเดิมที่บังคับกรอกครบทุกจุดทุกใบ
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS frequency ENUM('shift','day') NOT NULL DEFAULT 'shift' AFTER sample_size;
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS characteristic VARCHAR(64) NULL AFTER frequency;

-- ชุดกฎ OCS ต่อลูกค้า (basic = กฎ 1-4 · full = ครบ 8 กฎ) — ลูกค้าเดิมทั้งหมดได้ basic
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ocs_rule_set ENUM('basic','full') NOT NULL DEFAULT 'basic' AFTER min_cpk_ctf;

-- ── หมวดการตรวจ (Routine / Set up / Last Piece …) + งานส่งต่อ PD → QC ──────────
--
-- เดิมระบบมีการตรวจแบบเดียว (ตรวจตามรอบ → กราฟ SPC) ตอนนี้แยกเป็นหมวด เพิ่มได้ในอนาคต
-- ⚠️ เป็นตาราง ไม่ใช่ ENUM โดยตั้งใจ — เพิ่มหมวดใหม่ = INSERT แถวเดียว ไม่ต้อง ALTER ตารางใบตรวจบน production
-- ⚠️ id = 1 คือ 'routine' ตายตัว — inspections.category_id DEFAULT 1 และ buildInspectionFilter()
--    กรองหมวด 1 เป็นค่าตั้งต้น ห้ามเปลี่ยนเลขนี้
-- has_workflow = 1 → ต้องผ่านงานส่งต่อ (check_jobs) PD ตรวจก่อน → คิว QC → QC ยืนยัน
CREATE TABLE IF NOT EXISTS check_categories (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(30)  NOT NULL,
  name          VARCHAR(100) NOT NULL,
  has_workflow  TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order    INT          NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_check_categories_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO check_categories (id, code, name, has_workflow, sort_order) VALUES
  (1, 'routine',    'ตรวจตามรอบ',  0, 1),
  (2, 'setup',      'Set up',      1, 2),
  (3, 'last_piece', 'Last Piece',  1, 3);

-- จุดตรวจไหนต้องตรวจในหมวด/ขั้นไหน กี่ชิ้น (ชีต SET UP: "5 pcs." ต่อจุด แยก Production Check / QC Confirm)
-- ไม่มีแถว = จุดนั้นไม่ต้องตรวจในขั้นนั้น · หมวด routine ไม่ใช้ตารางนี้ (ใช้ checkpoints.sample_size ตามเดิม)
-- ⚠️ ไม่ผ่าน generic CRUD — แก้ที่ PUT /master/checkpoints/:id/categories (ADMIN)
CREATE TABLE IF NOT EXISTS checkpoint_category_settings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  checkpoint_id  INT NOT NULL,
  category_id    INT NOT NULL,
  stage          ENUM('pd','qc') NOT NULL,
  sample_qty     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_ccs (checkpoint_id, category_id, stage),
  CONSTRAINT fk_ccs_checkpoint
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE,
  CONSTRAINT fk_ccs_category
    FOREIGN KEY (category_id) REFERENCES check_categories(id) ON DELETE RESTRICT,
  CONSTRAINT ck_ccs_sample_qty CHECK (sample_qty BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- งาน 1 ใบ = 1 หมวด × 1 WOS × 1 เครื่อง · status เก็บแค่ "ตอนนี้อยู่ขั้นไหน"
--   pd_checking → waiting_qc → qc_checking → passed
--                                         └→ (QC ไม่ผ่าน) กลับ pd_checking + round_no+1
--   cancelled ได้จากทุกขั้นที่ยังไม่ passed
-- ⚠️ เวลาทุกขั้นอยู่ที่ check_job_events ไม่ใช่คอลัมน์ที่นี่ — รอบ 2 หลัง QC ตีกลับจะเขียนทับรอบแรก
CREATE TABLE IF NOT EXISTS check_jobs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  category_id   INT NOT NULL,
  model_id      INT NOT NULL,
  machine_id    INT NOT NULL,
  mo_no         VARCHAR(50) NOT NULL,
  lot_no        VARCHAR(50) NULL,
  shift         ENUM('M','N','A','B','C','D') NOT NULL,
  -- สิ่งที่ IPBASS ตอบมาตอนเปิดงาน (audit trail เหมือน inspections.mo_* · NULL ปกติ) ส่งต่อลงใบตรวจทุกใบของงาน
  mo_item_no    VARCHAR(50)  NULL,
  mo_item_name  VARCHAR(150) NULL,
  mo_draw       VARCHAR(100) NULL,
  round_no      INT NOT NULL DEFAULT 1,
  status        ENUM('pd_checking','waiting_qc','qc_checking','passed','cancelled') NOT NULL DEFAULT 'pd_checking',
  result        ENUM('pass','fail') NULL,
  opened_by     INT NOT NULL,
  opened_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_at     DATETIME NULL,
  KEY ix_check_jobs_status (status, opened_at),
  KEY ix_check_jobs_mo (mo_no),
  CONSTRAINT fk_check_jobs_category FOREIGN KEY (category_id) REFERENCES check_categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_check_jobs_model    FOREIGN KEY (model_id)    REFERENCES models(id)    ON DELETE RESTRICT,
  CONSTRAINT fk_check_jobs_machine  FOREIGN KEY (machine_id)  REFERENCES machines(id)  ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- timeline ของงาน — append-only ห้ามแก้/ลบ (หลักฐานว่าใครส่ง/รับ/ยืนยันเมื่อไหร่)
-- user_name เป็น snapshot · user_id ไม่มี FK (users ไม่มีการลบ เหมือน inspection_result_edits)
CREATE TABLE IF NOT EXISTS check_job_events (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id         INT NOT NULL,
  round_no       INT NOT NULL,
  action         ENUM('open','pd_submit','qc_accept','qc_pass','qc_reject','pd_pass','pd_reject','cancel') NOT NULL,
  user_id        INT NOT NULL,
  user_name      VARCHAR(100) NOT NULL,
  note           VARCHAR(255) NULL,
  inspection_id  INT NULL,
  at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_cje_job (job_id, at),
  CONSTRAINT fk_cje_job FOREIGN KEY (job_id) REFERENCES check_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ⚠️ DEFAULT 1 (routine) — backend ตัวเก่าที่ยังรันอยู่ INSERT โดยไม่รู้จักคอลัมน์นี้ ต้องยังบันทึกได้ตามเดิม
-- ไม่มี FK ไป check_categories โดยตั้งใจ (ไม่ต้องล็อกตารางใบตรวจทั้งก้อนตอนเพิ่ม constraint บน production)
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS category_id INT NOT NULL DEFAULT 1;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS job_id      INT NULL;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS stage       ENUM('pd','qc') NULL;
ALTER TABLE inspections ADD INDEX IF NOT EXISTS ix_inspections_job (job_id);

-- role ของบัญชี — บัญชีเดิมทั้งหมดได้ ADMIN (= สิทธิ์เดิมของคน login หน้า Master)
-- inspector_id = ผู้ตรวจที่บัญชีนี้เป็น (PD/QC ต้องผูก ใบตรวจยังอ้าง inspectors เหมือนเดิม)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role SET('ADMIN','PD','QC') NOT NULL DEFAULT 'ADMIN';
ALTER TABLE users ADD COLUMN IF NOT EXISTS inspector_id INT NULL;

-- ── จุดตรวจที่ไม่ต้องอยู่ในใบตรวจตามรอบ (2026-11) ────────────────────────────
-- ใบ SET UP ของลูกค้ามีจุดตรวจ 50 จุด แต่ใบตรวจตามรอบ (Inspection Record) ใช้แค่จุด spc ไม่กี่จุด
-- in_routine = 0 → จุดนี้ตรวจเฉพาะหมวดที่ตั้งไว้ใน checkpoint_category_settings (Set up / Last Piece)
-- ⚠️ DEFAULT 1 — จุดเดิมทั้งหมดยังอยู่ในใบตรวจตามรอบเหมือนเดิม · ตัวเลือกจุดตามรอบมีที่เดียว:
--    fetchModelCheckpoints({ routineOnly }) (backend) / isRoutinePoint() (frontend utils/checkpointForm.js)
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS in_routine TINYINT(1) NOT NULL DEFAULT 1;

-- ── สิทธิ์เข้าเมนูราย role (2026-11 · ADMIN ตั้งที่ Master › ผู้ใช้ & สิทธิ์) ─────────────────
-- role GUEST = คนที่ไม่ได้ login · allowed 1 = เข้าได้ · รายการเมนู/ช่องที่ล็อกอยู่ที่ backend/services/menuAccess.js
-- ⚠️ INSERT IGNORE + คอลัมน์ allowed (ไม่ใช่ "มีแถว = อนุญาต") — db:apply ซ้ำต้องไม่เปิดสิทธิ์ที่ ADMIN ปิดไว้กลับคืน
-- seed = พฤติกรรมก่อนมีตารางนี้เป๊ะ (ใบตรวจ/Dashboard/SC/รายงาน ไม่ต้อง login · Set up = PD/QC/ADMIN · Master = ADMIN)
CREATE TABLE IF NOT EXISTS menu_permissions (
  menu_key  VARCHAR(40) NOT NULL,
  role      ENUM('GUEST','ADMIN','PD','QC') NOT NULL,
  allowed   TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_key, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO menu_permissions (menu_key, role, allowed) VALUES
  ('inspect', 'GUEST', 1), ('inspect', 'ADMIN', 1), ('inspect', 'PD', 1), ('inspect', 'QC', 1),
  ('setup', 'GUEST', 0), ('setup', 'ADMIN', 1), ('setup', 'PD', 1), ('setup', 'QC', 1),
  ('dashboard', 'GUEST', 1), ('dashboard', 'ADMIN', 1), ('dashboard', 'PD', 1), ('dashboard', 'QC', 1),
  ('sc', 'GUEST', 1), ('sc', 'ADMIN', 1), ('sc', 'PD', 1), ('sc', 'QC', 1),
  ('report', 'GUEST', 1), ('report', 'ADMIN', 1), ('report', 'PD', 1), ('report', 'QC', 1),
  ('master.items', 'GUEST', 0), ('master.items', 'ADMIN', 1), ('master.items', 'PD', 0), ('master.items', 'QC', 0),
  ('master.base', 'GUEST', 0), ('master.base', 'ADMIN', 1), ('master.base', 'PD', 0), ('master.base', 'QC', 0),
  ('master.categories', 'GUEST', 0), ('master.categories', 'ADMIN', 1), ('master.categories', 'PD', 0), ('master.categories', 'QC', 0),
  ('master.users', 'GUEST', 0), ('master.users', 'ADMIN', 1), ('master.users', 'PD', 0), ('master.users', 'QC', 0);

-- ── หมวดการตรวจ: คำอธิบายบนการ์ดหน้าแรก + ใครตรวจ (2026-11) ──────────────────────────────
-- flow: pd_qc = PD ตรวจแล้วส่ง QC ยืนยัน (Set up เดิม) · pd = PD ตรวจแล้วปิดงานเอง · qc = QC เปิดงานแล้วตรวจเอง
-- ⚠️ DEFAULT 'pd_qc' = พฤติกรรมเดิมของทุกหมวด · ตัวตัดสินลำดับขั้นอยู่ที่ routes/checkJobs.js (stagesOf)
ALTER TABLE check_categories ADD COLUMN IF NOT EXISTS description VARCHAR(200) NULL;
ALTER TABLE check_categories ADD COLUMN IF NOT EXISTS flow ENUM('pd_qc','pd','qc') NOT NULL DEFAULT 'pd_qc';
-- flow pd: PD ตัดสินผลเอง → event pd_pass / pd_reject (MODIFY รันซ้ำได้ ค่าเดิมยังอยู่ครบ)
ALTER TABLE check_job_events MODIFY action ENUM('open','pd_submit','qc_accept','qc_pass','qc_reject','pd_pass','pd_reject','cancel') NOT NULL;

-- ── อิงเครื่องจักร / item / เครื่อง↔item จากระบบ Drawing Digital (2026-11 · services/drawingSync.js) ─────
-- synced_at NULL = ไม่ได้มาจาก Drawing (ตั้งมือ / Mecha 2) · allow_all_items 1 = เครื่องนี้รันได้ทุก item (ค่าเริ่ม = พฤติกรรมเดิม)
-- machine_items = สำเนาของ machine_models ใน Drawing (เฉพาะเครื่องที่ allow_all_items = 0) · ใช้กรองตัวเลือกหน้าใบตรวจ/Set up เท่านั้น ไม่กั้นการบันทึก
ALTER TABLE machines ADD COLUMN IF NOT EXISTS allow_all_items TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS synced_at DATETIME NULL;
ALTER TABLE models ADD COLUMN IF NOT EXISTS synced_at DATETIME NULL;
CREATE TABLE IF NOT EXISTS machine_items (
  machine_id  INT NOT NULL,
  model_id    INT NOT NULL,
  PRIMARY KEY (machine_id, model_id),
  KEY ix_machine_items_model (model_id),
  CONSTRAINT fk_machine_items_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
  CONSTRAINT fk_machine_items_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
