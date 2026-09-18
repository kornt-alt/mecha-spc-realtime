// frontend/src/utils/moLookup.js — จับคู่ผลจาก IPBASS MOPLAN กับ item ในระบบ
//
// pure ทั้งไฟล์ ไม่ยิงเน็ต ไม่แตะ state — แยกออกมาจาก component เพื่อเทสได้ตรง ๆ
// (แพตเทิร์นเดียวกับ utils/station.js)
//
// ⚠️ จับคู่ด้วย item_no อย่างเดียวไม่พอ — item เลขเดียวกันผลิตได้ทั้ง Mecha 1 (T47563)
//    และ Mecha 2 (T47183) และคนละ division ใช้ใบตรวจคนละใบ (คนละสเปก คนละ baseline)
//    ต้องกรองด้วย division ที่ได้จาก dept ที่ MOPLAN ตอบกลับมาเสมอ

const norm = (v) => String(v ?? '').trim().toUpperCase();

/** map dept ของ IPBASS ('T47183') กลับเป็น division_id ในระบบ — คืน null ถ้าแมพไม่ได้ */
export const divisionIdByDept = (divisions, dept) => {
  const target = norm(dept);
  if (!target) return null;
  const hit = (divisions ?? []).find((d) => norm(d.ipbass_dept) === target);
  return hit ? hit.id : null;
};

/**
 * dept ทั้งหมดที่ตั้งค่าไว้ — ใช้เป็นรายการที่จะยิง MOPLAN
 *
 * ⚠️ คืน `[]` ได้ (ยังไม่มีใครตั้ง ipbass_dept เลย) ผู้เรียก **ต้องดักก่อนยิง**
 *    ไม่งั้นจะได้ผลว่างแล้วไปรายงานผู้ใช้ว่า "ไม่พบ MO นี้" ทั้งที่ยังไม่ได้ยิงอะไรเลย
 */
export const deptsFromDivisions = (divisions) =>
  [...new Set((divisions ?? []).map((d) => String(d.ipbass_dept ?? '').trim()).filter(Boolean))];

/**
 * หา item ในระบบที่ตรงกับสิ่งที่ MOPLAN ตอบมา
 *
 * @returns {{ model: object|null, status: 'found'|'no-model'|'ambiguous', candidates: object[] }}
 *   found      เจอแถวเดียว
 *   no-model   ไม่มี item นี้ (ใน division นั้น) — ต้องไปเพิ่มที่ Master Setup
 *   ambiguous  เหลือหลายแถว เกิดเมื่อ dept แมพกลับเป็น division ไม่ได้ (ยังไม่ได้ตั้ง
 *              ipbass_dept หรือ MOPLAN ไม่ได้บอก dept มา) ตอนนั้นกรองไม่ได้ ต้องให้คนเลือกเอง
 */
export const resolveMoItem = (models, divisions, { itemNo, dept } = {}) => {
  const target = norm(itemNo);
  if (!target) return { model: null, status: 'no-model', candidates: [] };

  const byItem = (models ?? []).filter((m) => norm(m.item_no) === target);
  if (byItem.length === 0) return { model: null, status: 'no-model', candidates: [] };

  const divisionId = divisionIdByDept(divisions, dept);
  // แมพ dept ไม่ได้ = กรองไม่ได้ ต้องคงตัวเลือกไว้ทั้งหมด ห้ามเดาเอาตัวแรก
  const scoped = divisionId === null
    ? byItem
    : byItem.filter((m) => String(m.division_id) === String(divisionId));

  if (scoped.length === 1) return { model: scoped[0], status: 'found', candidates: scoped };
  if (scoped.length === 0) return { model: null, status: 'no-model', candidates: [] };
  return { model: null, status: 'ambiguous', candidates: scoped };
};

/**
 * เลขแบบของ item ตรงกับที่ MOPLAN บอกไหม
 *
 * ไม่ตรง = master ในระบบอาจค้างอยู่รุ่นเก่า — เตือนเฉย ๆ ไม่บล็อกอะไร
 * ข้างไหนว่างถือว่า "ไม่มีข้อมูลให้เทียบ" ไม่ใช่ "ไม่ตรง"
 */
export const drawMatches = (model, draw) => {
  const a = norm(model?.drawing_no);
  const b = norm(draw);
  if (!a || !b) return true;
  return a === b;
};
