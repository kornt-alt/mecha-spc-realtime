// frontend/src/components/DateInput.js — ช่องกรอกวันที่ dd/mm/yyyy (แทน <input type="date">)
//
// <input type="date"> แสดงตามภาษาของเครื่อง (Windows ภาษาอังกฤษ = mm/dd/yyyy) บังคับรูปไม่ได้ Korn จึงเลือกช่องพิมพ์เอง
// ⚠️ value / onChange เป็น ISO 'YYYY-MM-DD' เหมือน type=date เป๊ะ — ผู้เรียก, URL และ backend ไม่ต้องรู้ว่ามีช่องนี้
//    ข้อความ dd/mm/yyyy อยู่ใน state ภายในเท่านั้น · ไม่ครบ/ไม่ถูก/ลบหมด = onChange('') (ไม่ถูกขึ้นกรอบแดงด้วย)
// ⚠️ type="text" inputMode="numeric" — มือถือขึ้นแป้นตัวเลข · พิมพ์ตัวเลขล้วนเติม / ให้ (29092026 → 29/09/2026)
// ปุ่ม 📅 เปิดปฏิทินของเบราว์เซอร์จาก <input type="date"> ที่ซ่อนอยู่ใต้ปุ่ม — ใช้เป็นตัวเลือกวันเท่านั้น
// ⚠️ ห้ามทำให้ช่อง type=date นั้นมองเห็นได้ — จะกลับไปแสดงรูปตามภาษาเครื่อง (ปัญหาที่ช่องนี้มาแก้)
import React, { useEffect, useRef, useState } from 'react';
import { Form, InputGroup, Button } from 'react-bootstrap';
import { dmyToIso, isoToDmy } from '../utils/dateFormat';

// จัดรูปจากตัวเลขทุกครั้ง (29092026 → 29/09/2026 · พิมพ์ต่อจาก "29/09" ได้ · ลบถอยหลังผ่าน / ได้)
// ยกเว้นคนพิมพ์วัน/เดือนหลักเดียวตามด้วย / เอง ("1/9/2026") — ปล่อยตามนั้น dmyToIso รับได้
const autoSlash = (raw) => {
  if (/^\d\/|^\d{1,2}\/\d\//.test(raw)) return raw.replace(/[^\d/]/g, '').slice(0, 10);
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

const HIDDEN_PICKER = {
  position: 'absolute', right: 0, bottom: 0, width: '2.5rem', height: '100%',
  opacity: 0, pointerEvents: 'none', border: 0, padding: 0,
};

const DateInput = ({ value, onChange, className = '', size, style, ...rest }) => {
  const [text, setText] = useState(isoToDmy(value));
  const pickerRef = useRef(null);

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    // showPicker: Chrome/Edge 99+ · เบราว์เซอร์เก่าโยน error หรือไม่มีฟังก์ชัน → focus + click แทน
    try {
      if (typeof el.showPicker === 'function') { el.showPicker(); return; }
    } catch { /* ตกไปใช้ทางสำรอง */ }
    el.focus();
    el.click();
  };

  // ค่าจากข้างนอกเปลี่ยน (ล้างตัวกรอง / สลับเป็นกำหนดเอง) → ตามให้ · แต่ถ้าข้อความตอนนี้แทนค่าเดียวกันอยู่แล้วไม่ทับ
  // (ไม่งั้นพิมพ์ "1/9/2026" แล้วถูกเขียนเป็น "01/09/2026" กลางคันระหว่างพิมพ์)
  useEffect(() => {
    setText((cur) => ((dmyToIso(cur) ?? '') === (value ?? '') ? cur : isoToDmy(value)));
  }, [value]);

  const invalid = text !== '' && dmyToIso(text) === null && text.length >= 8;

  return (
    <InputGroup size={size} style={{ position: 'relative', flexWrap: 'nowrap', ...style }} className={className}>
    <Form.Control
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/yyyy"
      maxLength={10}
      value={text}
      className={invalid ? 'is-invalid' : ''}
      onChange={(e) => {
        const next = autoSlash(e.target.value);
        setText(next);
        // ⚠️ ยังไม่ครบ/ไม่ถูก = ส่ง '' ไม่ใช่เงียบ — ไม่งั้นผู้เรียกยังถือวันเก่าไว้ทั้งที่จอโชว์ข้อความอื่น
        //    (หน้ารายงานกดค้นหาแล้วกรองด้วยวันที่ไม่มีใครเห็น) · '' ทำให้ผู้เรียกขึ้นเตือน "กรอกให้ครบ" เอง
        const iso = dmyToIso(next) ?? '';
        if (iso !== (value ?? '')) onChange(iso);
      }}
      {...rest}
    />
    {/* ช่องที่ซ่อนอยู่ก่อนปุ่ม — ปุ่มต้องเป็นลูกตัวสุดท้ายของ InputGroup ไม่งั้นมุมขวาไม่โค้ง */}
    <input
      ref={pickerRef}
      type="date"
      tabIndex={-1}
      aria-hidden="true"
      style={HIDDEN_PICKER}
      value={value || ''}
      onChange={(e) => { if (e.target.value !== (value ?? '')) onChange(e.target.value); }}
    />
    <Button variant="outline-secondary" className="no-print" aria-label="เลือกจากปฏิทิน" title="เลือกจากปฏิทิน"
      onClick={openPicker} disabled={rest.disabled}>
      📅
    </Button>
    </InputGroup>
  );
};

export default DateInput;
