// components/layout/SiteFooter.js — footer ของธีมมาตรฐาน แบบแถบเดียว
//
// ⚠️ เตี้ยกว่าต้นแบบ ENG_MECHA2 โดยตั้งใจ — หน้าจอหน้าไลน์ใช้ทุกพิกเซลกับใบตรวจ ไม่มีลิงก์ซ้ำกับเมนูด้านบน
import React from 'react';
import { Container } from 'react-bootstrap';
import BrandLogo from './BrandLogo';

const SiteFooter = () => (
  <footer className="mc-footer mc-footer--slim">
    <Container fluid className="mc-footer__bottom mc-bar-container">
      <span className="mc-footer__brand mb-0">
        <BrandLogo size="sm" />
        <span>© {new Date().getFullYear()} Mecha QC Inspection · Mecha Parts Lopburi 1</span>
      </span>
      <span>พัฒนาโดย <b>กรณ์</b></span>
    </Container>
  </footer>
);

export default SiteFooter;
