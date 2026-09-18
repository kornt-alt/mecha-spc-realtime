import { divisionIdByDept, deptsFromDivisions, resolveMoItem, drawMatches } from './moLookup';

const DIVISIONS = [
  { id: 2, name: 'Mecha 1', ipbass_dept: 'T47563' },
  { id: 3, name: 'Mecha 2', ipbass_dept: 'T47183' },
];

// item เลขเดียวกันอยู่ทั้งสอง division — เคสหลักที่ต้องแยกให้ออก
const MODELS = [
  { id: 4, division_id: 3, item_no: 'AAB-1001-01', item_name: 'Shaft', drawing_no: 'DWG-1001' },
  { id: 6, division_id: 2, item_no: 'AAB-1001-01', item_name: 'Shaft', drawing_no: 'DWG-1001' },
  { id: 5, division_id: 3, item_no: 'AAB-1002/C', item_name: 'Bracket', drawing_no: 'DWG-1002' },
];

test('divisionIdByDept แมพ dept กลับเป็น division', () => {
  expect(divisionIdByDept(DIVISIONS, 'T47183')).toBe(3);
  expect(divisionIdByDept(DIVISIONS, 't47563')).toBe(2);
  expect(divisionIdByDept(DIVISIONS, 'T99999')).toBeNull();
  expect(divisionIdByDept(DIVISIONS, '')).toBeNull();
  expect(divisionIdByDept(undefined, 'T47183')).toBeNull();
});

test('deptsFromDivisions ตัดค่าว่างและค่าซ้ำทิ้ง', () => {
  expect(deptsFromDivisions(DIVISIONS)).toEqual(['T47563', 'T47183']);
  expect(deptsFromDivisions([
    { ipbass_dept: 'T47183' }, { ipbass_dept: 'T47183' }, { ipbass_dept: null }, { ipbass_dept: '  ' },
  ])).toEqual(['T47183']);
});

// ⚠️ เคสสำคัญ: ถ้าคืน [] แล้วผู้เรียกไม่ดัก จะไปรายงานว่า "ไม่พบ MO" ทั้งที่ยังไม่ได้ยิง
test('deptsFromDivisions คืน [] เมื่อไม่มีใครตั้ง ipbass_dept', () => {
  expect(deptsFromDivisions([{ id: 1, name: 'Mecha 1' }])).toEqual([]);
  expect(deptsFromDivisions([])).toEqual([]);
  expect(deptsFromDivisions(undefined)).toEqual([]);
});

test('resolveMoItem เลือก item ของ division ที่ตรงกับ dept', () => {
  expect(resolveMoItem(MODELS, DIVISIONS, { itemNo: 'AAB-1001-01', dept: 'T47183' }))
    .toMatchObject({ status: 'found', model: { id: 4 } });
  expect(resolveMoItem(MODELS, DIVISIONS, { itemNo: 'AAB-1001-01', dept: 'T47563' }))
    .toMatchObject({ status: 'found', model: { id: 6 } });
});

test('resolveMoItem เทียบแบบไม่สนตัวพิมพ์และช่องว่างหัวท้าย', () => {
  expect(resolveMoItem(MODELS, DIVISIONS, { itemNo: '  aab-1002/c  ', dept: 'T47183' }))
    .toMatchObject({ status: 'found', model: { id: 5 } });
});

test('resolveMoItem คืน no-model เมื่อไม่มี item นี้ หรือมีแต่คนละ division', () => {
  expect(resolveMoItem(MODELS, DIVISIONS, { itemNo: 'ไม่มีจริง', dept: 'T47183' }).status).toBe('no-model');
  // AAB-1002/C มีเฉพาะ Mecha 2 — ถาม Mecha 1 ต้องไม่ไปหยิบของ Mecha 2 มาให้
  expect(resolveMoItem(MODELS, DIVISIONS, { itemNo: 'AAB-1002/C', dept: 'T47563' }).status).toBe('no-model');
  expect(resolveMoItem(MODELS, DIVISIONS, { itemNo: '', dept: 'T47183' }).status).toBe('no-model');
});

// dept แมพไม่ได้ = กรองไม่ได้ ห้ามเดาเอาตัวแรก ต้องยกให้คนเลือก
test('resolveMoItem คืน ambiguous เมื่อ dept แมพเป็น division ไม่ได้และ item ซ้ำ', () => {
  const r = resolveMoItem(MODELS, DIVISIONS, { itemNo: 'AAB-1001-01', dept: '' });
  expect(r.status).toBe('ambiguous');
  expect(r.model).toBeNull();
  expect(r.candidates).toHaveLength(2);
});

test('resolveMoItem ยังหาเจอถ้า dept แมพไม่ได้แต่ item ไม่ซ้ำ', () => {
  expect(resolveMoItem(MODELS, DIVISIONS, { itemNo: 'AAB-1002/C', dept: 'T99999' }))
    .toMatchObject({ status: 'found', model: { id: 5 } });
});

test('drawMatches ถือว่าตรงเมื่อข้างใดข้างหนึ่งว่าง', () => {
  expect(drawMatches({ drawing_no: 'DWG-1001' }, 'DWG-1001')).toBe(true);
  expect(drawMatches({ drawing_no: 'dwg-1001' }, ' DWG-1001 ')).toBe(true);
  expect(drawMatches({ drawing_no: 'DWG-1001' }, 'DWG-9999')).toBe(false);
  expect(drawMatches({ drawing_no: null }, 'DWG-1001')).toBe(true);
  expect(drawMatches({ drawing_no: 'DWG-1001' }, '')).toBe(true);
});
