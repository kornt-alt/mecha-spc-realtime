// frontend/src/utils/normalize.js — แปลงค่า decimal จาก MySQL เป็นตัวเลขที่จุดเดียว
//
// ⚠️ mysql2 คืนคอลัมน์ decimal มาเป็น string ("9.5000") ถ้าเอาไปเทียบตรง ๆ จะกลายเป็น
// การเทียบ string แบบ lexicographic: "9.5000" > "10.0000" เป็นจริง
// เคยทำให้ชิ้นงานที่อยู่ในสเปกถูกตีเป็น NG มาแล้ว (36 จาก 46 แถวตอนตรวจเจอ)
//
// ทุกจุดที่ดึงข้อมูลพวกนี้เข้า state ต้องผ่านไฟล์นี้ก่อนเสมอ

// คืน null เมื่อไม่มีค่า (usl/lsl/target เป็น NULL ได้ตาม schema)
// ⚠️ ตอนเอาไปใส่ <Form.Control> ต้อง ?? '' เสมอ ไม่งั้น input กลายเป็น uncontrolled
export const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

// ตรงข้ามกับ toNum — ช่องตัวเลขที่เว้นว่างต้องส่ง null ไม่ใช่ '' (คอลัมน์เป็น decimal NULLable)
export const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// min_* = เกณฑ์ Cp/Cpk ของ item (NULL = ตามลูกค้า) — มากับ /master/models
const DECIMAL_FIELDS = [
  'usl', 'lsl', 'target', 'value', 'usl_used', 'lsl_used',
  'min_cp', 'min_cpk', 'min_cp_ctf', 'min_cpk_ctf',
];

const INT_FIELDS = ['sample_size', 'seq_no', 'n_used', 'piece_no', 'customer_id'];

const normalizeRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const f of DECIMAL_FIELDS) if (f in out) out[f] = toNum(out[f]);
  for (const f of INT_FIELDS) if (f in out) out[f] = toNum(out[f]);
  // tinyint(1) มาเป็น 0/1 — แปลงเป็น boolean ให้ใช้กับ <Form.Check checked> ได้ตรง ๆ
  for (const f of ['is_active', 'is_critical']) if (f in out) out[f] = Boolean(Number(out[f]));
  return out;
};

export const normalizeRows = (rows) => (Array.isArray(rows) ? rows.map(normalizeRow) : []);

// baseline ที่ freeze ไว้ — มาจาก checkpoint_baselines ผ่าน baselineOf() ฝั่ง server
// ⚠️ xbarbar/rbar เป็นคอลัมน์ decimal มาเป็น string เหมือนทุกที่ ต้องผ่าน toNum ด้วย
//    machineId = 0 คือชุด "รวมทุกเครื่อง" ไม่ใช่รหัสเครื่องจริง
const normalizeBaseline = (b) => (b ? {
  ...b,
  xbarbar: toNum(b.xbarbar),
  rbar: toNum(b.rbar),
  n: toNum(b.n),
  subgroups: toNum(b.subgroups),
  machineId: toNum(b.machineId) ?? 0,
} : b);

export const normalizeCheckpoint = (row) => {
  const out = normalizeRow(row);
  if (Array.isArray(out?.baselines)) out.baselines = out.baselines.map(normalizeBaseline);
  return out;
};

export const normalizeCheckpoints = (rows) =>
  (Array.isArray(rows) ? rows.map(normalizeCheckpoint) : []);

// ผลจาก /api/charts/:id — จุดบนกราฟกับลิมิตคำนวณมาจาก server แล้ว เป็น number อยู่แล้ว
// เหลือแค่ checkpoint กับ baseline ที่มาจากตารางตรง ๆ จึงยังเป็น string
export const normalizeChart = (chart) => {
  if (!chart) return chart;
  return {
    ...chart,
    checkpoint: chart.checkpoint ? normalizeRow(chart.checkpoint) : null,
    baseline: normalizeBaseline(chart.baseline) ?? null,
    baselines: Array.isArray(chart.baselines) ? chart.baselines.map(normalizeBaseline) : undefined,
  };
};

// ตัดสิน OK/NG ฝั่ง client
//
// ⚠️ advisory เท่านั้น — ใช้เพื่อให้ operator เห็นสีแดงทันทีที่พิมพ์
//    ค่าที่ลง DB คือค่าที่ backend/services/judgment.js คำนวณ ไม่ใช่ค่าจากตรงนี้
//    ถ้าสองที่ไม่ตรงกันเมื่อไหร่ ให้ยึดฝั่ง server เสมอ
export const judgeLocal = (value, usl, lsl) => {
  const v = toNum(value);
  if (v === null) return null;
  const U = toNum(usl);
  const L = toNum(lsl);
  if (U !== null && v > U) return 'NG';
  if (L !== null && v < L) return 'NG';
  return 'OK';
};
