// origin ของ backend
// production: ค่าว่าง = origin เดียวกับหน้าเว็บ (Apache proxy ให้)
// dev แยกพอร์ต: ตั้ง REACT_APP_API_ORIGIN=http://localhost:5000 ใน frontend/.env.development
// ห้ามใส่ /Mecha-Spc-Realtime ลงในค่านี้ — prefix ถูกต่อให้ตอนใช้งาน
export const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || '';

// prefix ที่แอปถูก mount ไว้ ต้องตรงกับ backend, homepage และ Router basename
export const APP_BASE = '/Mecha-Spc-Realtime';

// กะการทำงาน — ต้องตรงกับ ENUM('M','N') ของคอลัมน์ inspections.shift ฝั่ง DB
// M = 07:00-18:59, N = 19:00-06:59 (ใช้ให้ตรงกับที่ QC_MECHA2 ใช้อยู่)
export const SHIFTS = [
  { code: 'M', label: 'กะเช้า (M)' },
  { code: 'N', label: 'กะดึก (N)' },
];

// เดากะจากเวลาปัจจุบัน — ต้องให้ผลตรงกับ shiftFromDate() ใน backend/services/judgment.js
// (ฝั่ง server เป็นตัวตัดสินจริงถ้า client ไม่ส่งมา ตรงนี้แค่เลือกค่าเริ่มต้นให้ในฟอร์ม)
export const currentShift = (d = new Date()) => (d.getHours() >= 7 && d.getHours() < 19 ? 'M' : 'N');
