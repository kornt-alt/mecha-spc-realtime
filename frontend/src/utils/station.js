// frontend/src/utils/station.js — จำ "สถานี" ของเครื่องนี้ไว้ใน localStorage
//
// เครื่องหนึ่งเครื่องยืนตรวจรุ่นเดิม เครื่องจักรเดิม คนเดิม ทั้งกะ การให้เลือกใหม่
// ทุกครั้งที่เปิดหน้าคือ 4 คลิกที่ทิ้งเปล่าทุกใบ — จำไว้แล้วเปิดมากรอกค่าได้เลย
//
// ⚠️ อ่าน/เขียน localStorage ต้องห่อ try/catch ทั้งคู่เสมอ
//    โหมด private / นโยบายบล็อกคุกกี้ / โควตาเต็ม ทำให้ throw ได้ทั้งตอนอ่านและตอนเขียน
//    ใบตรวจต้องเปิดใช้งานได้แม้จำสถานีไม่ได้ — ห้ามปล่อยให้จอขาว
//
// ⚠️ ค่าที่จำไว้เป็น id ที่ชี้ไป master ซึ่งถูกปิดใช้งาน/ลบทีหลังได้
//    ต้องผ่าน reconcile() เทียบกับรายการที่โหลดมาจริงก่อนใช้เสมอ ไม่งั้น <Form.Select>
//    จะมี value ที่ไม่มี <option> รองรับ กลายเป็นช่องว่างที่กดบันทึกไม่ได้และไม่บอกว่าทำไม

import { SHIFTS } from './config';

const KEY = 'spc.station';

// ⚠️ เทียบกับ SHIFTS ไม่ใช่ hardcode 'M'/'N' — ของเดิมเช็คสองค่านั้นตรง ๆ พอเพิ่มกะ
//    A/B/C/D เข้ามา กะที่จำไว้จะถูกโยนทิ้งเงียบ ๆ ทุกครั้งที่เปิดหน้า
const isShift = (v) => SHIFTS.some((s) => s.code === v);

const EMPTY = { modelId: '', machineId: '', inspectorId: '', shift: '' };

const asId = (v) => (v === null || v === undefined || v === '' ? '' : String(v));

export const readStation = () => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
    return {
      modelId: asId(parsed.modelId),
      machineId: asId(parsed.machineId),
      inspectorId: asId(parsed.inspectorId),
      shift: isShift(parsed.shift) ? parsed.shift : '',
    };
  } catch {
    // JSON เสีย หรืออ่าน storage ไม่ได้ — เริ่มใหม่เงียบ ๆ
    return { ...EMPTY };
  }
};

export const writeStation = (station) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      modelId: asId(station?.modelId),
      machineId: asId(station?.machineId),
      inspectorId: asId(station?.inspectorId),
      shift: station?.shift ?? '',
    }));
  } catch {
    // เขียนไม่ได้ก็ไม่เป็นไร แค่ต้องเลือกใหม่รอบหน้า
  }
};

export const clearStation = () => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ไม่มีอะไรให้ทำต่อ */
  }
};

// ตัด id ที่ไม่มีอยู่ในรายการที่โหลดมาจริงทิ้ง (ถูกปิดใช้งานหรือถูกลบไปแล้ว)
// รับ list เป็น array ของ object ที่มี id
export const reconcileStation = (station, { models = [], machines = [], inspectors = [] } = {}) => {
  const has = (list, id) => id !== '' && list.some((row) => String(row.id) === id);
  return {
    modelId: has(models, station.modelId) ? station.modelId : '',
    machineId: has(machines, station.machineId) ? station.machineId : '',
    inspectorId: has(inspectors, station.inspectorId) ? station.inspectorId : '',
    shift: station.shift,
  };
};

// สถานีพร้อมใช้งานเมื่อครบทุกช่องที่ backend บังคับตอน POST /api/inspections
export const isStationReady = (station) =>
  Boolean(station?.modelId && station?.machineId && station?.inspectorId && station?.shift);
