// components/layout/SiteHeader.js — header 2 ชั้นตามธีมมาตรฐาน (skill korn-ui-theme · ต้นแบบ ENG_MECHA2)
//
// ชั้นบน: โหมดสว่าง/มืด · ผู้ใช้ + บทบาท · ออกจากระบบ (login มีเฉพาะหน้า Master / Set up — ไม่มีปุ่ม login กลาง)
// ชั้นหลัก: โลโก้ + เมนูกลุ่ม "ตรวจ" / "วิเคราะห์" / "ตั้งค่า Master"
// เลื่อนลง → mc-header--compact (แถบบนพับ) · ต้องอยู่ใน <Router>
//
// ⚠️ เมนูพา ?model= ที่กำลังดูข้ามหน้าไปด้วย (ไม่มีใน URL = รุ่นของสถานีที่เครื่องนี้จำไว้) — ของเดิมก่อนธีมใหม่ก็ทำแบบนี้
// ⚠️ "ตั้งค่า Master" ซ่อนเฉพาะคนที่ login แล้วแต่ไม่ใช่ ADMIN — ยังไม่ login ต้องเห็น เพราะกล่อง login ของ ADMIN อยู่ที่หน้านั้น
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Navbar, Nav, Container, NavDropdown } from 'react-bootstrap';

import BrandLogo from './BrandLogo';
import ThemeToggle from './ThemeToggle';
import Icon from './Icon';
import { apiCall } from '../../utils/api';
import { hasRole, logout, rolesOf } from '../../utils/auth';
import useSession from '../../utils/useSession';
import { on } from '../../utils/socket';
import { readStation } from '../../utils/station';
import { modelHref } from '../../utils/useModelParam';

// ⚠️ เกณฑ์ย่อ/คลายต่างกัน (hysteresis) — แถบบนพับแล้วหน้าเตี้ยลง ถ้าใช้เกณฑ์เดียว scroll ที่ขยับตามจะสลับไปมาจนกระพริบ
const COMPACT_AT = 80;
const EXPAND_AT = 10;

const useCompactOnScroll = () => {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        setCompact((c) => (c ? y > EXPAND_AT : y > COMPACT_AT));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);
  return compact;
};

// ตัวเลขแดงของงาน Set up — QC: งานที่รอรับ · PD: งานที่ QC ตีกลับ (ตัวนับคำนวณที่ server)
// ⚠️ ยิงเฉพาะคนที่ login เป็น PD/QC — /check-jobs ต้อง login ยิงตอนไม่ได้ login ได้ 401 เปล่า ๆ · พังเงียบ = ไม่โชว์
const useSetupCount = (session) => {
  const isQC = hasRole(session, 'QC');
  const isPD = hasRole(session, 'PD');
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    if (!isQC && !isPD) { setN(0); return; }
    apiCall('/check-jobs/counts')
      .then((c) => setN((isQC ? c.total.waiting_qc : 0) + (isPD ? c.total.pd_returned : 0)))
      .catch(() => setN(0));
  }, [isQC, isPD]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => on('check_job_updated', load), [load]);
  return n;
};

const Count = ({ n, title }) => (n > 0 ? <span className="mc-topbar__badge mc-nav__badge" title={title}>{n}</span> : null);

const MenuItem = ({ to, title, desc, active, badge }) => (
  <NavDropdown.Item as={Link} to={to} active={active}>
    <span className="mc-dd-title">{title}</span>{badge}
    {desc && <small>{desc}</small>}
  </NavDropdown.Item>
);

const ROLE_LABEL = { ADMIN: 'Admin', PD: 'PD', QC: 'QC' };

const SiteHeader = () => {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const compact = useCompactOnScroll();
  const session = useSession();
  const setupCount = useSetupCount(session);
  const modelId = params.get('model') || readStation().modelId;
  const user = session?.user;
  const roles = rolesOf(session);
  const showMaster = !session || hasRole(session, 'ADMIN');

  const inspectActive = pathname === '/' || pathname === '/setup';
  const analyseActive = ['/dashboard', '/sc', '/report'].includes(pathname);
  const setupBadge = <Count n={setupCount} title="งาน Set up ที่รอคุณ" />;

  return (
    <header className={`mc-header${compact ? ' mc-header--compact' : ''}`}>
      <div className="mc-topbar">
        <Container fluid className="mc-bar-container">
          <ThemeToggle />
          {user && (
            <>
              <span className="mc-topbar__user">
                <Icon name="user" size={14} /> {user.display_name || user.username}
                {roles.map((r) => <span key={r} className="mc-topbar__role">{ROLE_LABEL[r] ?? r}</span>)}
              </span>
              <button type="button" onClick={logout}><Icon name="logout" size={14} /> ออกจากระบบ</button>
            </>
          )}
        </Container>
      </div>

      <div className="mc-mainbar">
        <Navbar expand="lg">
          <Container fluid className="mc-bar-container">
            <Navbar.Brand as={Link} to="/" className="mc-brand">
              <BrandLogo />
              <span className="mc-brand__text">
                <span className="mc-brand__title">Mecha QC Inspection</span>
                <span className="mc-brand__sub">ใบตรวจ · Control chart · Set up</span>
              </span>
            </Navbar.Brand>
            <Navbar.Toggle aria-controls="mc-main-nav" />
            <Navbar.Collapse id="mc-main-nav">
              <Nav className="ms-auto mc-nav">
                <NavDropdown
                  id="mc-nav-inspect"
                  className={inspectActive ? 'mc-active' : ''}
                  title={<>ตรวจ{setupBadge}</>}
                >
                  <MenuItem to="/" title="ใบตรวจตามรอบ" desc="สแกน MO แล้วกรอกค่าวัด" active={pathname === '/'} />
                  <MenuItem to="/setup" title="Set up / Last Piece" desc="PD ตรวจ → ส่ง QC ยืนยัน" active={pathname === '/setup'} badge={setupBadge} />
                </NavDropdown>
                <NavDropdown id="mc-nav-analyse" title="วิเคราะห์" className={analyseActive ? 'mc-active' : ''}>
                  <MenuItem to={modelHref('/dashboard', modelId)} title="Dashboard" desc="สถานะทุกจุดตรวจของ item" active={pathname === '/dashboard'} />
                  <MenuItem to={modelHref('/sc', modelId)} title="SC Chart" desc="ฟอร์ม SC ราย 1 จุด × เดือน + Event Log" active={pathname === '/sc'} />
                  <MenuItem to={modelHref('/report', modelId)} title="รายงาน" desc="สรุป Cp/Cpk · ตาราง Input · Excel" active={pathname === '/report'} />
                </NavDropdown>
                {showMaster && (
                  <Nav.Link as={Link} to="/master" className={pathname === '/master' ? 'mc-active' : ''}>ตั้งค่า Master</Nav.Link>
                )}
              </Nav>
            </Navbar.Collapse>
          </Container>
        </Navbar>
      </div>
    </header>
  );
};

export default SiteHeader;
