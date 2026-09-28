// backend/db/schemaCheck.js — ตอน start บอกว่า schema ใน DB ยังไม่ตรงกับที่โค้ดต้องการตรงไหน
//
// ทำไมต้องมี: schema ของโปรเจกต์นี้เคยอยู่แต่ใน DB ไม่มี DDL ใน repo เลย ใครมาใหม่ก็ไม่รู้ว่า
// ต้องมีตารางอะไรบ้าง และ CREATE TABLE IF NOT EXISTS ก็ "ข้ามเงียบ ๆ" เมื่อเจอตารางชื่อเดียวกัน
// แต่คนละรูป (machines เดิมไม่มี code/is_active) — อาการคือ query พังตอน runtime แทนที่จะรู้ตั้งแต่ต้น
//
// ⚠️ ตั้งใจให้ "เตือนแล้วไปต่อ" ไม่ใช่ล้ม startup — server ที่ไม่ขึ้นเลยเพราะ schema เพี้ยนนิดเดียว
//    ทำให้แก้ยากกว่าเดิม (เข้าไปดู log ก็ไม่ได้) ตรงนี้จึงแค่พิมพ์บอกว่าให้ไปรันอะไร
'use strict';

const { query } = require('./pool');
const env = require('../config/env');

// คอลัมน์ที่ "โค้ดพึ่งพาจริง" เท่านั้น ไม่ต้องลิสต์ให้ครบทุกคอลัมน์
// เอาไว้จับกรณีตารางชื่อตรงแต่เป็นรูปเก่า
const REQUIRED = {
  divisions: ['id', 'name', 'ipbass_dept'],
  machines: ['id', 'division_id', 'code', 'name', 'is_active'],
  inspectors: ['id', 'emp_code', 'name', 'is_active'],
  users: ['id', 'username', 'password_hash', 'display_name', 'is_active', 'passkey_hash'],
  customers: ['id', 'name', 'min_cp', 'min_cpk', 'min_cp_ctf', 'min_cpk_ctf', 'ocs_rule_set', 'is_active'],
  models: [
    'id', 'division_id', 'item_no', 'item_name', 'is_active',
    'customer_id', 'min_cp', 'min_cpk', 'min_cp_ctf', 'min_cpk_ctf',
  ],
  checkpoints: [
    'id', 'model_id', 'seq_no', 'name', 'char_type',
    'usl', 'lsl', 'target', 'sample_size', 'frequency', 'characteristic', 'is_active',
    // ⚠️ ไม่มี baseline_* ตรงนี้แล้ว ย้ายไปตาราง checkpoint_baselines (แยกรายเครื่อง)
    //    คอลัมน์เก่ายังค้างอยู่ใน DB จนกว่าจะรัน drop-legacy.sql แต่ไม่มีโค้ดไหนอ่านแล้ว
  ],
  checkpoint_baselines: [
    'id', 'checkpoint_id', 'machine_id', 'xbarbar', 'rbar', 'n', 'locked_at',
  ],
  inspections: [
    'id', 'model_id', 'machine_id', 'inspector_id',
    'mo_no', 'shift', 'subgroup_no', 'inspected_at', 'overall_result',
    'mo_item_no', 'mo_item_name', 'mo_draw', 'mo_model_group',
    'voided_at', 'voided_reason',
  ],
  inspection_results: [
    'id', 'inspection_id', 'checkpoint_id', 'piece_no',
    'value', 'judgment', 'usl_used', 'lsl_used', 'n_used',
  ],
  ocs_events: [
    'id', 'checkpoint_id', 'inspection_id', 'chart', 'rules', 'man_pd', 'man_qc',
    'machine_note', 'method', 'material', 'measurement', 'corrective_action', 'recorded_by',
  ],
};

// ตารางของระบบเดิมที่ควรหายไปแล้ว — มีอยู่ก็ไม่พัง แค่บอกว่ายังลบไม่หมด
const LEGACY = ['parts', 'specs', 'measurements'];

// ---- ส่วน pure (เทสได้ ไม่แตะ DB) ----

// diffSchema(required, actual) → { missingTables, missingColumns }
// actual = { tableName: Set(columnNames) }
const diffSchema = (required, actual) => {
  const missingTables = [];
  const missingColumns = [];

  for (const [table, columns] of Object.entries(required)) {
    const found = actual[table];
    if (!found) {
      missingTables.push(table);
      continue;
    }
    const lacking = columns.filter((c) => !found.has(c));
    if (lacking.length > 0) missingColumns.push({ table, columns: lacking });
  }

  return { missingTables, missingColumns };
};

// ---- ส่วนที่คุยกับ DB ----

const checkSchema = async () => {
  let rows;
  try {
    [rows] = await query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?`,
      [env.DB_NAME]
    );
  } catch (err) {
    console.warn(`[schema] ตรวจ schema ไม่ได้ (${err.message}) — ข้ามไปก่อน`);
    return { ok: false, reason: 'unreachable' };
  }

  const actual = {};
  for (const row of rows) {
    if (!actual[row.t]) actual[row.t] = new Set();
    actual[row.t].add(row.c);
  }

  const { missingTables, missingColumns } = diffSchema(REQUIRED, actual);
  const legacyLeft = LEGACY.filter((t) => actual[t]);

  if (missingTables.length === 0 && missingColumns.length === 0) {
    if (legacyLeft.length > 0) {
      console.log(`[schema] ตารางครบ · ของเดิมยังค้างอยู่: ${legacyLeft.join(', ')} (ลบด้วย node db/migrate.js drop-legacy.sql)`);
    } else {
      console.log('[schema] ตารางครบตามที่โค้ดต้องการ');
    }
    return { ok: true };
  }

  console.warn('[schema] ───────────────────────────────────────────────');
  if (missingTables.length > 0) {
    console.warn(`[schema] ยังไม่มีตาราง: ${missingTables.join(', ')}`);
    console.warn('[schema] → รัน: node db/migrate.js schema.sql');
  }
  if (missingColumns.length > 0) {
    for (const { table, columns } of missingColumns) {
      console.warn(`[schema] ตาราง ${table} มีอยู่แต่เป็นรูปเก่า ขาด: ${columns.join(', ')}`);
    }
    console.warn('[schema] → รัน: npm run db:apply (ส่วน ALTER ท้าย schema.sql เติมคอลัมน์ที่ขาดให้เอง ไม่ลบข้อมูล)');
  }
  console.warn('[schema] server ยังขึ้นตามปกติ แต่ API ที่แตะตารางพวกนี้จะตอบ 500');
  console.warn('[schema] ───────────────────────────────────────────────');

  return { ok: false, missingTables, missingColumns };
};

module.exports = { checkSchema, diffSchema, REQUIRED, LEGACY };
