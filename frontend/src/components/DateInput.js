// frontend/src/components/DateInput.js — ช่องกรอกวันที่ dd/mm/yyyy (แทน <input type="date">)
//
// <input type="date"> แสดงตามภาษาของเครื่อง (Windows ภาษาอังกฤษ = mm/dd/yyyy) บังคับรูปไม่ได้ Korn จึงเลือกช่องพิมพ์เอง
// ⚠️ value / onChange เป็น ISO 'YYYY-MM-DD' เหมือน type=date เป๊ะ — ผู้เรียก, URL และ backend ไม่ต้องรู้ว่ามีช่องนี้
//    ข้อความ dd/mm/yyyy อยู่ใน state ภายในเท่านั้น · ไม่ครบ/ไม่ถูก/ลบหมด = onChange('') (ไม่ถูกขึ้นกรอบแดงด้วย)
// ⚠️ type="text" inputMode="numeric" — มือถือขึ้นแป้นตัวเลข · พิมพ์ตัวเลขล้วนเติม / ให้ (29092026 → 29/09/2026)
import React, { useEffect, useState } from 'react';
import { Form } from 'react-bootstrap';
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

const DateInput = ({ value, onChange, className = '', ...rest }) => {
  const [text, setText] = useState(isoToDmy(value));

  // ค่าจากข้างนอกเปลี่ยน (ล้างตัวกรอง / สลับเป็นกำหนดเอง) → ตามให้ · แต่ถ้าข้อความตอนนี้แทนค่าเดียวกันอยู่แล้วไม่ทับ
  // (ไม่งั้นพิมพ์ "1/9/2026" แล้วถูกเขียนเป็น "01/09/2026" กลางคันระหว่างพิมพ์)
  useEffect(() => {
    setText((cur) => ((dmyToIso(cur) ?? '') === (value ?? '') ? cur : isoToDmy(value)));
  }, [value]);

  const invalid = text !== '' && dmyToIso(text) === null && text.length >= 8;

  return (
    <Form.Control
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/yyyy"
      maxLength={10}
      value={text}
      className={`${className}${invalid ? ' is-invalid' : ''}`}
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
  );
};

export default DateInput;
