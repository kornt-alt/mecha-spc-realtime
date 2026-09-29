// frontend/src/utils/useModelParam.js — เก็บ "รุ่นที่กำลังดู" ไว้ใน URL (?model=12)
//
// ของเดิมแต่ละหน้าถือ modelId เป็น useState ของตัวเอง เปลี่ยนหน้าทีต้องเลือกรุ่นใหม่ทุกรอบ
// และรีเฟรชแล้วหลุดกลับไปหน้าว่าง — ย้ายมาไว้ที่ URL แล้วลิงก์พารุ่นข้ามหน้าไปได้เลย
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readStation } from './station';

export const modelHref = (path, modelId) =>
  modelId ? `${path}?model=${encodeURIComponent(modelId)}` : path;

/**
 * ลิงก์ไปหน้า Master Setup พร้อมเตรียมของไว้ให้
 *
 *   masterHref({ modelId: 4 })                  → '/master?model=4'
 *   masterHref({ item, divisionId: 3 })         → '/master?item_no=…&item_name=…&…'
 *
 * ใช้ตอนหน้าใบตรวจเจอทางตัน (ไม่มี item นี้ / มีแต่ยังไม่มีจุดตรวจ) จะได้ไม่ต้องให้คน
 * ไปพิมพ์เองใหม่ทั้งที่ IPBASS เพิ่งบอกมาครบแล้ว — พิมพ์ใหม่ = เปิดช่องให้พิมพ์ผิด
 * ตรงจุดที่เป็นคีย์จับคู่ MO พอดี
 *
 * ⚠️ ชื่อ param ของ prefill ต้อง **ตรงชื่อคอลัมน์ DB เป๊ะ** เพราะปลายทางคือ `modelForm`
 *    ที่ถูกส่งเข้า `/master/add` ตรง ๆ และ `ALLOWED_COLUMNS` ตรวจด้วยชื่อคอลัมน์
 * ⚠️ `model` ใช้ชื่อเดิมที่ Dashboard / ReportPage ใช้อยู่ ไม่ตั้งชื่อใหม่
 *
 * @param {string|number} [modelId]     item ที่มีอยู่แล้ว — ให้หน้า Master เลือกค้างไว้
 * @param {object}        [item]        ผลจาก `moRowToItem()` ใช้ prefill ฟอร์มเพิ่ม item
 * @param {number|null}   [divisionId]  จาก `divisionIdByDept()` — null ได้ (แมพ dept ไม่ได้)
 */
export const masterHref = ({ modelId = '', item = null, divisionId = null } = {}) => {
  // URLSearchParams encode ค่าให้เอง — item_name เป็น free text จาก IPBASS และเลข item
  // จริงมี '/' ได้ (เช่น AAB-1002/C) ถ้าเจอ '&' หรือ '#' แล้วไม่ encode query จะขาดกลางทาง
  const q = new URLSearchParams();
  if (modelId) q.set('model', String(modelId));
  if (item?.itemNo) q.set('item_no', item.itemNo);
  if (item?.itemName) q.set('item_name', item.itemName);
  if (item?.draw) q.set('drawing_no', item.draw);
  if (divisionId) q.set('division_id', String(divisionId));

  const qs = q.toString();
  return qs ? `/master?${qs}` : '/master';
};

// ลิงก์ไปหน้า SC Chart (ฟอร์ม SP-QC-214C) ของจุดตรวจหนึ่งจุด — ?machine= / ?month= ว่าง = รวมทุกเครื่อง / เดือนนี้
export const scHref = ({ modelId, checkpointId, machineId = '', month = '' }) => {
  const q = new URLSearchParams();
  if (modelId) q.set('model', String(modelId));
  if (checkpointId) q.set('checkpoint', String(checkpointId));
  if (machineId) q.set('machine', String(machineId));
  if (month) q.set('month', month);
  return `/sc?${q.toString()}`;
};

// ชื่อ param ที่ใช้ prefill ฟอร์มเพิ่ม item — MasterSetup อ่านชุดนี้แล้วล้างทิ้ง
// export ไว้ให้ทั้งสองฝั่งอ้างลิสต์เดียวกัน เพิ่มฟิลด์แล้วจะได้ไม่ลืมอีกฝั่ง
export const PREFILL_KEYS = ['item_no', 'item_name', 'drawing_no', 'division_id'];

/**
 * เก็บค่าหนึ่งค่าไว้ใน query string — ตัวเดียวกับที่ ?model= ใช้
 *
 * แยกออกมาเพราะ Dashboard เก็บ "เครื่องที่กำลังดู" ไว้ที่ URL ด้วย (?machine=) ด้วยเหตุผล
 * เดียวกันเป๊ะ: จอหน้าไลน์บุ๊กมาร์กเครื่องของตัวเองไว้ได้ และรีเฟรชแล้วไม่หลุดกลับไปกราฟรวม
 *
 * @param {string} name ชื่อ param
 * @returns {[string, (value: string) => void]}
 */
export const useUrlParam = (name) => {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? '';

  const setValue = useCallback(
    (next) => {
      // ⚠️ อ่านค่าปัจจุบันจาก window.location.search ไม่ใช่ `prev` ของ react-router —
      //    react-router (7.6.2) ส่ง searchParams "ตัวใน closure" เข้า updater ไม่ใช่ค่าล่าสุด
      //    เรียก setter สองตัวติดกัน (เช่น SC: setModelId(v); setCheckpointId('')) ตัวหลังจะสร้าง URL
      //    จากค่าก่อนตัวแรก แล้วทับ ?model= ใหม่ทิ้ง = item เด้งกลับตัวเดิม · navigate ของ BrowserRouter
      //    เขียน history แบบ synchronous window.location จึงเป็นค่าล่าสุดเสมอ
      setParams(
        () => {
          const q = new URLSearchParams(window.location.search);
          if (next) q.set(name, String(next));
          else q.delete(name);
          return q;
        },
        // replace: ไม่งั้นเปลี่ยนรุ่นทีเป็น history entry ที ปุ่ม Back เดินถอยทีละรุ่น
        // preventScrollReset: Dashboard เป็นกริดกราฟยาว ๆ ไม่งั้นเด้งขึ้นหัวทุกครั้ง
        { replace: true, preventScrollReset: true }
      );
    },
    [setParams, name]
  );

  return [value, setValue];
};

/**
 * @param {boolean} fallbackToStation ถ้า URL ไม่มี ?model= ให้ใช้รุ่นของสถานีที่จำไว้
 * @returns {[string, (id: string) => void]}
 */
export const useModelParam = (fallbackToStation = true) => {
  const [fromUrl, setModelId] = useUrlParam('model');
  const modelId = fromUrl || (fallbackToStation ? readStation().modelId : '');

  return [modelId, setModelId];
};

export default useModelParam;
