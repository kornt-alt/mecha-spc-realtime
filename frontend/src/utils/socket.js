import { io } from 'socket.io-client';
import { API_ORIGIN, APP_BASE } from './config';

// Socket singleton ใช้ร่วมกันทั้งแอป
// path ต้องตรงกับที่ตั้งไว้ฝั่ง server ใน backend/index.js และกับ Apache config
const socket = io(API_ORIGIN || undefined, {
  path: `${APP_BASE}/socket.io`,
  reconnection: true,
});

// ── room แยกตามรุ่น ────────────────────────────────────────────────────────
//
// server ส่ง inspection_saved / baseline_updated เข้า room ของรุ่นเท่านั้น
// เครื่องที่ดูรุ่นอื่นอยู่จะไม่โดนรบกวน (ของเดิม broadcast ให้ทุกเครื่องทุกครั้ง)
//
// ⚠️ ต้อง join ใหม่ทุกครั้งที่ reconnect ด้วย — ฝั่ง server จำ room ไม่ได้หลังสายหลุด
//    เก็บรุ่นปัจจุบันไว้แล้ว join ซ้ำใน event 'connect'
let currentModelId = null;

socket.on('connect', () => {
  if (currentModelId !== null) socket.emit('join_model', currentModelId);
});

export const joinModel = (modelId) => {
  const id = Number(modelId);
  if (!Number.isInteger(id)) return;
  currentModelId = id;
  socket.emit('join_model', id);
};

export const leaveModel = (modelId) => {
  const id = Number(modelId);
  if (!Number.isInteger(id)) return;
  if (currentModelId === id) currentModelId = null;
  socket.emit('leave_model', id);
};

// ⚠️ ต้องส่ง handler ตัวเดิมเข้า off เสมอ ไม่งั้นลบ listener ของ component อื่นไปด้วย
export const on = (event, handler) => {
  socket.on(event, handler);
  return () => socket.off(event, handler);
};

export default socket;
