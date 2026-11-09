// src/components/table/dataTable.js — ตรรกะเรียง/กรองตาราง (pure ไม่มี React · มี test)
// ใช้คู่กับ useDataTable.js · ต้นแบบการเรียงมาจาก useSort ของ MECHA2_QC_GAUGE_SYSTEM
// ⚠️ ไฟล์นี้ถูกก๊อปไปไว้ใน skill korn-ui-theme (assets/src/components/table) แก้แล้วอัปเดตที่นั่นด้วย

export const EMPTY_LABEL = '(ว่าง)';

const isEmpty = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** เทียบ 2 ค่า: ตัวเลขเทียบเป็นตัวเลข นอกนั้นเทียบแบบไทย + เลขในข้อความ (IT2 < IT10) */
export function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a - b;
  return String(a).localeCompare(String(b), 'th', { numeric: true, sensitivity: 'base' });
}

/** ข้อความที่ใช้กรองของคอลัมน์ — ค่าว่างเป็น '' (แสดงเป็น "(ว่าง)") */
export function textOf(col, row) {
  const v = col.text ? col.text(row) : col.get(row);
  if (isEmpty(v)) return '';
  if (v instanceof Date) return v.toLocaleDateString('th-TH');
  return String(v).trim();
}

/** เรียงแบบคงลำดับเดิมเมื่อค่าเท่ากัน · ค่าว่างอยู่ท้ายเสมอไม่ว่าทิศไหน · dir = 1 | -1 */
export function sortRows(rows, getter, dir) {
  if (!getter || !dir) return rows;
  return rows
    .map((r, i) => [getter(r), i, r])
    .sort(([a, ia], [b, ib]) => {
      const ea = isEmpty(a);
      const eb = isEmpty(b);
      if (ea || eb) return ea === eb ? ia - ib : ea ? 1 : -1;
      return compareValues(a, b) * dir || ia - ib;
    })
    .map((x) => x[2]);
}

/**
 * กรองตามค่าที่ติ๊กไว้ของแต่ละคอลัมน์ (AND ทุกคอลัมน์)
 * filters = { key: Set ของข้อความที่เลือก } · คอลัมน์ที่ไม่มีใน filters = ไม่กรอง
 * skipKey = คอลัมน์ที่ไม่นับ (ใช้หาตัวเลือกแบบ cascading เหมือน Excel)
 */
export function applyFilters(rows, filters, columns, skipKey) {
  const keys = Object.keys(filters || {}).filter((k) => k !== skipKey && filters[k] && columns[k]);
  if (!keys.length) return rows;
  return rows.filter((r) => keys.every((k) => filters[k].has(textOf(columns[k], r))));
}

/** ค่าไม่ซ้ำของคอลัมน์ + จำนวนแถว เรียงตามค่า (ตัวเลขเรียงเป็นตัวเลข) ค่าว่างอยู่ท้าย */
export function distinctValues(rows, col) {
  const map = new Map();
  for (const r of rows) {
    const t = textOf(col, r);
    const hit = map.get(t);
    if (hit) hit.count += 1;
    else map.set(t, { value: t, count: 1, sortKey: col.get(r) });
  }
  return [...map.values()]
    .sort((a, b) => {
      if (a.value === '' || b.value === '') return a.value === b.value ? 0 : a.value === '' ? 1 : -1;
      const ka = isEmpty(a.sortKey) ? a.value : a.sortKey;
      const kb = isEmpty(b.sortKey) ? b.value : b.sortKey;
      return compareValues(ka, kb);
    })
    .map(({ value, count }) => ({ value, count }));
}
