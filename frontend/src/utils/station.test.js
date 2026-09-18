// เทส utils/station.js — การจำสถานีไว้ในเครื่อง
//
// สองเรื่องที่ต้องไม่พัง เพราะพังแล้วใบตรวจเปิดไม่ได้เลย:
//   1. อ่าน localStorage ไม่ได้ / ข้อมูลเสีย ต้องคืนค่าว่าง ไม่ใช่ throw
//   2. id ที่จำไว้ชี้ไป master ที่ถูกปิดใช้งานไปแล้ว ต้องถูกตัดทิ้ง
import { readStation, writeStation, clearStation, reconcileStation, isStationReady } from './station';

beforeEach(() => localStorage.clear());

test('ยังไม่เคยบันทึก → คืนค่าว่างครบทุกช่อง', () => {
  expect(readStation()).toEqual({ modelId: '', machineId: '', inspectorId: '', shift: '' });
});

test('เขียนแล้วอ่านกลับได้ และ id ถูกเก็บเป็น string เสมอ', () => {
  writeStation({ modelId: 12, machineId: 3, inspectorId: 7, shift: 'N' });
  expect(readStation()).toEqual({ modelId: '12', machineId: '3', inspectorId: '7', shift: 'N' });
});

test('ข้อมูลใน localStorage เสีย → ไม่ throw คืนค่าว่างแทน', () => {
  localStorage.setItem('spc.station', '{ไม่ใช่ JSON');
  expect(() => readStation()).not.toThrow();
  expect(readStation().modelId).toBe('');
});

test('อ่าน localStorage ไม่ได้เลย (โหมด private) → ไม่ throw', () => {
  const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  expect(() => readStation()).not.toThrow();
  expect(readStation().shift).toBe('');
  spy.mockRestore();
});

test('เขียนไม่ได้ (โควตาเต็ม) → กลืนไว้ ไม่ทำให้หน้าจอพัง', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  expect(() => writeStation({ modelId: '1' })).not.toThrow();
  spy.mockRestore();
});

test('กะที่ไม่ใช่ M หรือ N ถือว่าไม่มีค่า', () => {
  localStorage.setItem('spc.station', JSON.stringify({ modelId: '1', shift: 'X' }));
  expect(readStation().shift).toBe('');
});

test('reconcile ตัด id ที่ไม่มีอยู่ในรายการจริงทิ้ง แต่เก็บกะไว้', () => {
  const station = { modelId: '1', machineId: '99', inspectorId: '5', shift: 'M' };
  const out = reconcileStation(station, {
    models: [{ id: 1 }],
    machines: [{ id: 3 }],        // เครื่อง 99 ถูกปิดใช้งานไปแล้ว
    inspectors: [{ id: 5 }],
  });
  expect(out).toEqual({ modelId: '1', machineId: '', inspectorId: '5', shift: 'M' });
});

test('isStationReady ต้องครบทั้งสี่ช่อง', () => {
  expect(isStationReady({ modelId: '1', machineId: '2', inspectorId: '3', shift: 'M' })).toBe(true);
  expect(isStationReady({ modelId: '1', machineId: '2', inspectorId: '3', shift: '' })).toBe(false);
  expect(isStationReady(null)).toBe(false);
});

test('clearStation ลบของที่จำไว้', () => {
  writeStation({ modelId: '1', machineId: '2', inspectorId: '3', shift: 'M' });
  clearStation();
  expect(readStation().modelId).toBe('');
});
