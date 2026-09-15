// origin ของ backend
// production: ค่าว่าง = origin เดียวกับหน้าเว็บ (Apache proxy ให้)
// dev แยกพอร์ต: ตั้ง REACT_APP_API_ORIGIN=http://localhost:5000 ใน frontend/.env.development
// ห้ามใส่ /Mecha-Spc-Realtime ลงในค่านี้ — prefix ถูกต่อให้ตอนใช้งาน
export const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || '';

// prefix ที่แอปถูก mount ไว้ ต้องตรงกับ backend, homepage และ Router basename
export const APP_BASE = '/Mecha-Spc-Realtime';
