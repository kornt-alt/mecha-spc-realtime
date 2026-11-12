// utils/machineItems.js — กรองตัวเลือก "เครื่องจักร ↔ item ที่รันได้" (pure)
//
// คู่เครื่อง↔item มาจากระบบ Drawing Digital (backend/services/drawingSync.js → ตาราง machine_items)
// ส่งมากับ /master/lookups เป็น machineItems = [[machine_id, model_id], …] + machines[].allow_all_items
//
// ⚠️ เป็นตัวช่วยเลือก ไม่ใช่ตัวกั้น — server ไม่ได้ปฏิเสธคู่ที่ไม่ได้ผูก (เครื่องใหม่ที่ Drawing ยังไม่ผูกต้องยังตรวจได้)
// ⚠️ ตัวที่เลือกไว้แล้ว (keepId) อยู่ในลิสต์เสมอ — ตัดทิ้งแล้วช่องว่าง / เปลี่ยน item ให้เอง = ค่าที่กรอกทั้งใบหาย (กฎ StationBar)
// ⚠️ กรองแล้วว่าง = คืนลิสต์เดิม (ดีกว่าเลือกอะไรไม่ได้เลย — หลักเดียวกับ scopeToDivision)
// เครื่อง allow_all_items = 1 (ค่าเริ่ม · เครื่องที่ไม่ได้มาจาก Drawing / Mecha 2) = รันได้ทุก item

const allowsAll = (machine) => machine?.allow_all_items === undefined || machine?.allow_all_items === null
  || Number(machine.allow_all_items) === 1;

const keep = (list, filtered, keepId) => {
  if (!keepId || filtered.some((r) => String(r.id) === String(keepId))) return filtered;
  const picked = list.find((r) => String(r.id) === String(keepId));
  return picked ? [picked, ...filtered] : filtered;
};

// item ที่เครื่องนี้รันได้ — คืน { list, filtered } (filtered = กรองจริงไหม ให้หน้าจอบอก)
export const itemsForMachine = (models, machine, machineItems = [], keepId = '') => {
  if (!machine || allowsAll(machine)) return { list: models, filtered: false };
  const ids = new Set(machineItems.filter(([mid]) => String(mid) === String(machine.id)).map(([, iid]) => String(iid)));
  const list = models.filter((m) => ids.has(String(m.id)));
  if (list.length === 0) return { list: models, filtered: false };
  return { list: keep(models, list, keepId), filtered: true };
};

// เครื่องที่รัน item นี้ได้ (เครื่อง allow-all ผ่านเสมอ)
export const machinesForItem = (machines, modelId, machineItems = [], keepId = '') => {
  if (!modelId) return { list: machines, filtered: false };
  const ids = new Set(machineItems.filter(([, iid]) => String(iid) === String(modelId)).map(([mid]) => String(mid)));
  const list = machines.filter((m) => allowsAll(m) || ids.has(String(m.id)));
  if (list.length === 0 || list.length === machines.length) return { list: machines, filtered: false };
  return { list: keep(machines, list, keepId), filtered: true };
};

// คู่นี้ผูกกันใน Drawing ไหม — false เฉพาะเครื่องที่ผูกแบบเจาะจงแล้วไม่มี item นี้ (ไว้ขึ้นคำเตือนเบา ๆ)
export const isRunnable = (machine, modelId, machineItems = []) => {
  if (!machine || !modelId || allowsAll(machine)) return true;
  return machineItems.some(([mid, iid]) => String(mid) === String(machine.id) && String(iid) === String(modelId));
};
