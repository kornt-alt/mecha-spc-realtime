// services/checkpointImport.js — อ่านไฟล์ Excel ที่ใช้นำเข้าจุดตรวจ (pure — ไม่แตะ DB)
//
// ใช้ทั้ง POST /master/models/:id/import/parse (หน้า Master ลากไฟล์มาวาง) และสคริปต์ npm run import:setup
//
// รองรับ 2 รูป:
//   'setup' = ใบ "SET UP & LAST PIECE INSPECTION RECORD" ของจริง (ชีตแรก)
//             หัวใบ H8 = Item No · จุดตรวจเริ่มแถว 16 ทีละ 2 แถว
//             A = No (8.1) · C = Critical Point ("spc") · D = สัญลักษณ์ (Ø / Lg / C / Surface …) · F = ค่ากลาง
//             I/J = เครื่องหมาย/พิกัดบน (แถวแรก) และล่าง (แถวสอง) · K = Max (แถวแรก) / Min (แถวสอง) ← สูตรของ Excel
//             L = เครื่องมือวัด · P = "5 pcs." (จำนวนชิ้นของ Production Check — QC Confirm ใช้เท่ากัน)
//   'table' = ตารางหัวคอลัมน์ (ไฟล์แม่แบบจาก buildTemplate หรือ Excel ที่คนทำเอง) — ส่งเป็นตารางข้อความกลับไป
//             หน้าเว็บแมปหัวคอลัมน์เองด้วยตัวเดียวกับ "วางจาก Excel" (utils/checkpointBulk.js) จะได้มีกฎชุดเดียว
//
// ⚠️ USL/LSL ของใบ SET UP เอาจากผลสูตรในคอลัมน์ K ของ Excel เอง (ไม่คิดใหม่) แล้วตรวจไขว้กับ F ± J
//    ไม่ตรง = error ของแถวนั้น (สเปกผิดแล้วบันทึกใบตรวจไปแล้ว แก้ย้อนหลังไม่ได้ — judgment ถูก snapshot)
// ⚠️ จุดที่ C = "spc" อยู่ในใบตรวจตามรอบด้วย (in_routine = 1) · ที่เหลือตรวจเฉพาะ Set up (in_routine = 0)
// ⚠️ ตั้งเฉพาะหมวด Set up ขั้น PD และ QC = จำนวนชิ้นเดียวกัน — Last Piece ตั้งทีหลัง
'use strict';

const ExcelJS = require('exceljs');

const FIRST_ROW = 16;
const COL = { no: 1, crit: 3, sym: 4, nominal: 6, sign: 9, tol: 10, limit: 11, gauge: 12, pcs: 16 };
const UNIT_BY_SYMBOL = { Surface: 'μm', Angle: '°' }; // ⚠️ μ = U+03BC (ตัวเดียวกับ UNIT_OPTIONS ฝั่งหน้าเว็บ)
const MAX_TABLE_ROWS = 500;

// ค่าของเซลล์: สูตร → ผลที่ Excel คำนวณไว้ · rich text → ข้อความ · ว่าง → null
const cellValue = (ws, r, c) => {
  const v = ws.getCell(r, c).value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result ?? null;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return null;
  }
  return v;
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const round = (v) => (v === null ? null : Math.round(v * 1e6) / 1e6);

const loadWorkbook = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return null;
  }
  return wb;
};

// ใบ SET UP: H8 มี Item No และแถว 16 เป็นข้อ (A = "1" / "8.1") ที่มี Max ในคอลัมน์ K หรือจำนวนชิ้นในคอลัมน์ P
const looksLikeSetup = (ws) => {
  if (!text(cellValue(ws, 8, 8))) return false;
  for (let r = FIRST_ROW; r < FIRST_ROW + 20; r += 1) {
    if (/^\d+(\.\d+)?$/.test(text(cellValue(ws, r, COL.no))) && /\d/.test(text(cellValue(ws, r, COL.pcs)))) return true;
  }
  return false;
};

// คืน { itemNo, points, errors } — errors = [{ row, message }] (ไม่ throw ให้หน้าเว็บโชว์ครบทุกแถว)
const parseSetupSheet = (ws) => {
  const itemNo = text(cellValue(ws, 8, 8));
  const points = [];
  const errors = [];
  for (let r = FIRST_ROW; r <= ws.rowCount; r += 2) {
    // ⚠️ เซลล์ที่ merge ไว้ exceljs คืนค่าของเซลล์หลักให้ทุกช่อง — แถวที่ A เป็นส่วนต่อของ merge = ไม่ใช่จุดใหม่
    const noCell = ws.getCell(r, COL.no);
    if (noCell.isMerged && noCell.master.address !== noCell.address) continue;
    const no = text(cellValue(ws, r, COL.no));
    if (!no) continue;
    const sym = text(cellValue(ws, r, COL.sym)).split(/[\s(]/)[0];
    const nominalRaw = cellValue(ws, r, COL.nominal);
    const nominal = num(nominalRaw);
    const maxV = num(cellValue(ws, r, COL.limit));
    const minV = num(cellValue(ws, r + 1, COL.limit));
    const pcsText = text(cellValue(ws, r, COL.pcs));
    const pcs = Number(pcsText.match(/\d+/)?.[0]);
    const isAttr = maxV === null && minV === null;
    // ชื่อจุด = เลขข้อ + สัญลักษณ์ ("8.1 Ø") · จุดตรวจด้วยตาใช้ข้อความในใบ ("33 Screw Nut", "34 Appearance")
    const attrLabel = ((nominal === null && text(nominalRaw)) || text(cellValue(ws, r, COL.sym))).split('(')[0].trim();
    const name = (isAttr ? `${no} ${attrLabel}` : `${no} ${sym}`).trim();
    const rowErrors = [];

    // ตรวจไขว้ K กับ F ± J (เฉพาะแถวที่มีพิกัดตัวเลข)
    const signU = text(cellValue(ws, r, COL.sign));
    const tolU = cellValue(ws, r, COL.tol);
    const signL = text(cellValue(ws, r + 1, COL.sign));
    const tolL = num(cellValue(ws, r + 1, COL.tol));
    if (!isAttr && nominal !== null && typeof tolU === 'number') {
      const expU = signU === '+' ? nominal + tolU : signU === '-' ? nominal - tolU : nominal;
      const expL = tolL === null ? null : signL === '-' ? nominal - tolL : signL === '+' ? nominal + tolL : nominal;
      if (maxV !== null && Math.abs(expU - maxV) > 1e-9) rowErrors.push(`Max ใน Excel = ${maxV} แต่ค่ากลาง ± พิกัดได้ ${round(expU)}`);
      if (expL !== null && minV !== null && Math.abs(expL - minV) > 1e-9) rowErrors.push(`Min ใน Excel = ${minV} แต่ค่ากลาง ± พิกัดได้ ${round(expL)}`);
    }
    if (!Number.isInteger(pcs) || pcs < 1 || pcs > 10) rowErrors.push(`อ่านจำนวนชิ้น "${pcsText}" ไม่ได้ (ต้อง 1-10)`);
    rowErrors.forEach((message) => errors.push({ row: r, name, message }));

    const qty = isAttr ? 1 : (Number.isInteger(pcs) ? pcs : null);
    const spc = text(cellValue(ws, r, COL.crit)).toLowerCase() === 'spc';
    points.push({
      row: r,
      name: name.slice(0, 150),
      characteristic: isAttr ? null : (sym.slice(0, 64) || null),
      char_type: isAttr ? 'attribute' : 'variable',
      unit: isAttr ? null : (UNIT_BY_SYMBOL[sym] ?? 'mm'),
      gauge: text(cellValue(ws, r, COL.gauge)).replace(/[.,]+$/, '').slice(0, 100) || null,
      usl: isAttr ? null : round(maxV),
      lsl: isAttr ? null : round(minV),
      target: isAttr ? null : round(nominal),
      sample_size: qty,
      qty,
      is_critical: spc ? 1 : 0,
      in_routine: spc ? 1 : 0,
    });
  }
  return { itemNo, points, errors };
};

// ตารางหัวคอลัมน์ → array ของแถว (ข้อความล้วน) ตัดแถวว่างหัว/ท้าย · ชีตชื่อ CHECKPOINTS มาก่อน ไม่มีใช้ชีตแรก
const sheetToTable = (ws) => {
  const rows = [];
  const last = Math.min(ws.rowCount, MAX_TABLE_ROWS + 1);
  const width = Math.min(ws.columnCount, 60);
  for (let r = 1; r <= last; r += 1) {
    const row = [];
    for (let c = 1; c <= width; c += 1) {
      const v = cellValue(ws, r, c);
      row.push(v instanceof Date ? '' : typeof v === 'boolean' ? (v ? 'Y' : 'N') : text(v));
    }
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  while (rows.length && rows[0].length === 0) rows.shift();
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
};

// buffer ของไฟล์ .xlsx → { format: 'setup', itemNo, points, errors } | { format: 'table', rows } | { format: null, reason }
const parseWorkbook = async (buffer) => {
  const wb = await loadWorkbook(buffer);
  if (!wb || wb.worksheets.length === 0) return { format: null, reason: 'เปิดไฟล์ไม่ได้ — ต้องเป็นไฟล์ Excel .xlsx (ไฟล์ .xls รุ่นเก่าให้ Save As เป็น .xlsx ก่อน)' };
  const named = wb.worksheets.find((w) => w.name.trim().toUpperCase() === TEMPLATE_SHEET);
  if (named) return { format: 'table', rows: sheetToTable(named) };
  const first = wb.worksheets[0];
  if (looksLikeSetup(first)) return { format: 'setup', ...parseSetupSheet(first) };
  const rows = sheetToTable(first);
  if (rows.length < 2) return { format: null, reason: 'ไม่พบข้อมูลในไฟล์ — ใช้ใบ SET UP หรือไฟล์แม่แบบจากปุ่ม "ดาวน์โหลดแม่แบบ"' };
  return { format: 'table', rows };
};

// ── ไฟล์แม่แบบ ────────────────────────────────────────────────────────────
// ⚠️ หัวคอลัมน์ต้องตรงกับ alias ใน frontend/src/utils/checkpointBulk.js (หน้าเว็บเป็นคนแมป)
const TEMPLATE_SHEET = 'CHECKPOINTS';
const TEMPLATE_COLUMNS = [
  { header: 'ชื่อจุดตรวจ', width: 22, example: ['3.1 Ø', '33 Appearance'] },
  { header: 'Characteristic', width: 14, example: ['OD', ''] },
  { header: 'ชนิด (วัด/ตา)', width: 13, example: ['วัด', 'ตา'] },
  { header: 'หน่วย', width: 8, example: ['mm', ''] },
  { header: 'เครื่องมือวัด', width: 18, example: ['Micrometer', 'Visual'] },
  { header: 'LSL', width: 10, example: ['', ''] },
  { header: 'Target', width: 10, example: ['', ''] },
  { header: 'USL', width: 10, example: ['', ''] },
  { header: 'ค่ากลาง', width: 10, example: [10, ''] },
  { header: 'พิกัดบน', width: 10, example: ['+0.02', ''] },
  { header: 'พิกัดล่าง', width: 10, example: ['-0.01', ''] },
  { header: 'ชิ้น/ครั้ง', width: 10, example: [2, 1] },
  { header: 'ความถี่ (กะ/วัน)', width: 14, example: ['กะ', 'วัน'] },
  { header: 'ตรวจตามรอบ (Y/N)', width: 16, example: ['Y', 'N'] },
  { header: 'SC point (Y/N)', width: 14, example: ['N', 'N'] },
];
const STAGE_LABEL = { pd: 'PD', qc: 'QC' };
const FLOW_STAGES = { pd_qc: ['pd', 'qc'], pd: ['pd'], qc: ['qc'] };

// categories = [{ id, name, flow, has_workflow, is_active }] → workbook (เขียนลง res ได้ตรง ๆ)
const buildTemplate = (categories = []) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(TEMPLATE_SHEET);
  const catCols = categories
    .filter((c) => Number(c.has_workflow) && Number(c.is_active ?? 1))
    .flatMap((c) => (FLOW_STAGES[c.flow] ?? FLOW_STAGES.pd_qc).map((s) => ({
      header: `${c.name} ${STAGE_LABEL[s]}`, width: 14, example: [2, 1],
    })));
  const cols = [...TEMPLATE_COLUMNS, ...catCols];
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  ws.addRow(cols.map((c) => c.example[0]));
  ws.addRow(cols.map((c) => c.example[1]));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4FA0' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  // dropdown ของคอลัมน์ที่มีค่าตายตัว (ถึงแถว 300)
  const list = (colIdx, values) => {
    for (let r = 2; r <= 300; r += 1) {
      ws.getCell(r, colIdx).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${values}"`] };
    }
  };
  list(3, 'วัด,ตา');
  list(13, 'กะ,วัน');
  list(14, 'Y,N');
  list(15, 'Y,N');
  const note = wb.addWorksheet('วิธีกรอก');
  [
    'กรอกที่ชีต CHECKPOINTS 1 แถว = 1 จุดตรวจ (ลบแถวตัวอย่าง 2 แถวทิ้งได้) แล้วลากไฟล์มาวางที่การ์ดจุดตรวจในหน้า Master',
    'สเปก: กรอก LSL / Target / USL หรือ ค่ากลาง + พิกัดบน + พิกัดล่าง อย่างใดอย่างหนึ่ง',
    'พิกัดไม่ใส่เครื่องหมาย = พิกัดบนขึ้น พิกัดล่างลง · ใส่ + หรือ - เองได้ (เช่น 10 / -0.005 / -0.015)',
    'ชนิด "ตา" = ตรวจด้วยตา (OK/NG) ไม่ต้องกรอกสเปก ตรวจ 1 ชิ้นเสมอ',
    'คอลัมน์หมวด (เช่น Set up PD) = จำนวนชิ้นที่ต้องตรวจในขั้นนั้น · เว้นว่าง = ไม่ตรวจ',
    'ยังไม่บันทึกจนกว่าจะกดบันทึกบนหน้าเว็บ — ตรวจดูตัวอย่างก่อนได้',
  ].forEach((t) => note.addRow([t]));
  note.getColumn(1).width = 110;
  return wb;
};

module.exports = { parseWorkbook, parseSetupSheet, buildTemplate, TEMPLATE_SHEET };
