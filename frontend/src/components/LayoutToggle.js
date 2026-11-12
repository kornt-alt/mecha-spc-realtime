// components/LayoutToggle.js — ปุ่มสลับตารางกรอก "แนวตั้ง / แนวนอน" (ใช้ทั้งใบตรวจตามรอบและหน้า Set up)
//
// แนวตั้ง = จุดตรวจเป็นแถว ชิ้นเป็นคอลัมน์ (แบบฟอร์ม SET UP) · แนวนอน = จุดตรวจเป็นคอลัมน์ ชิ้นเป็นแถว (แบบชีต Input)
// ⚠️ แค่วิธีวาด — หน้าที่ใช้ถือค่าที่กรอกชุดเดียว สลับกลางคันค่าไม่หาย
// ⚠️ แต่ละหน้าจำแยก key (spc.sheetLayout / spc.setupLayout) · localStorage ห่อ try/catch ทั้งอ่าน/เขียน (กฎ utils/station.js)
import React, { useState } from 'react';
import { Button } from 'react-bootstrap';

export const LAYOUTS = [
  { value: 'vertical', label: 'แนวตั้ง', title: 'จุดตรวจเป็นแถว ชิ้นเป็นคอลัมน์ — แบบฟอร์ม SET UP' },
  { value: 'horizontal', label: 'แนวนอน', title: 'จุดตรวจเป็นคอลัมน์ ชิ้นเป็นแถว — แบบชีต Input' },
];

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return LAYOUTS.some((l) => l.value === v) ? v : fallback;
  } catch { return fallback; }
};

export const useLayout = (storageKey, defaultValue) => {
  const [layout, setState] = useState(() => read(storageKey, defaultValue));
  const setLayout = (v) => {
    setState(v);
    try { localStorage.setItem(storageKey, v); } catch { /* จำไม่ได้ก็ใช้ได้ในหน้านี้ */ }
  };
  return [layout, setLayout];
};

const LayoutToggle = ({ layout, onChange }) => (
  <div className="btn-group btn-group-sm" role="group" aria-label="รูปแบบตาราง">
    {LAYOUTS.map((l) => (
      <Button key={l.value} size="sm" title={l.title}
        variant={layout === l.value ? 'primary' : 'outline-primary'}
        aria-pressed={layout === l.value}
        onClick={() => onChange(l.value)}>{l.label}</Button>
    ))}
  </div>
);

export default LayoutToggle;
