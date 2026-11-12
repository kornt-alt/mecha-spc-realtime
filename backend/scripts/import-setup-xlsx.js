// backend/scripts/import-setup-xlsx.js — นำจุดตรวจจากใบ "SET UP & LAST PIECE INSPECTION RECORD" (Excel) เข้า item
//
// ใช้:
//   npm run import:setup -- "<ไฟล์.xlsx>" --model <id>                    ดูตัวอย่าง (ไม่แตะ DB) ← ค่าเริ่ม
//   npm run import:setup -- "<ไฟล์.xlsx>" --model <id> --apply            บันทึกจริง
//   เพิ่ม --deactivate 12,13,14  = ปิดใช้งานจุดเดิมพวกนี้ใน transaction เดียวกัน
//
// รูปใบ (ชีตแรก): หัวใบ H8 = Item No · จุดตรวจเริ่มแถว 16 ทีละ 2 แถว
//   A = No (8.1) · C = Critical Point ("spc") · D = สัญลักษณ์ (Ø / Lg / C / Surface …) · F = ค่ากลาง
//   I/J = เครื่องหมาย/พิกัดบน (แถวแรก) และล่าง (แถวสอง) · K = Max (แถวแรก) / Min (แถวสอง) ← สูตรของ Excel
//   L = เครื่องมือวัด · P = "5 pcs." (จำนวนชิ้นของ Production Check — QC Confirm ใช้เท่ากัน)
//
// ⚠️ USL/LSL เอาจากผลสูตรในคอลัมน์ K ของ Excel เอง (ไม่คิดใหม่) แล้วตรวจไขว้กับ F ± J — ไม่ตรง = หยุดทั้งไฟล์
//    สเปกผิดแล้วบันทึกใบตรวจไปแล้ว แก้ย้อนหลังไม่ได้ (judgment ถูก snapshot)
// ⚠️ จุดที่ C = "spc" อยู่ในใบตรวจตามรอบด้วย (in_routine = 1) · ที่เหลือตรวจเฉพาะ Set up (in_routine = 0)
// ⚠️ ตั้งเฉพาะหมวด Set up (code 'setup') ขั้น PD และ QC = จำนวนชิ้นเดียวกัน — Last Piece ตั้งทีหลังที่ตาราง Master
// ⚠️ กันรันซ้ำ: มีจุดที่เปิดใช้งานชื่อเดียวกันอยู่แล้ว = ปฏิเสธ · Item No ในใบต้องตรงกับ item ที่สั่ง
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');
const { parseWorkbook } = require('../services/checkpointImport');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d+(,\d+)*$/.test(a));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null;
};
const modelId = Number(flag('model'));
const apply = Boolean(flag('apply'));
const deactivate = typeof flag('deactivate') === 'string' ? flag('deactivate').split(',').map(Number) : [];

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

// ตัวอ่านอยู่ที่ services/checkpointImport.js (ใช้ร่วมกับหน้า Master ที่ลากไฟล์มาวาง) — error รายแถว = หยุดทั้งไฟล์
const parse = async (xlsx) => {
  const r = await parseWorkbook(fs.readFileSync(xlsx));
  if (r.format !== 'setup') fail(r.reason ?? 'ไฟล์นี้ไม่ใช่ใบ SET UP (ไฟล์ตาราง/แม่แบบ ให้นำเข้าที่หน้า Master)');
  if (r.errors.length) fail(r.errors.map((e) => `แถว ${e.row} (${e.name}): ${e.message}`).join('\n  '));
  return r;
};

const main = async () => {
  if (!file) fail('ต้องระบุไฟล์ .xlsx');
  if (!Number.isInteger(modelId) || modelId < 1) fail('ต้องระบุ --model <id>');
  const { itemNo, points } = await parse(path.resolve(file));
  if (points.length === 0) fail('ไม่พบจุดตรวจในไฟล์');

  const conn = await mysql.createConnection({
    host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: env.DB_PORT,
  });
  try {
    const [[model]] = await conn.query('SELECT id, item_no, item_name FROM models WHERE id = ?', [modelId]);
    if (!model) fail(`ไม่พบ model id ${modelId}`);
    if (String(model.item_no).trim() !== itemNo) fail(`Item No ในใบ (${itemNo}) ไม่ตรงกับ model ${modelId} (${model.item_no})`);
    const [[setup]] = await conn.query("SELECT id FROM check_categories WHERE code = 'setup'");
    if (!setup) fail('ไม่พบหมวด setup ใน check_categories (รัน db:apply ก่อน)');

    const [existing] = await conn.query('SELECT id, seq_no, name, is_active FROM checkpoints WHERE model_id = ?', [modelId]);
    const activeNames = new Set(existing.filter((c) => c.is_active && !deactivate.includes(c.id)).map((c) => c.name));
    const dup = points.filter((p) => activeNames.has(p.name));
    if (dup.length) fail(`มีจุดชื่อเดียวกันเปิดใช้งานอยู่แล้ว (รันซ้ำ?): ${dup.map((p) => p.name).join(', ')}`);
    const badDeact = deactivate.filter((id) => !existing.some((c) => c.id === id));
    if (badDeact.length) fail(`--deactivate มี id ที่ไม่ใช่จุดของ item นี้: ${badDeact.join(', ')}`);
    let seq = existing.reduce((m, c) => Math.max(m, c.seq_no), 0);

    console.log(`\nItem ${model.item_no} — ${model.item_name} (model ${modelId}) · ${points.length} จุด`);
    console.table(points.map((p) => ({
      แถว: p.row, จุด: p.name, ชนิด: p.char_type === 'attribute' ? 'ตา' : 'วัด', LSL: p.lsl, USL: p.usl,
      หน่วย: p.unit, เครื่องมือ: p.gauge, ชิ้น: p.qty, SC: p.is_critical ? '★' : '', ตามรอบ: p.in_routine ? '✓' : '',
    })));
    if (deactivate.length) console.log(`ปิดใช้งานจุดเดิม: ${deactivate.join(', ')}`);

    if (!apply) {
      console.log('\n(ดูตัวอย่างเท่านั้น — ยังไม่แตะ DB · ใส่ --apply เพื่อบันทึก)');
      return;
    }

    await conn.beginTransaction();
    try {
      if (deactivate.length) {
        await conn.query('UPDATE checkpoints SET is_active = 0 WHERE model_id = ? AND id IN (?)', [modelId, deactivate]);
      }
      for (const p of points) {
        seq += 1;
        const [r] = await conn.execute(
          `INSERT INTO checkpoints
             (model_id, seq_no, name, char_type, unit, gauge, usl, lsl, target, sample_size, frequency,
              characteristic, is_critical, is_active, in_routine)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shift', ?, ?, 1, ?)`,
          [modelId, seq, p.name, p.char_type, p.unit, p.gauge, p.usl, p.lsl, p.target, p.sample_size,
            p.characteristic, p.is_critical, p.in_routine]
        );
        await conn.query(
          'INSERT INTO checkpoint_category_settings (checkpoint_id, category_id, stage, sample_qty) VALUES ?',
          [[[r.insertId, setup.id, 'pd', p.qty], [r.insertId, setup.id, 'qc', p.qty]]]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
    console.log(`\n✓ บันทึกแล้ว ${points.length} จุด + ตั้ง Set up PD/QC ${points.length * 2} แถว`);
    console.log('  หน้า Master ที่เปิดค้างไว้ให้กดรีเฟรช (สคริปต์ไม่ได้ส่ง master_updated)');
  } finally {
    await conn.end();
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
