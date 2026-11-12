// utils/itemBulk.js — นำเข้า item หลายตัว (+ จุดตรวจ) จากไฟล์ Excel (pure — ไม่มี React ไม่แตะ DOM)
//
// ไฟล์มาจาก backend/services/masterExport.js: ชีต ITEMS + ITEM_CHECKPOINTS · backend อ่านเป็นตารางข้อความ
// (POST /master/items/import/parse) แล้วที่นี่แมปหัว/ตรวจ/merge → POST /master/items/bulk (server รับค่าเต็มที่ merge แล้ว)
//
// ⚠️ หัวคอลัมน์ของ ITEMS ใน masterExport.js ต้องอยู่ใน alias ของ ITEM_COLUMNS
// ⚠️ ช่องว่าง = ไม่แตะค่าเดิม (provided หลักเดียวกับ checkpointBulk.js) · พิมพ์ "-" = ล้างค่า (ลูกค้า → ไม่มีลูกค้า · Cp/Cpk → ตามลูกค้า)
// ⚠️ จับคู่ item ด้วย Division + Item No เสมอ — Division ว่างใช้ได้เฉพาะ Item No ที่มีตัวเดียวทั้งในไฟล์และในระบบ
//    (item เลขเดียวกันมีได้ทั้ง Mecha 1 และ Mecha 2 — กฎเดียวกับ resolveMoItem)
// ⚠️ ไม่สร้าง Division / ลูกค้าให้เอง — ชื่อไม่ตรง = แถวแดง
// จุดตรวจ: ใช้ tableToDrafts + validateAll ของ checkpointBulk.js ตัวเดิม (upsert ตามชื่อ)
import { gridColumns, tableToDrafts, validateAll, draftToPayload } from './checkpointBulk';

const normH = (s) => String(s ?? '').toLowerCase().replace(/[()]/g, ' ').replace(/[\s_]+/g, ' ').trim();
const keyOf = (divisionId, itemNo) => `${divisionId}|${String(itemNo ?? '').trim().toLowerCase()}`;

export const ITEM_COLUMNS = [
  { key: 'division', label: 'Division', aliases: ['division', 'ดิวิชั่น', 'แผนก', 'dept', 'ipbass dept'] },
  { key: 'item_no', label: 'Item No', aliases: ['item no', 'item_no', 'item', 'itemno', 'เลข item', 'item number'] },
  { key: 'item_name', label: 'ชื่อ item', aliases: ['ชื่อ item', 'item name', 'ชื่อ', 'name', 'ชื่อชิ้นงาน'] },
  { key: 'drawing_no', label: 'Drawing No', aliases: ['drawing no', 'drawing', 'dwg no', 'dwg'] },
  { key: 'drawing_rev', label: 'Drawing Rev', aliases: ['drawing rev', 'rev', 'dwg rev', 'revision'] },
  { key: 'customer', label: 'ลูกค้า', aliases: ['ลูกค้า', 'customer'] },
  { key: 'min_cp', label: 'Cp ขั้นต่ำ', aliases: ['cp ขั้นต่ำ', 'min cp', 'min_cp'] },
  { key: 'min_cpk', label: 'Cpk ขั้นต่ำ', aliases: ['cpk ขั้นต่ำ', 'min cpk', 'min_cpk'] },
  { key: 'min_cp_ctf', label: 'Cp ขั้นต่ำ (SC)', aliases: ['cp ขั้นต่ำ sc', 'min cp sc', 'min_cp_ctf', 'cp ขั้นต่ำ ctf'] },
  { key: 'min_cpk_ctf', label: 'Cpk ขั้นต่ำ (SC)', aliases: ['cpk ขั้นต่ำ sc', 'min cpk sc', 'min_cpk_ctf', 'cpk ขั้นต่ำ ctf'] },
  { key: 'is_active', label: 'ใช้งาน', aliases: ['ใช้งาน', 'ใช้งาน y/n', 'active', 'is_active', 'is active'] },
];
const MIN_KEYS = ['min_cp', 'min_cpk', 'min_cp_ctf', 'min_cpk_ctf'];
const TEXT_KEYS = ['item_name', 'drawing_no', 'drawing_rev'];
const FIELD_LABEL = {
  item_name: 'ชื่อ', drawing_no: 'Drawing No', drawing_rev: 'Drawing Rev', customer_id: 'ลูกค้า',
  min_cp: 'Cp ขั้นต่ำ', min_cpk: 'Cpk ขั้นต่ำ', min_cp_ctf: 'Cp ขั้นต่ำ (SC)', min_cpk_ctf: 'Cpk ขั้นต่ำ (SC)', is_active: 'ใช้งาน',
};
const WRITE_KEYS = Object.keys(FIELD_LABEL);

const detectItemHeader = (row) => {
  const lookup = new Map();
  for (const c of ITEM_COLUMNS) for (const a of c.aliases) lookup.set(normH(a), c.key);
  const keys = (row ?? []).map((h) => lookup.get(normH(h)) ?? null);
  return keys.includes('item_no') ? keys : null;
};

const isClear = (v) => v === '-' || v === '—';
const YES = new Set(['y', 'yes', '1', 'true', '✓', 'ใช่', 'เปิด']);
const NO = new Set(['n', 'no', '0', 'false', '✗', 'ไม่', 'ปิด']);

// Division จากชื่อ หรือ ipbass_dept (ไม่สนตัวพิมพ์/ช่องว่าง)
export const resolveDivision = (text, divisions = []) => {
  const t = normH(text);
  if (!t) return null;
  return divisions.find((d) => normH(d.name) === t || normH(d.ipbass_dept) === t) ?? null;
};
const resolveCustomer = (text, customers = []) => customers.find((c) => normH(c.name) === normH(text)) ?? null;

// แถวข้อความของ ITEMS → { division (obj|null), divisionText, item_no, fields, provided, errors }
const rowToItem = (cells, keys, { divisions, customers }) => {
  const out = { divisionText: '', division: null, item_no: '', fields: {}, provided: [], errors: [] };
  keys.forEach((k, i) => {
    if (!k) return;
    const v = String(cells[i] ?? '').trim();
    if (k === 'division') { out.divisionText = v; out.division = resolveDivision(v, divisions); if (v && !out.division) out.errors.push(`ไม่พบ Division "${v}"`); return; }
    if (k === 'item_no') { out.item_no = v; return; }
    if (v === '') return; // ว่าง = ไม่แตะ
    if (TEXT_KEYS.includes(k)) {
      if (isClear(v)) {
        if (k === 'item_name') out.errors.push('ชื่อ item ล้างไม่ได้');
        else { out.fields[k] = null; out.provided.push(k); }
      } else { out.fields[k] = v; out.provided.push(k); }
      return;
    }
    if (k === 'customer') {
      if (isClear(v)) { out.fields.customer_id = null; out.provided.push('customer_id'); return; }
      const c = resolveCustomer(v, customers);
      if (!c) out.errors.push(`ไม่พบลูกค้า "${v}" — เพิ่มที่ข้อมูลพื้นฐานก่อน หรือพิมพ์ - = ไม่มีลูกค้า`);
      else { out.fields.customer_id = c.id; out.provided.push('customer_id'); }
      return;
    }
    if (MIN_KEYS.includes(k)) {
      if (isClear(v)) { out.fields[k] = null; out.provided.push(k); return; }
      const n = /^\d*\.?\d+$/.test(v) ? Number(v) : NaN;
      if (!Number.isFinite(n) || n <= 0 || n >= 100) out.errors.push(`${ITEM_COLUMNS.find((c) => c.key === k).label} "${v}" ต้องเป็นตัวเลขมากกว่า 0 และน้อยกว่า 100`);
      else { out.fields[k] = n; out.provided.push(k); }
      return;
    }
    if (k === 'is_active') {
      const n = normH(v);
      if (YES.has(n)) out.fields.is_active = 1;
      else if (NO.has(n)) out.fields.is_active = 0;
      else { out.errors.push(`ใช้งาน "${v}" ต้องเป็น Y หรือ N`); return; }
      out.provided.push('is_active');
    }
  });
  if (!out.item_no) out.errors.push('ไม่มี Item No');
  else if (out.item_no.length > 50) out.errors.push('Item No ยาวเกิน 50 ตัว');
  if ((out.fields.item_name ?? '').length > 150) out.errors.push('ชื่อ item ยาวเกิน 150 ตัว');
  return out;
};

// Division ว่าง → หาจาก Item No ที่มีตัวเดียว (ในไฟล์ที่ระบุ division แล้ว + ในระบบ) · กำกวม/ไม่เจอ = null
const guessDivision = (itemNo, { fileKeys, models }) => {
  const k = String(itemNo).trim().toLowerCase();
  const ids = new Set([
    ...fileKeys.filter((x) => x.item_no === k).map((x) => x.division_id),
    ...models.filter((m) => String(m.item_no).trim().toLowerCase() === k).map((m) => m.division_id),
  ]);
  return ids.size === 1 ? [...ids][0] : null;
};

// ── ขั้น 1: อ่านตารางทั้งสองชีต ─────────────────────────────────────────────
// tables = { items: [[…]], checkpoints: [[…]] } (จาก /items/import/parse)
// ctx = { divisions, customers, models (ทุก item รวมที่ปิด), categories }
// คืน { entries, pointRows, fileErrors, unknownHeaders } · entries[i] = 1 item (จาก ITEMS หรือที่ ITEM_CHECKPOINTS อ้าง)
export const parseItemTables = (tables, ctx) => {
  const { divisions = [], models = [], categories = [] } = ctx;
  const fileErrors = [];
  const unknownHeaders = [];
  const itemRows = tables.items ?? [];
  const keys = detectItemHeader(itemRows[0]);
  if (!keys) return { entries: [], pointRows: [], fileErrors: ['ชีต ITEMS ไม่มีหัวคอลัมน์ "Item No"'], unknownHeaders };
  unknownHeaders.push(...itemRows[0].filter((h, i) => h && !keys[i]).map((h) => `ITEMS: ${h}`));

  const parsed = itemRows.slice(1)
    .map((cells, i) => ({ ...rowToItem(cells, keys, ctx), sheetRow: i + 2 }))
    .filter((r) => r.item_no || r.divisionText || Object.keys(r.fields).length);

  // Division ว่าง → เดาจาก Item No ที่ไม่ซ้ำ
  const fileKeys = parsed.filter((r) => r.division).map((r) => ({ division_id: r.division.id, item_no: r.item_no.toLowerCase() }));
  for (const r of parsed) {
    if (r.division || r.divisionText || !r.item_no) continue;
    const id = guessDivision(r.item_no, { fileKeys, models });
    r.division = divisions.find((d) => d.id === id) ?? null;
    if (!r.division) r.errors.push('ไม่ได้ใส่ Division และ Item No นี้มีหลาย Division (หรือยังไม่มีในระบบ) — ใส่ Division');
  }

  const entries = [];
  const byKey = new Map();
  for (const r of parsed) {
    const key = r.division ? keyOf(r.division.id, r.item_no) : `row:${r.sheetRow}`;
    if (byKey.has(key)) { byKey.get(key).errors.push(`ซ้ำกับแถว ${r.sheetRow} ของชีต ITEMS`); continue; }
    const match = r.division ? models.find((m) => keyOf(m.division_id, m.item_no) === key) ?? null : null;
    const e = { key, sheetRow: r.sheetRow, division: r.division, item_no: r.item_no, fields: r.fields, provided: r.provided, errors: [...r.errors], match, fromItems: true, drafts: [] };
    byKey.set(key, e);
    entries.push(e);
  }

  // ── ITEM_CHECKPOINTS ──
  const pointRows = [];
  const cpRows = tables.checkpoints ?? [];
  if (cpRows.length > 1) {
    const head = cpRows[0];
    const divIdx = head.findIndex((h) => normH(h) === 'division');
    const itemIdx = head.findIndex((h) => ['item no', 'item_no', 'item'].includes(normH(h)));
    const columns = gridColumns(categories);
    if (itemIdx < 0) fileErrors.push('ชีต ITEM_CHECKPOINTS ไม่มีคอลัมน์ "Item No"');
    else {
      const probe = tableToDrafts([head, []], columns);
      if (!probe) fileErrors.push('ชีต ITEM_CHECKPOINTS อ่านหัวคอลัมน์จุดตรวจไม่ได้');
      else {
        unknownHeaders.push(...probe.unknownHeaders
          .filter((h) => !['division', 'item no', 'item_no', 'item'].includes(normH(h)))
          .map((h) => `ITEM_CHECKPOINTS: ${h}`));
        cpRows.slice(1).forEach((cells, i) => {
          const sheetRow = i + 2;
          const r = tableToDrafts([head, cells], columns);
          const draft = r?.drafts[0];
          if (!draft) return; // แถวว่าง
          const itemNo = String(cells[itemIdx] ?? '').trim();
          const divText = divIdx >= 0 ? String(cells[divIdx] ?? '').trim() : '';
          const row = { sheetRow, itemNo, divText, draft, error: null };
          pointRows.push(row);
          if (!itemNo) { row.error = 'ไม่มี Item No'; return; }
          let division = divText ? resolveDivision(divText, divisions) : null;
          if (divText && !division) { row.error = `ไม่พบ Division "${divText}"`; return; }
          if (!division) {
            const id = guessDivision(itemNo, { fileKeys: entries.filter((e) => e.division).map((e) => ({ division_id: e.division.id, item_no: e.item_no.toLowerCase() })), models });
            division = divisions.find((d) => d.id === id) ?? null;
            if (!division) { row.error = `Item No "${itemNo}" ไม่ได้ใส่ Division และหาเองไม่ได้ (มีหลาย Division หรือไม่มี)`; return; }
          }
          const key = keyOf(division.id, itemNo);
          let e = byKey.get(key);
          if (!e) {
            const match = models.find((m) => keyOf(m.division_id, m.item_no) === key) ?? null;
            if (!match) { row.error = `ไม่พบ item "${itemNo}" (${division.name}) ทั้งในชีต ITEMS และในระบบ`; return; }
            e = { key, sheetRow: null, division, item_no: match.item_no, fields: {}, provided: [], errors: [], match, fromItems: false, drafts: [] };
            byKey.set(key, e);
            entries.push(e);
          }
          e.drafts.push({ ...draft, sheetRow });
        });
      }
    }
  }
  pointRows.filter((r) => r.error).forEach((r) => fileErrors.push(`ITEM_CHECKPOINTS แถว ${r.sheetRow}: ${r.error}`));
  return { entries, pointRows, fileErrors, unknownHeaders };
};

// id ของ item เดิมที่ต้องโหลดจุดตรวจมาเทียบ (เฉพาะที่มีแถวจุดตรวจ)
export const modelIdsNeedingPoints = (parsed) => parsed.entries.filter((e) => e.match && e.drafts.length).map((e) => e.match.id);

// ── ขั้น 2: merge + ตรวจ ────────────────────────────────────────────────────
const itemBase = (m) => (m
  ? {
    item_name: m.item_name ?? '', drawing_no: m.drawing_no ?? null, drawing_rev: m.drawing_rev ?? null,
    customer_id: m.customer_id ?? null,
    ...Object.fromEntries(MIN_KEYS.map((k) => [k, m[k] === null || m[k] === undefined || m[k] === '' ? null : Number(m[k])])),
    is_active: Number(m.is_active ?? 1) ? 1 : 0,
  }
  : { item_name: '', drawing_no: null, drawing_rev: null, customer_id: null, min_cp: null, min_cpk: null, min_cp_ctf: null, min_cpk_ctf: null, is_active: 1 });

export const mergeItem = (match, fields, provided) => {
  const out = itemBase(match);
  for (const k of provided) out[k] = fields[k];
  return out;
};

const sameV = (a, b) => (a === null || a === undefined || a === '' ? null : typeof a === 'number' || typeof b === 'number' ? Number(a) : String(a))
  === (b === null || b === undefined || b === '' ? null : typeof a === 'number' || typeof b === 'number' ? Number(b) : String(b));

export const diffItem = (match, view, customers = []) => {
  const base = itemBase(match);
  const show = (k, v) => {
    if (v === null || v === undefined || v === '') return k === 'customer_id' ? 'ไม่มีลูกค้า' : MIN_KEYS.includes(k) ? 'ตามลูกค้า' : '—';
    if (k === 'customer_id') return customers.find((c) => c.id === Number(v))?.name ?? `#${v}`;
    if (k === 'is_active') return Number(v) ? 'ใช้งาน' : 'ปิด';
    return String(v);
  };
  return WRITE_KEYS.filter((k) => !sameV(base[k], view[k])).map((k) => ({ key: k, label: FIELD_LABEL[k], from: show(k, base[k]), to: show(k, view[k]) }));
};

// existingPoints = Map(model_id → จุดที่เปิดอยู่ [รูป /master/checkpoints]) · catLabels = { '<cat>:<stage>': ชื่อ }
// คืน plan: entries[i] += { view, changes (null = item ใหม่ · [] = ไม่เปลี่ยน), points: ผลของ validateAll, counts, hasError, willSend }
export const buildItemPlan = (parsed, { existingPoints = new Map(), catLabels = {}, customers = [] } = {}) => {
  const entries = parsed.entries.map((e) => {
    const view = mergeItem(e.match, e.fields, e.provided);
    const errors = [...e.errors];
    if (!view.item_name) errors.push('item ใหม่ต้องมีชื่อ item');
    const changes = e.match ? diffItem(e.match, view, customers) : null;
    const results = validateAll(e.drafts, { existing: e.match ? existingPoints.get(e.match.id) ?? [] : [], mode: 'upsert', catLabels });
    const points = e.drafts.map((d, i) => ({ draft: d, ...results[i] }));
    const counts = {
      add: points.filter((p) => !p.match).length,
      update: points.filter((p) => p.match && p.changes?.length).length,
      same: points.filter((p) => p.match && p.changes && !p.changes.length).length,
      error: points.filter((p) => p.errors.length).length,
    };
    const hasError = errors.length > 0 || counts.error > 0;
    const willSend = !e.match || (changes?.length ?? 0) > 0 || counts.add > 0 || counts.update > 0;
    return { ...e, view, changes, errors, points, counts, hasError, willSend };
  });
  const summary = {
    itemsAdd: entries.filter((e) => !e.match).length,
    itemsUpdate: entries.filter((e) => e.match && e.changes.length).length,
    itemsSame: entries.filter((e) => e.match && !e.changes.length).length,
    pointsAdd: entries.reduce((n, e) => n + e.counts.add, 0),
    pointsUpdate: entries.reduce((n, e) => n + e.counts.update, 0),
    pointsSame: entries.reduce((n, e) => n + e.counts.same, 0),
    errors: entries.filter((e) => e.hasError).length + parsed.fileErrors.length,
  };
  return { entries, summary, fileErrors: parsed.fileErrors, unknownHeaders: parsed.unknownHeaders };
};

// plan → body ของ POST /master/items/bulk (เฉพาะ item ที่มีอะไรเปลี่ยน · จุดตรวจเฉพาะที่เพิ่ม/แก้)
export const planPayload = (plan) => ({
  items: plan.entries.filter((e) => e.willSend).map((e) => ({
    division_id: e.division.id,
    item_no: e.item_no,
    data: e.view,
    points: e.points.filter((p) => !p.match || p.changes?.length).map((p) => draftToPayload(p.view)),
  })),
});
