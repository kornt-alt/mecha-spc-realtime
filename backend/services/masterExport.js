// services/masterExport.js — ไฟล์ Excel ของ master (pure — ไม่แตะ DB ผู้เรียกส่งแถวมาให้)
//
// ใช้ที่ POST /master/export (ไฟล์รวม / รายแท็บ) และ GET /master/item-template
//
// ไฟล์ item = ชีต ITEMS (1 แถว = 1 item) + ชีต ITEM_CHECKPOINTS (Division + Item No + คอลัมน์ของแม่แบบจุดตรวจ)
//   → แก้แล้วลากกลับมาที่ "นำเข้า item จาก Excel" ได้ (หน้าเว็บแมปหัวด้วย utils/itemBulk.js + checkpointBulk.js)
// ⚠️ หัวคอลัมน์ของ ITEMS ต้องอยู่ใน alias ของ ITEM_COLUMNS ใน frontend/src/utils/itemBulk.js
// ⚠️ ชีตจุดตรวจชื่อ ITEM_CHECKPOINTS ไม่ใช่ CHECKPOINTS โดยตั้งใจ — ลากไฟล์นี้ไปวางที่การ์ดจุดตรวจของ item เดียว
//    แล้วต้องไม่ถูกอ่านเป็นแม่แบบจุดตรวจ (จุดของทุก item จะไหลเข้า item เดียว) · parseWorkbook ปฏิเสธไฟล์ที่มีชีต ITEMS
'use strict';

const ExcelJS = require('exceljs');
const { TEMPLATE_COLUMNS, catColumns, pointRow } = require('./checkpointImport');

const ITEM_SHEET = 'ITEMS';
const ITEM_POINT_SHEET = 'ITEM_CHECKPOINTS';
const DATA_ROWS = 500; // dropdown ถึงแถวนี้

const numOrBlank = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const yn = (v) => (Number(v ?? 1) ? 'Y' : 'N');

// ⚠️ ลำดับ/หัวตรงกับ ITEM_COLUMNS ของ utils/itemBulk.js
const ITEM_COLUMNS = [
  { header: 'Division', width: 14, get: (m) => m.division_name },
  { header: 'Item No', width: 24, get: (m) => m.item_no },
  { header: 'ชื่อ item', width: 30, get: (m) => m.item_name },
  { header: 'Drawing No', width: 16, get: (m) => m.drawing_no },
  { header: 'Drawing Rev', width: 12, get: (m) => m.drawing_rev },
  { header: 'ลูกค้า', width: 18, get: (m) => m.customer_name },
  { header: 'Cp ขั้นต่ำ', width: 11, get: (m) => numOrBlank(m.min_cp) },
  { header: 'Cpk ขั้นต่ำ', width: 11, get: (m) => numOrBlank(m.min_cpk) },
  { header: 'Cp ขั้นต่ำ (SC)', width: 14, get: (m) => numOrBlank(m.min_cp_ctf) },
  { header: 'Cpk ขั้นต่ำ (SC)', width: 14, get: (m) => numOrBlank(m.min_cpk_ctf) },
  { header: 'ใช้งาน (Y/N)', width: 12, get: (m) => yn(m.is_active) },
];

const BASE_SHEETS = {
  divisions: {
    name: 'Division',
    columns: [
      { header: 'ชื่อ', width: 18, get: (r) => r.name },
      { header: 'IPBASS dept', width: 14, get: (r) => r.ipbass_dept },
      { header: 'ใช้งาน (Y/N)', width: 12, get: (r) => yn(r.is_active) },
    ],
  },
  machines: {
    name: 'เครื่องจักร',
    columns: [
      { header: 'Division', width: 14, get: (r) => r.division_name },
      { header: 'รหัสเครื่อง', width: 16, get: (r) => r.code },
      { header: 'ชื่อ', width: 26, get: (r) => r.name },
      { header: 'ใช้งาน (Y/N)', width: 12, get: (r) => yn(r.is_active) },
    ],
  },
  inspectors: {
    name: 'ผู้ตรวจ',
    columns: [
      { header: 'รหัสพนักงาน', width: 14, get: (r) => r.emp_code },
      { header: 'ชื่อ', width: 26, get: (r) => r.name },
      { header: 'Division', width: 14, get: (r) => r.division_name },
      { header: 'ใช้งาน (Y/N)', width: 12, get: (r) => yn(r.is_active) },
    ],
  },
  customers: {
    name: 'ลูกค้า',
    columns: [
      { header: 'ชื่อ', width: 22, get: (r) => r.name },
      { header: 'Cp ขั้นต่ำ', width: 11, get: (r) => numOrBlank(r.min_cp) },
      { header: 'Cpk ขั้นต่ำ', width: 11, get: (r) => numOrBlank(r.min_cpk) },
      { header: 'Cp ขั้นต่ำ (SC)', width: 14, get: (r) => numOrBlank(r.min_cp_ctf) },
      { header: 'Cpk ขั้นต่ำ (SC)', width: 14, get: (r) => numOrBlank(r.min_cpk_ctf) },
      { header: 'ชุดกฎ OCS', width: 12, get: (r) => r.ocs_rule_set },
      { header: 'ใช้งาน (Y/N)', width: 12, get: (r) => yn(r.is_active) },
    ],
  },
};

const styleHead = (ws) => {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4FA0' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
};

const listValidation = (ws, colIdx, values) => {
  for (let r = 2; r <= DATA_ROWS; r += 1) {
    ws.getCell(r, colIdx).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${values}"`] };
  }
};

const addTableSheet = (wb, def, rows) => {
  const ws = wb.addWorksheet(def.name);
  ws.columns = def.columns.map((c) => ({ header: c.header, width: c.width }));
  for (const r of rows) ws.addRow(def.columns.map((c) => c.get(r) ?? null));
  styleHead(ws);
  return ws;
};

// items = แถว models (+ division_name, customer_name) · points = จุดตรวจ (+ model_id, settings)
// example = { division } → แม่แบบเปล่า (แถวตัวอย่าง) แทนข้อมูลจริง
const addItemSheets = (wb, { items = [], points = [], categories = [], example = null }) => {
  const catCols = catColumns(categories);

  const wsItems = wb.addWorksheet(ITEM_SHEET);
  wsItems.columns = ITEM_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  const itemRows = example
    ? [
      { division_name: example.division, item_no: 'ITEM-0001', item_name: 'ตัวอย่าง item', is_active: 1 },
      { division_name: example.division, item_no: 'ITEM-0002', item_name: 'ตัวอย่าง item ที่ 2', customer_name: '', is_active: 1 },
    ]
    : items;
  for (const m of itemRows) wsItems.addRow(ITEM_COLUMNS.map((c) => c.get(m) ?? null));
  styleHead(wsItems);
  listValidation(wsItems, ITEM_COLUMNS.length, 'Y,N');

  const wsPoints = wb.addWorksheet(ITEM_POINT_SHEET);
  const cols = [
    { header: 'Division', width: 14 }, { header: 'Item No', width: 24 },
    ...TEMPLATE_COLUMNS, ...catCols,
  ];
  wsPoints.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  if (example) {
    const ex = (i) => [example.division, 'ITEM-0001', ...[...TEMPLATE_COLUMNS, ...catCols].map((c) => c.example[i])];
    wsPoints.addRow(ex(0));
    wsPoints.addRow(ex(1));
  } else {
    const itemById = new Map(items.map((m) => [m.id, m]));
    for (const p of points) {
      const m = itemById.get(p.model_id);
      if (m) wsPoints.addRow([m.division_name, m.item_no, ...pointRow(p, catCols)]);
    }
  }
  styleHead(wsPoints);
  // คอลัมน์ของแม่แบบจุดตรวจเลื่อนไป 2 ช่อง (Division, Item No)
  listValidation(wsPoints, 5, 'วัด,ตา');
  listValidation(wsPoints, 15, 'กะ,วัน');
  listValidation(wsPoints, 16, 'Y,N');
  listValidation(wsPoints, 17, 'Y,N');

  const note = wb.addWorksheet('วิธีกรอก item');
  [
    'ชีต ITEMS: 1 แถว = 1 item · Division = ชื่อ หรือ IPBASS dept (เช่น T47563) · Division + Item No คือตัวจับคู่',
    'item ที่มีอยู่แล้ว = อัปเดตเฉพาะช่องที่กรอก (ช่องว่าง = ไม่แตะค่าเดิม) · item ใหม่ = เพิ่ม · item ที่ไม่อยู่ในไฟล์ = ไม่แตะ',
    'ลูกค้า = ชื่อลูกค้าที่มีในระบบ · พิมพ์ - = ไม่มีลูกค้า · Division / ลูกค้าต้องเพิ่มที่ Master › ข้อมูลพื้นฐาน ก่อน (ระบบไม่สร้างให้)',
    'Cp/Cpk ขั้นต่ำ: เว้นว่าง = ไม่แตะ · พิมพ์ - = ตามลูกค้า',
    '',
    'ชีต ITEM_CHECKPOINTS: 1 แถว = 1 จุดตรวจ ของ item ใน Division + Item No · คอลัมน์ที่เหลือเหมือนแม่แบบจุดตรวจ',
    'จับคู่จุดเดิมด้วยชื่อจุดตรวจ: เปลี่ยนชื่อ = จุดใหม่ · ลบแถว = จุดนั้นไม่ถูกแตะ · ล้างค่าช่องหมวด = เลิกตรวจหมวดนั้น',
    '⚠️ ชีตนี้ต่างจากชีต ITEMS: ช่องว่าง = ล้างค่านั้น (เช่น ลบ USL ทิ้ง) — แก้เฉพาะช่องที่ต้องการ อย่าลบค่าช่องอื่น',
    'สเปก: LSL / Target / USL หรือ ค่ากลาง + พิกัดบน + พิกัดล่าง (ไฟล์ที่โหลดจากระบบเว้นค่ากลาง/พิกัดว่างไว้ — กรอกแล้ว LSL/USL จะถูกคิดใหม่)',
    '',
    'ลากไฟล์มาวางที่การ์ด Item หรือ Excel ▾ › นำเข้า item — ยังไม่บันทึกจนกว่าจะกดบันทึกในกล่องตรวจสอบ',
  ].forEach((t) => note.addRow([t]));
  note.getColumn(1).width = 120;
};

// sheets = ลำดับชีตที่ต้องการ ('divisions' | 'machines' | 'inspectors' | 'customers' | 'models')
// data = { divisions, machines, inspectors, customers, items, points } · categories ใช้กับคอลัมน์หมวดของจุดตรวจ
const buildMasterWorkbook = ({ sheets, data = {}, categories = [] }) => {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    if (s === 'models') addItemSheets(wb, { items: data.items ?? [], points: data.points ?? [], categories });
    else if (BASE_SHEETS[s]) addTableSheet(wb, BASE_SHEETS[s], data[s] ?? []);
  }
  return wb;
};

const buildItemTemplate = ({ categories = [], division = 'Mecha 1' }) => {
  const wb = new ExcelJS.Workbook();
  addItemSheets(wb, { categories, example: { division } });
  return wb;
};

module.exports = { buildMasterWorkbook, buildItemTemplate, ITEM_SHEET, ITEM_POINT_SHEET, BASE_SHEETS };
