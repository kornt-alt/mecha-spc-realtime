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

const path = require('path');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
const env = require('../config/env');

const FIRST_ROW = 16;
const COL = { no: 1, crit: 3, sym: 4, nominal: 6, unitSym: 8, sign: 9, tol: 10, limit: 11, gauge: 12, pcs: 16 };

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

// ค่าของเซลล์: สูตร → ผลที่ Excel คำนวณไว้ · rich text → ข้อความ · ว่าง → null
const val = (ws, r, c) => {
  const v = ws.getCell(r, c).value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('result' in v) return v.result ?? null;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const round = (v) => (v === null ? null : Math.round(v * 1e6) / 1e6);

const UNIT_BY_SYMBOL = { Surface: 'μm', Angle: '°' }; // ⚠️ μ = U+03BC (ตัวเดียวกับ UNIT_OPTIONS ฝั่งหน้าเว็บ)

const parse = async (xlsx) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  const ws = wb.worksheets[0];
  const itemNo = text(val(ws, 8, 8));
  const points = [];
  for (let r = FIRST_ROW; r <= ws.rowCount; r += 2) {
    // ⚠️ เซลล์ที่ merge ไว้ exceljs คืนค่าของเซลล์หลักให้ทุกช่อง — แถวที่ A เป็นส่วนต่อของ merge = ไม่ใช่จุดใหม่
    const noCell = ws.getCell(r, COL.no);
    if (noCell.isMerged && noCell.master.address !== noCell.address) continue;
    const no = text(val(ws, r, COL.no));
    if (!no) continue;
    const sym = text(val(ws, r, COL.sym)).split(/[\s(]/)[0];
    const nominalRaw = val(ws, r, COL.nominal);
    const nominal = num(nominalRaw);
    const maxV = num(val(ws, r, COL.limit));
    const minV = num(val(ws, r + 1, COL.limit));
    const pcs = Number(String(text(val(ws, r, COL.pcs))).match(/\d+/)?.[0]);
    const isAttr = maxV === null && minV === null;
    // ชื่อจุด = เลขข้อ + สัญลักษณ์ ("8.1 Ø") · จุดตรวจด้วยตาใช้ข้อความในใบ ("33 Screw Nut", "34 Appearance")
    const attrLabel = ((nominal === null && text(nominalRaw)) || text(val(ws, r, COL.sym))).split('(')[0].trim();
    const name = (isAttr ? `${no} ${attrLabel}` : `${no} ${sym}`).trim();

    // ตรวจไขว้ K กับ F ± J (เฉพาะแถวที่มีพิกัดตัวเลข)
    const signU = text(val(ws, r, COL.sign));
    const tolU = val(ws, r, COL.tol);
    const signL = text(val(ws, r + 1, COL.sign));
    const tolL = num(val(ws, r + 1, COL.tol));
    if (!isAttr && nominal !== null && typeof tolU === 'number') {
      const expU = signU === '+' ? nominal + tolU : signU === '-' ? nominal - tolU : nominal;
      const expL = tolL === null ? null : signL === '-' ? nominal - tolL : signL === '+' ? nominal + tolL : nominal;
      if (maxV !== null && Math.abs(expU - maxV) > 1e-9) fail(`แถว ${r} (${no}): Max ใน Excel = ${maxV} แต่ F±J ได้ ${expU}`);
      if (expL !== null && minV !== null && Math.abs(expL - minV) > 1e-9) fail(`แถว ${r + 1} (${no}): Min ใน Excel = ${minV} แต่ F±J ได้ ${expL}`);
    }
    if (!Number.isInteger(pcs) || pcs < 1 || pcs > 10) fail(`แถว ${r} (${no}): อ่านจำนวนชิ้น "${text(val(ws, r, COL.pcs))}" ไม่ได้`);

    const spc = text(val(ws, r, COL.crit)).toLowerCase() === 'spc';
    points.push({
      row: r,
      name: name.slice(0, 150),
      characteristic: isAttr ? null : (sym || null),
      char_type: isAttr ? 'attribute' : 'variable',
      unit: isAttr ? null : (UNIT_BY_SYMBOL[sym] ?? 'mm'),
      gauge: text(val(ws, r, COL.gauge)).replace(/[.,]+$/, '').slice(0, 100) || null,
      usl: isAttr ? null : round(maxV),
      lsl: isAttr ? null : round(minV),
      target: isAttr ? null : round(nominal),
      sample_size: isAttr ? 1 : pcs,
      qty: isAttr ? 1 : pcs,
      is_critical: spc ? 1 : 0,
      in_routine: spc ? 1 : 0,
    });
  }
  return { itemNo, points };
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
