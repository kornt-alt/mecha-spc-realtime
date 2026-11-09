// components/layout/PageTransition.js — เปลี่ยนหน้าแบบ fade + เลื่อนขึ้น (animation อยู่ใน theme.css: .mc-page)
//
// key = pathname → หน้าใหม่ mount พร้อม animation ทุกครั้งที่ path เปลี่ยน
// query string ไม่นับ (กรอง/แบ่งหน้าแล้วไม่กระพริบ) · /bom/loose-part/1 → /2 = remount (state เคลียร์)
// ⚠️ keyframes จบที่ transform: none — ค้าง transform ไว้จะทำให้ position: sticky/fixed ข้างในเพี้ยน
import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const PageTransition = ({ children }) => {
  const { pathname } = useLocation();

  // เปลี่ยนหน้าแล้วขึ้นบนสุด — 'instant' ไม่ให้ scroll-behavior: smooth ไหลยาวจากท้ายหน้า
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return <div key={pathname} className="mc-page">{children}</div>;
};

export default PageTransition;
