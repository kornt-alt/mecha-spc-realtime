// utils/checkpointBulk.js — ตัวช่วยของ "ตารางเพิ่มหลายจุด" ในหน้า Master (pure — ไม่มี React ไม่แตะ DOM)
//
// ทุกทางเข้า (วางจาก Excel · ไฟล์แม่แบบ/ตาราง · ใบ SET UP · คัดลอกจาก item อื่น) แปลงเป็น "แถวร่าง" รูปเดียวกัน
// แล้วไปจบที่ POST /master/models/:id/checkpoints/bulk เส้นเดียว
//
// แถวร่าง (ค่าทุกช่องเป็นสตริงเพื่อให้แก้ในตารางได้):
//   { key, name, characteristic, char_type, unit, gauge, lsl, target, usl, sample_size, frequency,
//     in_routine (bool), is_critical (bool), settings: { '<catId>:<stage>': '<qty>' }, note,
//     provided: [colKey…] }  ← ช่องที่ "มาจากต้นทาง" (วาง/ไฟล์/คนพิมพ์) · 'settings:*' = แทนหมวดทั้งชุด
//
// ⚠️ โหมด "อัปเดตจุดเดิม" (ชื่อตรงจุดที่เปิดอยู่) ทับเฉพาะช่องใน provided — วาง Excel ที่มีแค่ ชื่อ/LSL/USL
//    ต้องไม่ล้างเครื่องมือวัด/หน่วย/หมวดของจุดเดิม (mergeOnto) · ตารางโชว์ค่าที่ merge แล้ว = ค่าที่จะบันทึกจริง
//
// ⚠️ ตัวเลขสเปกที่วางมา **ไม่เดา** — แปลงไม่ได้ (เช่นมี , หลักพัน หรือตัวหนังสือ) = แถวแดง ให้คนแก้เอง
//    สเปกผิดแล้วบันทึกใบตรวจไปแล้ว แก้ย้อนหลังไม่ได้ (judgment ถูก snapshot)
// ⚠️ หัวคอลัมน์ของไฟล์แม่แบบ (backend/services/checkpointImport.js TEMPLATE_COLUMNS) ต้องอยู่ใน alias ข้างล่าง
import { limitsFromTolerance, specIssues } from './checkpointForm';

const STAGE_LABEL = { pd: 'PD', qc: 'QC' };
// ขั้นที่หมวดใช้ตาม flow — ชุดเดียวกับ CategoryMatrix.js / routes/checkJobs.js
const FLOW_STAGES = { pd_qc: ['pd', 'qc'], pd: ['pd'], qc: ['qc'] };

const norm = (s) => String(s ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[\s_]+/g, ' ').trim();

// คอลัมน์ของตาราง (ลำดับ = ลำดับที่วางแบบไม่มีหัวคอลัมน์)
export const BASE_COLUMNS = [
  { key: 'name', label: 'ชื่อจุดตรวจ', width: 150, aliases: ['ชื่อจุดตรวจ', 'ชื่อจุด', 'จุดตรวจ', 'name', 'checkpoint', 'point'] },
  { key: 'characteristic', label: 'Characteristic', width: 100, aliases: ['characteristic', 'ลักษณะ', 'สัญลักษณ์', 'symbol', 'char'] },
  { key: 'char_type', label: 'ชนิด', width: 80, kind: 'type', aliases: ['ชนิด', 'type', 'ประเภท'] },
  { key: 'unit', label: 'หน่วย', width: 60, aliases: ['หน่วย', 'unit'] },
  { key: 'gauge', label: 'เครื่องมือวัด', width: 130, aliases: ['เครื่องมือวัด', 'เครื่องมือ', 'gauge', 'instrument', 'measuring'] },
  { key: 'lsl', label: 'LSL', width: 80, kind: 'num', aliases: ['lsl', 'min', 'ต่ำสุด', 'lower limit'] },
  { key: 'target', label: 'Target', width: 80, kind: 'num', aliases: ['target', 'ค่าเป้า', 'เป้า'] },
  { key: 'usl', label: 'USL', width: 80, kind: 'num', aliases: ['usl', 'max', 'สูงสุด', 'upper limit'] },
  { key: 'sample_size', label: 'ชิ้น/ครั้ง', width: 64, kind: 'qty', aliases: ['ชิ้น/ครั้ง', 'ชิ้น', 'n', 'sample', 'sample size', 'pcs'] },
  { key: 'frequency', label: 'ความถี่', width: 70, kind: 'freq', aliases: ['ความถี่', 'frequency', 'freq'] },
  { key: 'in_routine', label: 'Regular', width: 64, kind: 'bool', aliases: ['regular time', 'regular', 'ตรวจตามรอบ', 'ตามรอบ', 'routine', 'inspection record'] },
  { key: 'is_critical', label: 'SC', width: 44, kind: 'bool', aliases: ['sc point', 'sc', 'critical', 'critical point', 'spc'] },
];
// คอลัมน์ที่อ่านได้ตอนวาง/นำเข้า แต่ไม่มีในตาราง (แปลงเป็น LSL/Target/USL ให้)
const TOL_COLUMNS = [
  { key: 'nominal', aliases: ['ค่ากลาง', 'nominal', 'dimension', 'basic'] },
  { key: 'tol_upper', aliases: ['พิกัดบน', '+tol', 'upper tol', 'tol+', 'upper tolerance'] },
  { key: 'tol_lower', aliases: ['พิกัดล่าง', '-tol', 'lower tol', 'tol-', 'lower tolerance'] },
];

// คอลัมน์จำนวนชิ้นรายหมวด × ขั้น (Set up PD / Set up QC / Last Piece PD …) ตาม check_categories
export const categoryColumns = (categories = []) => categories
  .filter((c) => Number(c.has_workflow) && Number(c.is_active ?? 1))
  .flatMap((c) => (FLOW_STAGES[c.flow] ?? FLOW_STAGES.pd_qc).map((s) => {
    const label = `${c.name} ${STAGE_LABEL[s]}`;
    return { key: `cat:${c.id}:${s}`, settingKey: `${c.id}:${s}`, label, width: 64, kind: 'qty', aliases: [label] };
  }));

export const gridColumns = (categories) => [...BASE_COLUMNS, ...categoryColumns(categories)];

// ── ตาราง clipboard ของ Excel ────────────────────────────────────────────
// แถวคั่น \n · ช่องคั่น \t · ช่องที่มี tab/ขึ้นบรรทัด/" อยู่ข้างใน Excel ห่อด้วย "..." และ "" = " ตัวเดียว
export const parseTsv = (text) => {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // Excel ใส่ \n ท้ายสุดเสมอ → แถวว่างท้าย
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows.map((r) => r.map((c) => c.trim()));
};

// แถวแรกเป็นหัวคอลัมน์ไหม → คืน array ของ key ต่อคอลัมน์ (ไม่รู้จัก = null) หรือ null ถ้าไม่ใช่หัว
export const detectHeader = (firstRow, columns) => {
  const all = [...columns, ...TOL_COLUMNS];
  const lookup = new Map();
  for (const col of all) for (const a of col.aliases) lookup.set(norm(a), col.key);
  const keys = firstRow.map((c) => lookup.get(norm(c)) ?? null);
  const hits = keys.filter(Boolean).length;
  // ต้องรู้จักอย่างน้อย 2 ช่อง (กันชื่อจุดชื่อ "Max" แถวเดียวถูกนับเป็นหัว)
  return hits >= 2 ? keys : null;
};

// ── แปลงค่าแต่ละชนิด ───────────────────────────────────────────────────────
const TRUE_WORDS = new Set(['y', 'yes', '1', 'true', '✓', '✔', 'x', 'ใช่', 'มี', 'spc', '★', 'sc', 'o']);
const ATTR_WORDS = new Set(['ตา', 'attribute', 'attr', 'visual', 'ตรวจด้วยตา', 'ok/ng', 'go/no go', 'gauge']);
const VAR_WORDS = new Set(['', 'วัด', 'variable', 'var', 'วัดค่า', 'measure']);

const toBool = (v) => TRUE_WORDS.has(norm(v));
const toType = (v) => {
  const n = norm(v);
  if (ATTR_WORDS.has(n)) return 'attribute';
  if (VAR_WORDS.has(n)) return 'variable';
  return String(v).trim(); // ไม่รู้จัก — ทิ้งไว้ให้ validateDraft ฟ้อง
};
const toFreq = (v) => (/day|วัน/i.test(String(v)) ? 'day' : 'shift');
const toQty = (v) => String(v ?? '').match(/\d+/)?.[0] ?? (String(v ?? '').trim() ? String(v).trim() : '');
// ตัวเลขสเปก: ตัดช่องว่าง · − (U+2212) → - · ที่เหลือคงไว้ตามที่พิมพ์ (ไม่เดา , หลักพัน)
const toNumText = (v) => String(v ?? '').replace(/\s+/g, '').replace(/−/g, '-');

let seq = 0;
const newKey = () => { seq += 1; return `d${Date.now().toString(36)}${seq}`; };

export const blankDraft = (defaults = {}) => ({
  key: newKey(),
  name: '', characteristic: '', char_type: 'variable', unit: defaults.unit ?? '', gauge: defaults.gauge ?? '',
  lsl: '', target: '', usl: '', sample_size: String(defaults.sample_size ?? 1), frequency: 'shift',
  in_routine: true, is_critical: false, settings: {}, note: '', provided: [],
});

const markProvided = (draft, ...keys) => {
  const set = new Set(draft.provided ?? []);
  keys.forEach((k) => set.add(k));
  return { ...draft, provided: [...set] };
};

export const isBlankDraft = (d) => !String(d.name ?? '').trim()
  && !['characteristic', 'gauge', 'lsl', 'target', 'usl'].some((k) => String(d[k] ?? '').trim())
  && Object.keys(d.settings ?? {}).length === 0;

// ใส่ค่าช่องเดียว (key ของคอลัมน์ตาราง) ลงแถวร่าง ตามชนิดคอลัมน์
export const setCell = (draft, colKey, raw) => {
  const v = raw ?? '';
  if (colKey.startsWith('cat:')) {
    const settingKey = colKey.slice(4);
    const qty = toQty(v);
    const settings = { ...draft.settings };
    if (qty === '' || qty === '0') delete settings[settingKey]; else settings[settingKey] = qty;
    return markProvided({ ...draft, settings }, colKey);
  }
  const col = BASE_COLUMNS.find((c) => c.key === colKey);
  if (!col) return draft;
  return markProvided(setBase(draft, col, colKey, v), colKey);
};

const setBase = (draft, col, colKey, v) => {
  switch (col.kind) {
    case 'bool': return { ...draft, [colKey]: typeof v === 'boolean' ? v : toBool(v) };
    case 'type': return { ...draft, char_type: toType(v) };
    case 'freq': return { ...draft, frequency: toFreq(v) };
    case 'qty': return { ...draft, [colKey]: toQty(v) };
    case 'num': return { ...draft, [colKey]: toNumText(v) };
    default: return { ...draft, [colKey]: String(v).trim() };
  }
};

// แถวที่รู้หัวคอลัมน์ → แถวร่าง · มีค่ากลาง+พิกัดแต่ไม่มี LSL/USL → แปลงด้วย limitsFromTolerance (กฎเครื่องหมายเดียวกับฟอร์ม)
const rowToDraft = (cells, keys, defaults) => {
  let d = blankDraft(defaults);
  const tol = {};
  let sawRoutine = false;
  cells.forEach((cell, i) => {
    const key = keys[i];
    if (!key) return;
    if (key === 'nominal' || key === 'tol_upper' || key === 'tol_lower') { tol[key] = cell; return; }
    if (key === 'in_routine') sawRoutine = true;
    d = setCell(d, key, cell);
  });
  // ช่อง "ตามรอบ" ว่าง = ไม่ระบุ → ค่าเริ่มของคอลัมน์ (อยู่ในใบตรวจตามรอบ)
  if (sawRoutine && String(cells[keys.indexOf('in_routine')] ?? '').trim() === '') d.in_routine = true;
  const nominal = toNumText(tol.nominal);
  if (nominal !== '' && !d.lsl && !d.usl) {
    const lim = limitsFromTolerance({ nominal, tolUpper: toNumText(tol.tol_upper), tolLower: toNumText(tol.tol_lower) });
    if (lim.target === '') d.note = `ค่ากลาง "${tol.nominal}" ไม่ใช่ตัวเลข`;
    d = markProvided({ ...d, lsl: lim.lsl, usl: lim.usl, target: d.target || lim.target }, 'lsl', 'usl', 'target');
  } else if (nominal !== '' && !d.target) {
    d = markProvided({ ...d, target: nominal }, 'target');
  }
  if (d.char_type === 'attribute') d = { ...d, sample_size: '1' };
  return d;
};

// ตารางข้อความ (จากไฟล์หรือ clipboard ที่มีหัวคอลัมน์) → { drafts, unknownHeaders } · ไม่มีหัว = null
export const tableToDrafts = (rows, columns, defaults) => {
  if (!rows.length) return null;
  const keys = detectHeader(rows[0], columns);
  if (!keys) return null;
  const drafts = rows.slice(1)
    .map((r) => rowToDraft(r, keys, defaults))
    .filter((d) => !isBlankDraft(d));
  const unknownHeaders = rows[0].filter((h, i) => h && !keys[i]);
  return { drafts, unknownHeaders };
};

// วางลงตาราง: มีหัวคอลัมน์ = แมปตามหัวแล้วต่อท้าย (แทนแถวว่าง) · ไม่มีหัว = เติมจากช่องที่วางไปขวา/ลง เพิ่มแถวเมื่อเกิน
export const pasteIntoDrafts = (drafts, text, { rowIndex = 0, colKey = 'name', columns, defaults } = {}) => {
  const rows = parseTsv(text);
  if (!rows.length) return { drafts, added: 0, mode: 'none' };
  const viaHeader = tableToDrafts(rows, columns, defaults);
  if (viaHeader) {
    const kept = drafts.filter((d) => !isBlankDraft(d));
    return { drafts: [...kept, ...viaHeader.drafts], added: viaHeader.drafts.length, mode: 'header', unknownHeaders: viaHeader.unknownHeaders };
  }
  const startCol = Math.max(0, columns.findIndex((c) => c.key === colKey));
  const next = [...drafts];
  rows.forEach((cells, r) => {
    const at = rowIndex + r;
    while (next.length <= at) next.push(blankDraft(defaults));
    let d = next[at];
    cells.forEach((cell, c) => {
      const col = columns[startCol + c];
      if (col) d = setCell(d, col.key, cell);
    });
    if (d.char_type === 'attribute') d = { ...d, sample_size: '1' };
    next[at] = d;
  });
  return { drafts: next, added: rows.length, mode: 'cells' };
};

// ใบ SET UP ที่ backend อ่านมา (ค่าตัวเลขจริง + settings array) → แถวร่าง
const str = (v) => (v === null || v === undefined ? '' : String(v));
const BASE_KEYS = BASE_COLUMNS.map((c) => c.key);
export const draftFromParsed = (p, errors = []) => ({
  ...blankDraft(),
  // ช่องที่ต้นทางมี (null = ต้นทางมีช่องนี้แต่ว่าง → นับว่าส่งมา) · หมวด = เฉพาะคีย์ที่มีค่า
  provided: [
    ...BASE_KEYS.filter((k) => p[k] !== undefined),
    ...(p.settings ?? []).map((s) => `cat:${s.category_id}:${s.stage}`),
  ],
  name: str(p.name),
  characteristic: str(p.characteristic),
  char_type: p.char_type === 'attribute' ? 'attribute' : 'variable',
  unit: str(p.unit),
  gauge: str(p.gauge),
  lsl: str(p.lsl),
  target: str(p.target),
  usl: str(p.usl),
  sample_size: str(p.sample_size),
  frequency: p.frequency === 'day' ? 'day' : 'shift',
  in_routine: p.in_routine === undefined || p.in_routine === null ? true : Boolean(Number(p.in_routine)),
  is_critical: Boolean(Number(p.is_critical)),
  settings: Object.fromEntries((p.settings ?? []).map((s) => [`${s.category_id}:${s.stage}`, String(s.sample_qty)])),
  note: errors.map((e) => e.message).join(' · '),
});

// จุดตรวจที่มีอยู่แล้ว (คัดลอกจาก item อื่น / ทำซ้ำ) → แถวร่าง · baseline ไม่ติดมา (เป็นของจุดเดิม)
// category_settings (รูปของ /master/models/:id) → settings · หมวดแทนทั้งชุด (ของต้นทางคือของจริงทั้งชุด)
export const draftFromCheckpoint = (cp) => {
  const d = draftFromParsed({ ...cp, settings: cp.settings ?? cp.category_settings ?? [] });
  return { ...d, provided: [...BASE_KEYS, 'settings:*'] };
};

// ── อัปเดตจุดเดิม (จับคู่ด้วยชื่อ) ──────────────────────────────────────────
export const nameKey = (n) => String(n ?? '').trim().toLowerCase();

// แถวร่าง d ทับจุดเดิม base (แถวร่างของจุดเดิม) เฉพาะช่องที่ d ส่งมา → ค่าที่จะบันทึกจริง
export const mergeOnto = (base, d) => {
  const provided = new Set(d.provided ?? []);
  const out = { ...base, key: d.key, note: d.note, provided: d.provided ?? [] };
  for (const k of BASE_KEYS) if (provided.has(k)) out[k] = d[k];
  out.name = d.name; // ชื่อ = ตัวจับคู่ (ตัวพิมพ์ตามที่วางมา)
  if (provided.has('settings:*')) out.settings = { ...d.settings };
  else {
    const settings = { ...base.settings };
    for (const k of provided) {
      if (!k.startsWith('cat:')) continue;
      const sk = k.slice(4);
      if (d.settings?.[sk] === undefined) delete settings[sk]; else settings[sk] = d.settings[sk];
    }
    out.settings = settings;
  }
  if (out.char_type === 'attribute') out.sample_size = '1';
  return out;
};

const FIELD_LABEL = {
  name: 'ชื่อ', characteristic: 'Characteristic', char_type: 'ชนิด', unit: 'หน่วย', gauge: 'เครื่องมือวัด',
  lsl: 'LSL', target: 'Target', usl: 'USL', sample_size: 'ชิ้น/ครั้ง', frequency: 'ความถี่',
  in_routine: 'Regular time', is_critical: 'SC point',
};
const showVal = (k, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'char_type') return v === 'attribute' ? 'ตา' : 'วัด';
  if (k === 'frequency') return v === 'day' ? 'วัน' : 'กะ';
  if (k === 'in_routine' || k === 'is_critical') return v ? '✓' : '✗';
  return String(v);
};
const sameVal = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return a === b;
};

// เทียบจุดเดิมกับค่าที่จะบันทึก → [{ key, label, from, to }] (เทียบบน payload — ตัวเลขเทียบเป็น Number)
export const diffDraft = (base, merged, catLabels = {}) => {
  const a = draftToPayload(base);
  const b = draftToPayload(merged);
  const out = [];
  for (const k of Object.keys(FIELD_LABEL)) {
    if (!sameVal(a[k], b[k])) out.push({ key: k, label: FIELD_LABEL[k], from: showVal(k, a[k]), to: showVal(k, b[k]) });
  }
  const sa = base.settings ?? {};
  const sb = merged.settings ?? {};
  for (const sk of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (String(sa[sk] ?? '') !== String(sb[sk] ?? '')) {
      out.push({ key: `cat:${sk}`, label: catLabels[sk] ?? sk, from: sa[sk] ?? '—', to: sb[sk] ?? '—' });
    }
  }
  return out;
};

// ── ตรวจก่อนบันทึก ──────────────────────────────────────────────────────────
const isNumText = (v) => v === '' || (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(v) && Number.isFinite(Number(v)));
const isQty = (v) => /^\d+$/.test(String(v)) && Number(v) >= 1 && Number(v) <= 10;

// คืน { errors: [..], warnings: [..] } ของแถวเดียว · takenNames = ชื่อที่ใช้แล้ว (จุดที่เปิดอยู่ + แถวอื่นในตาราง) ตัวพิมพ์เล็ก
export const validateDraft = (d, { takenNames } = {}) => {
  const errors = [];
  const name = String(d.name ?? '').trim();
  if (!name) errors.push('ต้องมีชื่อจุดตรวจ');
  else if (name.length > 150) errors.push('ชื่อยาวเกิน 150 ตัว');
  else if (takenNames?.has(name.toLowerCase())) errors.push('ชื่อซ้ำ');
  if (d.char_type !== 'variable' && d.char_type !== 'attribute') errors.push(`ชนิด "${d.char_type}" ไม่รู้จัก (ใช้ วัด / ตา)`);
  const isAttr = d.char_type === 'attribute';
  if (!isAttr) {
    for (const k of ['lsl', 'target', 'usl']) {
      if (!isNumText(String(d[k] ?? ''))) errors.push(`${k.toUpperCase()} "${d[k]}" ไม่ใช่ตัวเลข`);
    }
    if (!isQty(d.sample_size)) errors.push('ชิ้น/ครั้ง ต้องเป็น 1-10');
  }
  for (const [k, q] of Object.entries(d.settings ?? {})) {
    if (!isQty(q)) errors.push(`จำนวนชิ้นของหมวด (${k}) ต้องเป็น 1-10`);
    else if (isAttr && Number(q) > 1) errors.push('จุดตรวจด้วยตาตรวจได้ 1 ชิ้น');
  }
  const issues = specIssues(d);
  if (issues.blocking) errors.push(issues.blocking);
  if (d.note) errors.push(d.note);
  return { errors, warnings: issues.warnings };
};

// mode: 'upsert' (ค่าเริ่ม — ชื่อตรงจุดที่เปิดอยู่ = อัปเดตจุดนั้น) · 'add' (ชื่อซ้ำจุดเดิม = แดง) · 'replace' (ปิดจุดเดิมทั้งหมด)
// existing = จุดที่เปิดใช้งานของ item (object จาก /master/models/:id) · ซ้ำแถวอื่นในตาราง = แดงทุกโหมด
// คืนต่อแถว: { errors, warnings, match (จุดเดิม|null), view (ค่าที่จะบันทึก/แสดง), changes ([] = ไม่เปลี่ยน · null = แถวเพิ่มใหม่) }
export const validateAll = (drafts, { existing = [], mode = 'upsert', catLabels = {} } = {}) => {
  const counts = new Map();
  for (const d of drafts) {
    const n = nameKey(d.name);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const byName = new Map(mode === 'replace' ? [] : existing.map((c) => [nameKey(c.name), c]));
  return drafts.map((d) => {
    const n = nameKey(d.name);
    const taken = new Set();
    if (n && counts.get(n) > 1) taken.add(n);
    const match = n ? byName.get(n) ?? null : null;
    if (match && mode === 'add') taken.add(n);
    if (!match || mode !== 'upsert') return { ...validateDraft(d, { takenNames: taken }), match: null, view: d, changes: null };
    const base = draftFromCheckpoint(match);
    const view = mergeOnto(base, d);
    const r = validateDraft(view, { takenNames: taken });
    const changes = diffDraft(base, view, catLabels);
    const warnings = [...r.warnings];
    if (changes.some((c) => c.key === 'sample_size')) warnings.push('เปลี่ยนชิ้น/ครั้ง — baseline เดิมของจุดนี้อาจใช้ไม่ได้');
    if (changes.some((c) => c.key === 'char_type')) warnings.push('เปลี่ยนชนิด วัด↔ตา — ผลตรวจเก่าของจุดนี้เป็นอีกชนิด');
    return { errors: r.errors, warnings, match, view, changes };
  });
};

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// แถวร่าง → body ของ POST /checkpoints/bulk (กฎเดียวกับ submitCp: attribute → สเปก/หน่วย null, n = 1)
export const draftToPayload = (d) => {
  const isAttr = d.char_type === 'attribute';
  return {
    name: String(d.name).trim(),
    characteristic: String(d.characteristic ?? '').trim() || null,
    char_type: isAttr ? 'attribute' : 'variable',
    unit: isAttr ? null : (String(d.unit ?? '').trim() || null),
    gauge: String(d.gauge ?? '').trim() || null,
    lsl: isAttr ? null : numOrNull(d.lsl),
    target: isAttr ? null : numOrNull(d.target),
    usl: isAttr ? null : numOrNull(d.usl),
    sample_size: isAttr ? 1 : Number(d.sample_size),
    frequency: d.frequency === 'day' ? 'day' : 'shift',
    in_routine: d.in_routine ? 1 : 0,
    is_critical: d.is_critical ? 1 : 0,
    settings: Object.entries(d.settings ?? {}).map(([k, q]) => {
      const [categoryId, stage] = k.split(':');
      return { category_id: Number(categoryId), stage, sample_qty: Number(q) };
    }),
  };
};
