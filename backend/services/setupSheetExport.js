// services/setupSheetExport.js — จุดตรวจของ item → ใบ "SET UP & LAST PIECE INSPECTION RECORD" (pure — ไม่แตะ DB)
//
// ใช้ที่ GET /master/models/:id/setup-sheet · หน้าตาตามใบจริงที่ QC ใช้ (ไฟล์ที่ Korn นำเข้า)
// ⚠️ ตำแหน่งเซลล์ต้องตรงกับตัวอ่าน parseSetupSheet() ใน checkpointImport.js — ลากไฟล์นี้กลับมาที่การ์ดจุดตรวจได้
//    H8 = Item No · จุดเริ่มแถว 16 ทีละ 2 แถว · A = No · C = "spc" · D = สัญลักษณ์ · F = ค่ากลาง
//    I/J = เครื่องหมาย/พิกัด (แถวบน = บน · แถวล่าง = ล่าง) · K = Max/Min (สูตร F±J พร้อมผลที่คำนวณไว้) · L = เครื่องมือวัด · P = "N pcs."
// ⚠️ ชื่อจุดแยกเป็น No + สัญลักษณ์ ("8.1 Ø" → A = 8.1 · D = Ø) — ชื่อที่ไม่ขึ้นต้นด้วยเลข A = ลำดับ · D = ชื่อทั้งหมด
//    (นำเข้ากลับแล้วชื่อจะเป็น "<ลำดับ> <คำแรก>" ไม่ตรงชื่อเดิม = กลายเป็นจุดใหม่ — บอกไว้ในหัวใบ)
// ⚠️ จุดที่ไม่มีค่ากลาง/พิกัดใน DB (ตั้งด้วย LSL/USL): ค่ากลาง = Target · พิกัด = USL−Target / Target−LSL · ไม่มี Target = Max/Min อย่างเดียว
'use strict';

const ExcelJS = require('exceljs');

const FIRST_ROW = 16;
const TITLE = 'SET  UP & LAST  PIECE    INSPECTION  RECORD';
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const thin = { style: 'thin' };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const BLUE = 'FF1B4FA0';

// "8.1 Ø" → { no: '8.1', sym: 'Ø' } · "22" → { no: '22', sym: '' } · ไม่ขึ้นต้นด้วยเลข → null
const splitName = (name) => {
  const m = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(String(name ?? '').trim());
  return m ? { no: m[1], sym: m[2] } : null;
};

// เครื่องหมาย + ขนาดพิกัดจากค่ากลาง (บน: + ถ้าลิมิตอยู่เหนือค่ากลาง · ล่าง: − ถ้าอยู่ใต้)
const tolOf = (limit, nominal) => {
  if (limit === null || nominal === null) return { sign: null, tol: null };
  const d = round6(limit - nominal);
  return { sign: d > 0 ? '+' : d < 0 ? '-' : '', tol: Math.abs(d) };
};

// model = { item_no, item_name, drawing_no, drawing_rev, division_name } · points = [{ …checkpoint, qty, qcQty }]
// ชื่อชีตของ Excel: ≤ 31 ตัว ห้าม [ ] : * ? / \\ และห้ามซ้ำ (ไม่สนตัวพิมพ์)
const sheetNameOf = (wb, raw) => {
  const base = String(raw || 'item').replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'item';
  let name = base;
  for (let i = 2; wb.worksheets.some((w) => w.name.toLowerCase() === name.toLowerCase()); i += 1) {
    const tail = ` (${i})`;
    name = base.slice(0, 31 - tail.length) + tail;
  }
  return name;
};

// หลาย item ในไฟล์เดียว — ชีตละ item (ชื่อชีต = Item No) · list = [{ model, points }]
// ⚠️ ตัวอ่านใบ SET UP อ่านเฉพาะชีตแรก — ไฟล์หลายชีตไว้พิมพ์/ดู นำเข้ากลับทีละ item
const buildSetupWorkbook = (list) => {
  const wb = new ExcelJS.Workbook();
  for (const { model, points } of list) addSetupSheet(wb, model, points, sheetNameOf(wb, model.item_no));
  return wb;
};

const buildSetupSheet = (model, points) => {
  const wb = new ExcelJS.Workbook();
  addSetupSheet(wb, model, points, 'SET UP');
  return wb;
};

const addSetupSheet = (wb, model, points, sheetName) => {
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '10:15' },
  });
  ws.columns = [
    { width: 6 }, { width: 3 }, { width: 8 }, { width: 10 }, { width: 2 }, { width: 10 }, { width: 2 },
    { width: 4 }, { width: 3 }, { width: 8 }, { width: 10 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 6 },
    ...Array(10).fill({ width: 6 }),
  ];
  const put = (addr, value, style = {}) => { const c = ws.getCell(addr); c.value = value; Object.assign(c, style); return c; };
  const merge = (range, value, style) => { ws.mergeCells(range); return put(range.split(':')[0], value, style); };
  const center = { alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } };
  const left = { alignment: { horizontal: 'left', vertical: 'middle' } };

  // ── หัวใบ ──
  merge('A2:G3', 'Automotive Part', { ...center, font: { bold: true, size: 12 } });
  merge('H2:Y3', TITLE, { ...center, font: { bold: true, size: 16, color: { argb: BLUE } } });
  merge('A4:F5', 'Part Name     :', left); merge('H4:N5', model.item_name ?? '', { ...left, font: { bold: true } });
  merge('P4:S5', 'Process     :', left); merge('T4:Y5', '', left);
  merge('A6:F7', 'Drawing  No  :', left); merge('H6:M7', model.drawing_no ?? '', { ...left, font: { bold: true } });
  merge('N6:N7', 'Rev :', left); merge('O6:O7', model.drawing_rev ?? '', { ...center, font: { bold: true } });
  merge('P6:S7', 'Date          :', left); merge('T6:Y7', '', left);
  merge('A8:F9', 'Item No / code :', left); merge('H8:O9', String(model.item_no ?? ''), { ...left, font: { bold: true } });
  merge('P8:S9', 'Material    :', left); merge('T8:Y9', '', left);
  ['G4', 'G6', 'G8'].forEach((a) => put(a, ':', center));

  // ── หัวตาราง (แถว 10–15) ──
  const head = { ...center, font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } } };
  merge('A10:B11', 'No', head); merge('A12:B15', 'Check Point', head);
  merge('C10:C15', 'Critical Point', head);
  merge('D10:J15', 'Specification', head);
  merge('K10:K12', 'Max', head); merge('K13:K15', 'Min', head);
  merge('L10:O15', 'Instrument', head);
  merge('P10:T12', 'Production Check', head);
  merge('U10:Y12', 'QC Confirm', head);
  for (let i = 0; i < 5; i += 1) {
    merge(`${String.fromCharCode(80 + i)}13:${String.fromCharCode(80 + i)}15`, i + 1, head);
    merge(`${String.fromCharCode(85 + i)}13:${String.fromCharCode(85 + i)}15`, i + 1, head);
  }

  // ── จุดตรวจ ทีละ 2 แถว ──
  let seq = 0;
  points.forEach((p, i) => {
    const r = FIRST_ROW + i * 2;
    const isAttr = p.char_type === 'attribute';
    const parts = splitName(p.name);
    seq = parts ? Math.max(seq, Math.floor(Number(parts.no))) : seq + 1;
    const no = parts ? parts.no : String(seq);
    const label = parts ? parts.sym : p.name;

    ws.mergeCells(`A${r}:B${r + 1}`); put(`A${r}`, no, center);
    ws.mergeCells(`C${r}:C${r + 1}`); put(`C${r}`, Number(p.is_critical) ? 'spc' : null, { ...center, font: { bold: true, color: { argb: 'FFC42032' } } });
    ws.mergeCells(`D${r}:E${r + 1}`); put(`D${r}`, isAttr ? label : (label || p.characteristic || null), center);
    ws.mergeCells(`L${r}:O${r + 1}`); put(`L${r}`, p.gauge ?? null, center);
    const qty = isAttr ? 1 : (p.qty ?? Number(p.sample_size));
    ws.mergeCells(`P${r}:T${r}`); put(`P${r}`, `${qty} pcs.`, center);
    ws.mergeCells(`U${r}:Y${r}`); put(`U${r}`, `${isAttr ? 1 : (p.qcQty ?? qty)} pcs.`, center);

    if (isAttr) {
      // ⚠️ F ต้องว่าง — ตัวอ่านใช้ข้อความใน F เป็นชื่อจุดตรวจด้วยตา (ไม่มีจึงใช้ D)
      ws.mergeCells(`F${r}:J${r + 1}`);
      ws.mergeCells(`K${r}:K${r + 1}`);
    } else {
      const usl = num(p.usl); const lsl = num(p.lsl); const target = num(p.target);
      ws.mergeCells(`F${r}:G${r + 1}`); put(`F${r}`, target, center);
      ws.mergeCells(`H${r}:H${r + 1}`); put(`H${r}`, p.unit && p.unit !== 'mm' ? p.unit : null, center);
      const up = tolOf(usl, target);
      const lo = tolOf(lsl, target);
      put(`I${r}`, up.sign, center); put(`J${r}`, up.tol, center);
      put(`I${r + 1}`, lo.sign, center); put(`J${r + 1}`, lo.tol, center);
      // Max/Min = สูตรแบบใบจริง (มีค่ากลาง) พร้อมผลที่คำนวณไว้ — ตัวอ่านใช้ผล · ไม่มีค่ากลาง = เลขตรง ๆ
      const limitCell = (row, limit, t) => {
        if (limit === null) return put(`K${row}`, null, center);
        if (target === null || t.tol === null) return put(`K${row}`, limit, center);
        const f = t.sign === '+' ? `F${r}+J${row}` : t.sign === '-' ? `F${r}-J${row}` : `F${r}`;
        return put(`K${row}`, { formula: f, result: limit }, center);
      };
      limitCell(r, usl, up);
      limitCell(r + 1, lsl, lo);
    }
    for (let rr = r; rr <= r + 1; rr += 1) {
      for (let c = 1; c <= 25; c += 1) ws.getCell(rr, c).border = box;
    }
  });

  const end = FIRST_ROW + points.length * 2;
  ws.mergeCells(`A${end + 1}:Y${end + 1}`);
  put(`A${end + 1}`, 'ส่งออกจากระบบ QC Inspection — แก้แล้วลากไฟล์กลับมาที่การ์ดจุดตรวจได้ (จับคู่จุดเดิมด้วย No + สัญลักษณ์ เช่น "8.1 Ø")', { font: { italic: true, size: 9, color: { argb: 'FF5B6B82' } } });
  ws.views = [{ state: 'frozen', ySplit: 15 }];
  return wb;
};

module.exports = { buildSetupSheet, buildSetupWorkbook, splitName };
