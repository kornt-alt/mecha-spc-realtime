// frontend/src/components/SearchSelect.js — ช่องเลือกที่พิมพ์ค้นหาได้
//
// ใช้แทน <Form.Select> ทุกช่องที่ลิสต์ยาวจนเลื่อนหาช้ากว่าพิมพ์ (item / เครื่อง / ผู้ตรวจ)
// เขียนเองไม่ใช้ react-select เพราะโปรเจกต์นี้ไม่มี dependency นอกเหนือจาก bootstrap/recharts/socket.io
// และต้องการแถว "ไม่พบ — เพิ่มใหม่" ที่คุมเองได้
//
// ⚠️ value เป็น id (string) เสมอ ไม่ใช่ข้อความที่เห็นบนจอ — ผู้ตรวจชื่อซ้ำกันได้
//    และ item ก็ซ้ำข้าม division ได้ การ map กลับจากข้อความจึงไม่ปลอดภัย
//    (นี่คือเหตุผลที่ไม่ใช้ <input list> + <datalist> แบบช่องหน่วย/เครื่องมือวัด ซึ่ง
//    เป็น free text จริง ๆ ไม่ได้ชี้ไปแถวไหนใน DB)
//
// ⚠️ พิมพ์ค้างไว้แล้วคลิกที่อื่น = กลับไปโชว์ตัวที่เลือกไว้เดิม ไม่ใช่ทิ้งข้อความค้างไว้
//    ข้อความที่ไม่ตรงกับตัวเลือกไหนเลยแต่ยังอยู่ในช่อง คือช่องที่โกหกว่าเลือกอะไรไว้
import React, { useEffect, useMemo, useRef, useState } from 'react';

const norm = (v) => String(v ?? '').trim().toLowerCase();

const SearchSelect = ({
  id,
  value,
  options,
  onChange,
  placeholder = '— เลือก —',
  disabled = false,
  emptyText = 'ไม่พบรายการที่ค้นหา',
  onAddNew = null,
  addNewLabel = 'เพิ่มรายการใหม่',
  'aria-label': ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value)) ?? null;

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q));
  }, [query, options]);

  // แถว "เพิ่มใหม่" ต่อท้ายลิสต์ — index เท่ากับ filtered.length
  const addIndex = onAddNew ? filtered.length : -1;
  const lastIndex = onAddNew ? filtered.length : filtered.length - 1;

  const close = () => { setOpen(false); setQuery(''); setActive(0); };

  // คลิกนอกช่อง = ปิดแล้วคืนข้อความเป็นตัวที่เลือกไว้ (ดูหมายเหตุหัวไฟล์)
  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const pick = (option) => {
    close();
    onChange(String(option.value));
  };

  const runAddNew = () => {
    close();
    onAddNew();
  };

  const onKeyDown = (e) => {
    if (disabled) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      if (lastIndex < 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step < 0 ? lastIndex : (i + step) % (lastIndex + 1)));
      return;
    }
    if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      if (active === addIndex) runAddNew();
      else if (filtered[active]) pick(filtered[active]);
      return;
    }
    if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      close();
    }
  };

  const listId = id ? `${id}-listbox` : undefined;
  const activeId = id && open ? `${id}-opt-${active}` : undefined;

  return (
    <div className="ss" ref={rootRef}>
      <input
        id={id}
        ref={inputRef}
        type="text"
        className="form-control ss__input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? '')}
        onChange={(e) => { setOpen(true); setQuery(e.target.value); setActive(0); }}
        onFocus={() => { if (!disabled) { setOpen(true); setQuery(''); setActive(0); } }}
        onKeyDown={onKeyDown}
      />

      {open && (
        <ul className="ss__list" id={listId} role="listbox">
          {filtered.map((o, i) => (
            <li
              key={o.value}
              id={id ? `${id}-opt-${i}` : undefined}
              role="option"
              aria-selected={String(o.value) === String(value)}
              className={`ss__opt${i === active ? ' ss__opt--active' : ''}`}
              // ⚠️ ต้องเป็น onMouseDown ไม่ใช่ onClick — blur ของ input มาก่อน click
              //    เสมอ กด ๆ แล้วลิสต์ปิดไปก่อนจะได้ค่า
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{o.label}</span>
              {o.hint && <span className="ss__hint">{o.hint}</span>}
            </li>
          ))}

          {filtered.length === 0 && !onAddNew && (
            <li className="ss__empty">{emptyText}</li>
          )}

          {onAddNew && (
            <li
              id={id ? `${id}-opt-${addIndex}` : undefined}
              role="option"
              aria-selected={false}
              className={`ss__opt ss__opt--add${active === addIndex ? ' ss__opt--active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); runAddNew(); }}
              onMouseEnter={() => setActive(addIndex)}
            >
              {filtered.length === 0 ? `${emptyText} — ${addNewLabel}` : `+ ${addNewLabel}`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default SearchSelect;
