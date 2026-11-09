// src/components/table/useDataTable.js — เรียง + กรองแบบ Excel ให้ตารางรายการ (มาตรฐานทุกตาราง · Korn สั่ง)
//
//   const COLS = { code: { get: r => r.code }, qty: { get: r => Number(r.qty) },
//                  status: { get: r => r.status, text: r => STATUS[r.status]?.label } };  // ประกาศนอก component
//   const dt = useDataTable(filtered, COLS);       // ⚠️ วางก่อน slice แบ่งหน้า
//   <thead><tr>{dt.th('code', 'รหัส')}{dt.th('qty', 'คงเหลือ', { className: 'text-end' })}<th>จัดการ</th></tr></thead>
//   {dt.rows.slice(...).map(...)}                  // export Excel ก็ใช้ dt.rows ให้ตรงกับจอ
//   <FilterBar dt={dt} />                          // "กรองอยู่ N คอลัมน์ · ล้างตัวกรอง"
//   useEffect(() => setPage(1), [dt.resetKey]);    // เปลี่ยนการเรียง/กรองแล้วกลับหน้า 1
//
// get  = ค่าที่ใช้เรียง (ตัวเลขควรเป็น number) · text = ข้อความที่ใช้กรอง (ไม่ใส่ = String(get))
// ⚠️ ไฟล์นี้ถูกก๊อปไปไว้ใน skill korn-ui-theme (assets/src/components/table) แก้แล้วอัปเดตที่นั่นด้วย
import React, { useCallback, useMemo, useState } from 'react';
import DataTh from './ColumnFilter';
import Icon from '../layout/Icon';
import { applyFilters, distinctValues, sortRows } from './dataTable';

const EMPTY = [];

export function useDataTable(rows, columns) {
  const list = useMemo(() => (Array.isArray(rows) ? rows : EMPTY), [rows]);
  const [sort, setSort] = useState(null);     // { key, dir: 1 | -1 }
  const [filters, setFilters] = useState({}); // { key: Set }

  const filtered = useMemo(() => applyFilters(list, filters, columns), [list, filters, columns]);
  const sorted = useMemo(
    () => (sort && columns[sort.key] ? sortRows(filtered, columns[sort.key].get, sort.dir) : filtered),
    [filtered, sort, columns]
  );

  const setFilter = useCallback((key, set) => {
    setFilters((f) => {
      const next = { ...f };
      if (set) next[key] = set; else delete next[key];
      return next;
    });
  }, []);
  const clear = useCallback(() => setFilters({}), []);

  // ตัวเลือกของคอลัมน์ คิดจากแถวที่ผ่านตัวกรองคอลัมน์อื่นแล้ว (cascading เหมือน Excel) · คำนวณตอนเปิดเท่านั้น
  const optionsFor = useCallback(
    (key) => distinctValues(applyFilters(list, filters, columns, key), columns[key]),
    [list, filters, columns]
  );

  const th = (key, label, opts = {}) => {
    const col = columns[key];
    if (!col) return <th key={key} className={opts.className} style={opts.style}>{label}</th>;
    const dir = sort?.key === key ? sort.dir : 0;
    return (
      <DataTh
        key={key}
        label={label}
        sortDir={dir}
        onSortClick={() => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))}
        onSort={(d) => setSort({ key, dir: d })}
        filterActive={!!filters[key]}
        selected={filters[key] || null}
        getOptions={() => optionsFor(key)}
        onFilter={(set) => setFilter(key, set)}
        {...opts}
      />
    );
  };

  const active = Object.keys(filters).length;
  const resetKey = `${sort ? `${sort.key}:${sort.dir}` : ''}|${Object.keys(filters).map((k) => `${k}:${filters[k].size}`).join(',')}`;

  return { rows: sorted, th, active, clear, resetKey, total: list.length };
}

/** แถบบอกว่ากรองอยู่ + ปุ่มล้าง — แสดงเฉพาะตอนมีตัวกรองหัวคอลัมน์ */
export function FilterBar({ dt, className = '' }) {
  if (!dt.active) return null;
  return (
    <div className={`mc-filterbar ${className}`}>
      <Icon name="funnel" size={14} filled />
      <span>กรองอยู่ {dt.active} คอลัมน์ · แสดง {dt.rows.length.toLocaleString()} จาก {dt.total.toLocaleString()} แถว</span>
      <button type="button" onClick={dt.clear}>ล้างตัวกรอง</button>
    </div>
  );
}
