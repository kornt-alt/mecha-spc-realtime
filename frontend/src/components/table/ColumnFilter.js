// src/components/table/ColumnFilter.js — หัวคอลัมน์ที่เรียง + กรองแบบ Excel ได้ (ใช้ผ่าน useDataTable().th)
// ⚠️ popover ต้อง render ใน body (Overlay ของ react-bootstrap ทำให้แล้ว) ไม่งั้นกล่องเลื่อน .mc-freeze ตัดขอบทิ้ง
// ⚠️ ไฟล์นี้ถูกก๊อปไปไว้ใน skill korn-ui-theme (assets/src/components/table) แก้แล้วอัปเดตที่นั่นด้วย
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Overlay, Popover } from 'react-bootstrap';
import { EMPTY_LABEL } from './dataTable';
import Icon from '../layout/Icon';

const MAX_SHOWN = 300; // คอลัมน์ที่ค่าไม่ซ้ำเยอะ (รหัส/ชื่อ) แสดงแค่นี้ ที่เหลือหาด้วยช่องค้นหา
// ⚠️ ตารางกว้างบนมือถือ ปุ่มกรวยอาจอยู่นอกจอ (ในกล่องเลื่อนแนวนอน) — บังคับ popover ให้อยู่ในจอเสมอ
//    ไม่งั้น popover ไปโผล่นอกจอแล้วทำให้ทั้งหน้ามี scroll แนวนอน (เจอจริงที่ 375px)
const POPPER_CONFIG = {
  modifiers: [{ name: 'preventOverflow', options: { rootBoundary: 'viewport', padding: 8, altAxis: true, tether: false } }],
};

function FilterPanel({ options, selected, sortDir, onSort, onApply, onClose }) {
  const [q, setQ] = useState('');
  // ร่างของค่าที่ติ๊ก — กด "ตกลง" แล้วถึงกรองจริง (เหมือน Excel)
  const [draft, setDraft] = useState(() => new Set(selected || options.map((o) => o.value)));
  const allRef = useRef(null);
  const searchRef = useRef(null);

  // ⚠️ ห้ามใช้ autoFocus — ตอน render แรก popover ยังไม่ถูกจัดตำแหน่ง (อยู่ท้าย body) focus แล้วหน้าเลื่อนลงไปหา
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, []);

  const needle = q.trim().toLowerCase();
  const matched = useMemo(
    () => (needle ? options.filter((o) => (o.value || EMPTY_LABEL).toLowerCase().includes(needle)) : options),
    [options, needle]
  );
  const shown = matched.slice(0, MAX_SHOWN);
  const nOn = matched.filter((o) => draft.has(o.value)).length;
  const allOn = matched.length > 0 && nOn === matched.length;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = nOn > 0 && !allOn;
  }, [nOn, allOn]);

  const toggleAll = () => {
    setDraft((d) => {
      const next = new Set(d);
      matched.forEach((o) => (allOn ? next.delete(o.value) : next.add(o.value)));
      return next;
    });
  };
  const toggle = (v) => setDraft((d) => {
    const next = new Set(d);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  });

  const apply = () => {
    // พิมพ์ค้นหาแล้วกดตกลง = เอาเฉพาะที่ค้นเจอและติ๊กไว้ (พฤติกรรมเดียวกับ Excel)
    const chosen = needle ? new Set(matched.filter((o) => draft.has(o.value)).map((o) => o.value)) : draft;
    onApply(chosen.size === options.length && !needle ? null : chosen);
    onClose();
  };

  return (
    <div className="mc-colf" onKeyDown={(e) => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') onClose(); }}>
      <div className="mc-colf__sort">
        <button type="button" className={sortDir === 1 ? 'on' : ''} onClick={() => { onSort(1); onClose(); }}>
          <Icon name="sortAsc" size={14} /> น้อย → มาก
        </button>
        <button type="button" className={sortDir === -1 ? 'on' : ''} onClick={() => { onSort(-1); onClose(); }}>
          <Icon name="sortDesc" size={14} /> มาก → น้อย
        </button>
      </div>
      <input
        className="form-control form-control-sm mc-colf__search"
        placeholder="ค้นหา..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        ref={searchRef}
      />
      <label className="mc-colf__item mc-colf__item--all">
        <input ref={allRef} type="checkbox" checked={allOn} onChange={toggleAll} />
        <span>{needle ? 'เลือกทั้งหมดที่ค้นเจอ' : 'เลือกทั้งหมด'}</span>
        <small>{matched.length}</small>
      </label>
      <div className="mc-colf__list">
        {shown.map((o) => (
          <label key={o.value} className="mc-colf__item">
            <input type="checkbox" checked={draft.has(o.value)} onChange={() => toggle(o.value)} />
            <span className={o.value ? '' : 'text-muted fst-italic'}>{o.value || EMPTY_LABEL}</span>
            <small>{o.count}</small>
          </label>
        ))}
        {matched.length > MAX_SHOWN && (
          <div className="mc-colf__more">แสดง {MAX_SHOWN} จาก {matched.length} ค่า — พิมพ์ค้นหาเพื่อหาเพิ่ม</div>
        )}
        {matched.length === 0 && <div className="mc-colf__more">ไม่พบค่าที่ค้นหา</div>}
      </div>
      <div className="mc-colf__foot">
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { onApply(null); onClose(); }} disabled={!selected}>
          ล้าง
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={apply} disabled={nOn === 0}>
          ตกลง
        </button>
      </div>
    </div>
  );
}

/**
 * <th> ที่มีปุ่มเรียง (กดชื่อคอลัมน์) + ปุ่มกรวยเปิดตัวกรอง
 * sortable / filterable = false ปิดทีละอย่างได้
 */
export default function DataTh({
  label, sortDir, onSortClick, onSort, filterActive, selected, getOptions, onFilter,
  sortable = true, filterable = true, className, style, title, ...rest
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const options = useMemo(() => (open ? getOptions() : []), [open, getOptions]);
  const cls = ['mc-th', filterActive ? 'mc-th--filtered' : '', className || ''].filter(Boolean).join(' ');

  return (
    <th
      className={cls}
      style={style}
      title={title}
      aria-sort={sortDir === 1 ? 'ascending' : sortDir === -1 ? 'descending' : 'none'}
      {...rest}
    >
      <span className="mc-th__in">
        {sortable ? (
          <button type="button" className={`mc-th__sort${sortDir ? ' on' : ''}`} onClick={onSortClick}
            title="กดเพื่อเรียง น้อย→มาก / มาก→น้อย / ลำดับเดิม">
            <span className="mc-th__label">{label}</span>
            <span className="mc-th__arrow" aria-hidden="true">{sortDir === 1 ? '▲' : sortDir === -1 ? '▼' : '↕'}</span>
          </button>
        ) : <span className="mc-th__label">{label}</span>}
        {filterable && (
          <button
            ref={btnRef}
            type="button"
            className={`mc-th__filter${filterActive ? ' on' : ''}`}
            onClick={() => setOpen((o) => !o)}
            aria-label={`กรองคอลัมน์ ${typeof label === 'string' ? label : ''}`}
            title={filterActive ? 'กรองอยู่ — กดเพื่อแก้' : 'กรอง'}
          >
            <Icon name="funnel" size={13} filled={filterActive} />
          </button>
        )}
      </span>
      {filterable && (
        <Overlay target={btnRef.current} show={open} placement="bottom-start" rootClose onHide={() => setOpen(false)} flip
          popperConfig={POPPER_CONFIG}>
          <Popover className="mc-colf-pop">
            <Popover.Body>
              {open && (
                <FilterPanel
                  options={options}
                  selected={selected}
                  sortDir={sortDir}
                  onSort={onSort}
                  onApply={onFilter}
                  onClose={() => setOpen(false)}
                />
              )}
            </Popover.Body>
          </Popover>
        </Overlay>
      )}
    </th>
  );
}
