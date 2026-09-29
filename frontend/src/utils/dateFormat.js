// frontend/src/utils/dateFormat.js — แสดงวันที่/เวลาของทั้งแอป (pure)
//
// รูปเดียวทั้งระบบ: dd/mm/yyyy ค.ศ. เวลาไทย (Korn เลือก)
// ⚠️ ห้ามใช้ toLocaleString('th-TH') อีก — ได้ พ.ศ. + ไม่เติม 0 (29/9/2569) และแต่ละที่ออกมาไม่เหมือนกัน
// ⚠️ ประกอบจาก formatToParts เอง ไม่พึ่งตัวคั่นของ locale (en-GB บางเบราว์เซอร์ใส่ ", " ระหว่างวันกับเวลา)

const TZ = 'Asia/Bangkok';

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

const partsOf = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const out = {};
  for (const p of PARTS.formatToParts(d)) out[p.type] = p.value;
  return out;
};

/** 29/09/2026 */
export const fmtDate = (v, empty = '—') => {
  const p = partsOf(v);
  return p ? `${p.day}/${p.month}/${p.year}` : empty;
};

/** 08:16 (หรือ 08:16:35 เมื่อ withSeconds) */
export const fmtTime = (v, empty = '—', withSeconds = false) => {
  const p = partsOf(v);
  if (!p) return empty;
  return withSeconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
};

/** 29/09/2026 08:16 */
export const fmtDateTime = (v, empty = '—') => {
  const p = partsOf(v);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : empty;
};

/** '2026-09-29' → '29/09/2026' · อย่างอื่น → '' (ไม่ผ่าน Date เพื่อไม่ให้ timezone เลื่อนวัน) */
export const isoToDmy = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** '29/09/2026' → '2026-09-29' · วันที่ไม่มีจริง (31/02) หรือรูปผิด → null */
export const dmyToIso = (text) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((text ?? '').trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
