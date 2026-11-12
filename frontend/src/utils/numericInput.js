// utils/numericInput.js — กรองสิ่งที่พิมพ์ลงช่องค่าวัด (pure)
//
// Korn สั่ง (2026-11): ช่องค่าวัดรับแค่ตัวเลขกับจุด · ช่องยังเป็น type="text" inputMode="decimal" ตามกฎเดิม
// (type=number คืนค่าว่างเงียบ ๆ กับบางรูปแบบ + ลูกศร/ลูกกลิ้งไปแก้ค่า) กรองที่ onChange แทน — พิมพ์และวางก็ผ่านตัวนี้
// ⚠️ "-" ได้เฉพาะจุดที่สเปกติดลบจริง (allowMinus) ไม่งั้นค่าที่อยู่ในสเปกของจุดนั้นจะกรอกไม่ได้
// ⚠️ เป็นแค่ตัวกันพิมพ์ผิด ตัวตัดสินจริงยังอยู่ที่ server (toNum / validateSubmission)

export const cleanDecimal = (raw, { allowMinus = false } = {}) => {
  const s = String(raw ?? '').replace(/,/g, '.');
  const neg = allowMinus && s.trimStart().startsWith('-');
  const kept = s.replace(/[^0-9.]/g, '');
  const dot = kept.indexOf('.');
  const body = dot === -1 ? kept : kept.slice(0, dot + 1) + kept.slice(dot + 1).replace(/\./g, '');
  return (neg ? '-' : '') + body;
};

// จุดที่สเปกมีค่าติดลบ → ช่องของจุดนั้นพิมพ์ "-" ได้
export const specAllowsMinus = (cp) => [cp?.lsl, cp?.usl, cp?.target]
  .some((v) => v !== null && v !== undefined && v !== '' && Number(v) < 0);
