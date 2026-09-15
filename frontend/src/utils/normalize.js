// MySQL คืนคอลัมน์ decimal(10,4) มาเป็น string (ucl, lcl, target, value)
// ถ้าเอาไปเทียบตรง ๆ จะกลายเป็นการเทียบ string: "9.5000" > "10.0000" === true
// จึงต้องแปลงเป็นตัวเลขที่จุดเดียว ตอนข้อมูลเข้า state

// คืน null เมื่อไม่มีค่า (คอลัมน์ ucl/lcl/target เป็น NULL ได้)
// ตอนเอาไปใส่ <Form.Control> ต้องใส่ ?? '' เสมอ ไม่งั้น input กลายเป็น uncontrolled
export const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

// แถวจาก /master/tree (flat row จาก LEFT JOIN 4 ชั้น)
export const normalizeTreeRow = (r) => ({
  ...r,
  ucl: toNum(r.ucl),
  lcl: toNum(r.lcl),
  target: toNum(r.target),
});

// แถวค่าวัดจาก /spc/:specId, /history/:partId และ payload ที่มาทาง socket
export const normalizeMeasure = (m) => ({
  ...m,
  value: toNum(m.value),
  ucl: toNum(m.ucl),
  lcl: toNum(m.lcl),
  target: toNum(m.target),
});

export const normalizeTree = (rows) =>
  Array.isArray(rows) ? rows.map(normalizeTreeRow) : [];

export const normalizeMeasures = (rows) =>
  Array.isArray(rows) ? rows.map(normalizeMeasure) : [];
