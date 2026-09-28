// frontend/src/components/SpecValue.js — เขียนสเปกแบบสัญกรณ์พิกัดงานเขียนแบบ
//
// ฟอร์มที่โรงงานใช้อยู่ (132205300022D.xlsx ชีต inspection record) เขียนสเปกเป็น
// ค่าพื้น + พิกัดบน/ล่าง แล้วค่อยแตกเป็น Max/Min เช่น  Ø2  0/-0.004  →  2.000 / 1.996
// หน้าจอเลยเขียนแบบเดียวกันเพื่อให้เทียบกับแบบในมือได้ตรง ๆ ไม่ต้องแปลงในหัว
//
//   Ø2.000 ⁺⁰·⁰⁰⁰      1.996 – 2.000 mm
//          ₋₀·₀₀₄
//
// ⚠️ ไม่ใช้ unicode superscript/subscript — เรนเดอร์เพี้ยนข้ามฟอนต์ ใช้ flex ซ้อนสองบรรทัดแทน
// ⚠️ usl/lsl/target เป็น NULL ได้ตาม schema และผ่าน toNum มาแล้วเป็น number|null
import React from 'react';

// ทศนิยมกี่ตำแหน่ง — ดูจากค่าที่มีจริง ไม่ fix ไว้ เพราะ OD ใช้ 3-4 ตำแหน่ง
// แต่ความยาวหรือความแข็งใช้ 1-2 ตำแหน่ง แสดง 36.1500 mm มันรกเปล่า ๆ
export const decimalsOf = (...values) => {
  let max = 0;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const s = String(v);
    const dot = s.indexOf('.');
    if (dot >= 0) max = Math.max(max, s.length - dot - 1);
  }
  return Math.min(Math.max(max, 1), 4);
};

const fmt = (v, dp) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : null);

// พิกัดต้องมีเครื่องหมายเสมอ (+0.000 / -0.004) ไม่งั้นอ่านไม่ออกว่าเป็นพิกัดหรือค่าสัมบูรณ์
// ⚠️ ปัดก่อนเทียบ 0 — 2 - 1.996 ได้ 0.0040000000000000036 ใน floating point
const signed = (v, dp) => {
  const r = Number(v.toFixed(dp));
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(dp)}`;
};

const SpecValue = ({ checkpoint }) => {
  const { char_type: charType, usl, lsl, target, unit } = checkpoint ?? {};

  if (charType === 'attribute') {
    return <span className="text-muted">ตรวจด้วยตา</span>;
  }

  const hasU = typeof usl === 'number' && Number.isFinite(usl);
  const hasL = typeof lsl === 'number' && Number.isFinite(lsl);
  const hasT = typeof target === 'number' && Number.isFinite(target);

  if (!hasU && !hasL) return <span className="text-muted">—</span>;

  const dp = decimalsOf(usl, lsl, target);
  const u = fmt(usl, dp);
  const l = fmt(lsl, dp);
  const unitText = unit ? ` ${unit}` : '';

  // ช่วงเต็ม (Max/Min) — บรรทัดนี้มีเสมอ เป็นตัวเลขที่เอาไปเทียบกับค่าวัดตรง ๆ
  const range = hasU && hasL
    ? `${l} – ${u}${unitText}`
    : hasU
      ? `≤ ${u}${unitText}`
      : `≥ ${l}${unitText}`;

  // มีค่าพื้นและสเปกสองด้าน → เขียนแบบพิกัดงานได้
  if (hasT && hasU && hasL) {
    return (
      <span className="spec">
        <span className="spec__nominal">{fmt(target, dp)}</span>
        <span className="spec__tol">
          <span>{signed(usl - target, dp)}</span>
          <span>{signed(lsl - target, dp)}</span>
        </span>
        <span className="spec__range">{range}</span>
      </span>
    );
  }

  // ด้านเดียว หรือไม่ได้ตั้งค่าพื้น → เขียนเป็นช่วงอย่างเดียว
  return <span className="spec__range">{range}</span>;
};

export default SpecValue;
