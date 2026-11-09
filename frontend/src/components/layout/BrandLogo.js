// components/layout/BrandLogo.js — โลโก้ของระบบ (header / footer / หน้า login)
//
// ใส่โลโก้: วางไฟล์ไว้ที่ frontend/public/brand/logo.png (png/svg พื้นใส สูงประมาณ 52–62px)
//   ไม่ต้องแก้โค้ด · ถ้าใช้ .svg ให้เปลี่ยน LOGO_FILE ข้างล่าง
// ยังไม่มีไฟล์ = แสดงกล่อง "QC" สีน้ำเงินแทน (ไม่มีไอคอนรูปแตก)
import React, { useState } from 'react';

const LOGO_FILE = 'brand/Logo_minebeamitsumi.png';

const BrandLogo = ({ size, alt = 'Mecha QC Inspection' }) => {
  const [failed, setFailed] = useState(false);
  const cls = size === 'sm' ? ' mc-logo--sm' : '';

  if (failed) return <span className={`mc-logo-fallback${cls}`} aria-hidden="true">QC</span>;
  return (
    <img
      src={`${process.env.PUBLIC_URL}/${LOGO_FILE}`}
      alt={alt}
      className={`mc-logo${cls}`}
      onError={() => setFailed(true)}
    />
  );
};

export default BrandLogo;
