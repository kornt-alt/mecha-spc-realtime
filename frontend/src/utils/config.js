// origin ของ backend
// production: ค่าว่าง = origin เดียวกับหน้าเว็บ (Apache proxy ให้)
// dev แยกพอร์ต: ตั้ง REACT_APP_API_ORIGIN=http://localhost:5000 ใน frontend/.env.development
// ห้ามใส่ /Mecha-Spc-Realtime ลงในค่านี้ — prefix ถูกต่อให้ตอนใช้งาน
export const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || '';

// prefix ที่แอปถูก mount ไว้ ต้องตรงกับ backend, homepage และ Router basename
export const APP_BASE = '/Mecha-Spc-Realtime';

// กะการทำงาน — ⚠️ ต้องตรงกับ ENUM ของคอลัมน์ inspections.shift ใน schema.sql
// และกับ SHIFT_CODES ใน backend/services/judgment.js · แก้ที่ไหนต้องแก้ครบทั้งสามที่
// ไม่งั้นเลือกได้บนหน้าจอแต่กดบันทึกแล้ว server ปฏิเสธ
export const SHIFTS = [
  { code: 'M', label: 'M' },
  { code: 'N', label: 'N' },
  { code: 'A', label: 'A' },
  { code: 'B', label: 'B' },
  { code: 'C', label: 'C' },
  { code: 'D', label: 'D' },
];

// ⚠️ เคยมี currentShift() เดากะจากนาฬิกามาเติมให้ในฟอร์ม ถอดออกแล้วโดยตั้งใจ —
//    พอมี 6 กะการเดาจากเวลาเป็นไปไม่ได้ (10 โมงเป็นได้ทั้ง M และ A) และกะที่เดาผิด
//    คือหลักฐานการตรวจที่ผิดโดยไม่มีอะไรทัก · ให้คนเลือกเอง แล้ว utils/station.js
//    จำไว้ในเครื่อง จึงไม่ได้เพิ่มคลิกทุกใบ · ฝั่ง server ก็ไม่เดาให้เหมือนกัน (ปฏิเสธไปเลย)
