// frontend/src/utils/capability.js — เทียบ Cp/Cpk กับเกณฑ์ขั้นต่ำ (สำหรับเลือกสีเท่านั้น)
//
// ⚠️ เกณฑ์มาจาก server เสมอ (chart.capabilityTarget — เลือกที่ backend/services/capabilityTarget.js
//    ตามลำดับ override ของ item → ลูกค้า → ค่าระบบ) ไฟล์นี้ห้ามมีลำดับ fallback หรือเลข 1.33 ของตัวเอง
//    ของเดิม hardcode 1.33 ไว้ใน ControlChart กับ ReportPage แยกกัน ใช้กับทุกลูกค้าทุกจุด

// ต่ำกว่า 1.0 = กระบวนการผลิตของเสียออกมาแน่ ๆ ไม่ขึ้นกับลูกค้า
const POOR = 1.0;

// capTone(value, min) → 'none' | 'ok' | 'below' | 'poor'
//   below = ต่ำกว่าเกณฑ์ลูกค้าแต่ยังไม่ถึงขั้นวิกฤต (เหลือง) · poor = < 1.0 (แดง)
//   ไม่มีเกณฑ์ (backend เก่า / attribute) → เทียบแค่ 1.0
export const capTone = (value, min) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'none';
  if (value < POOR) return 'poor';
  if (typeof min === 'number' && value < min) return 'below';
  return 'ok';
};

// ข้อความบอกว่ากำลังเทียบกับเกณฑ์อะไร มาจากไหน — คนอ่านต้องรู้ว่าทำไมเลขเดียวกันเหลืองใน item หนึ่ง
// แต่ไม่เหลืองในอีก item
const SOURCE_TEXT = { item: 'ตั้งเฉพาะ item', default: 'ค่าระบบ' };

export const targetLabel = (t) => {
  if (!t) return '';
  const who = t.source === 'customer' || (t.source === 'item' && t.customerName)
    ? `ลูกค้า ${t.customerName ?? ''}`.trim()
    : '';
  const tags = [t.critical ? 'CTF' : null, who || null, SOURCE_TEXT[t.source] ?? null].filter(Boolean);
  return `เกณฑ์ Cp ≥ ${t.minCp.toFixed(2)} · Cpk ≥ ${t.minCpk.toFixed(2)}${tags.length ? ` (${tags.join(' · ')})` : ''}`;
};
