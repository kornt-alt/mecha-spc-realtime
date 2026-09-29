// frontend/src/utils/useSession.js — session ของการ login (utils/auth.js) แบบ React hook
//
// ใช้ซ่อน/โชว์ของที่ต้อง login นอกหน้า Master เช่นปุ่ม "แก้ค่าในใบเดิม" ที่หน้ารายงาน/SC
// ⚠️ ซ่อนปุ่มเป็นแค่ UI — ตัวกั้นจริงคือ requireLogin ฝั่ง backend
// ⚠️ token หมดอายุเฉย ๆ ไม่มี event ปุ่มค้างได้จนกดแล้วได้ 401 (apiCall ล้าง session → hook อัปเดต)
//    แยกไฟล์จาก auth.js เพื่อให้ auth.js ไม่ต้อง import React
import { useEffect, useState } from 'react';
import { getSession, onSessionChange } from './auth';

const useSession = () => {
  const [session, setSession] = useState(getSession);

  useEffect(() => {
    const off = onSessionChange(setSession);
    // login/logout จากแท็บอื่น (เช่น login ที่หน้า Master อีกแท็บ) — onSessionChange รู้แค่ในแท็บนี้
    const onStorage = (e) => { if (e.key === null || e.key === 'spc.auth') setSession(getSession()); };
    window.addEventListener('storage', onStorage);
    return () => { off(); window.removeEventListener('storage', onStorage); };
  }, []);

  return session;
};

export default useSession;
