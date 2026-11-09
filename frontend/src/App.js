import React, { useCallback, useEffect, useState } from 'react';
import {
  BrowserRouter as Router, Routes, Route, Link, NavLink, useSearchParams,
} from 'react-router-dom';
import { Navbar, Nav, Container, Badge } from 'react-bootstrap';

import InspectionSheet from './components/InspectionSheet';
import Dashboard from './components/Dashboard';
import ReportPage from './components/ReportPage';
import ScSheet from './components/ScSheet';
import MasterSetup from './components/MasterSetup';
import RequireLogin from './components/RequireLogin';
import SetupJobs from './components/SetupJobs';
import { apiCall } from './utils/api';
import { getSession, hasRole, setSession } from './utils/auth';
import useSession from './utils/useSession';
import { on } from './utils/socket';
import { APP_BASE } from './utils/config';
import { readStation } from './utils/station';
import { modelHref } from './utils/useModelParam';

// ⚠️ ไม่ import CSS ที่นี่ — ทั้งแอป import ที่ src/index.js ที่เดียวเพื่อคุมลำดับ
//    (ของเดิม import ซ้ำที่นี่ด้วย ทำให้ลำดับที่ webpack ปล่อยออกมาเดาไม่ได้)

const NotFound = () => (
  <Container className="text-center mt-5">
    <h2>ไม่พบหน้านี้</h2>
    <Link to="/">กลับหน้าหลัก</Link>
  </Container>
);

// เมนูพารุ่นที่กำลังดูอยู่ข้ามหน้าไปด้วย — ของเดิมต้องเลือกรุ่นใหม่ทุกครั้งที่เปลี่ยนหน้า
// ถ้า URL ยังไม่มี ?model= ให้ใช้รุ่นของสถานีที่เครื่องนี้จำไว้
// ตัวเลขแดงบนเมนู Set up — QC: งานที่รอรับ · PD: งานที่ QC ตีกลับ (ตัวนับคำนวณที่ server)
// ⚠️ ยิงเฉพาะคนที่ login เป็น PD/QC — /check-jobs ต้อง login ยิงตอนไม่ได้ login ได้ 401 เปล่า ๆ
const SetupBadge = () => {
  const session = useSession();
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

  return n > 0 ? <Badge bg="danger" pill className="ms-1">{n}</Badge> : null;
};

// เติม roles/ผู้ตรวจของ session ที่จำไว้ให้เป็นค่าล่าสุดครั้งเดียวตอนเปิดแอป — session ที่ login ก่อนระบบมี role
// ไม่มี roles เลย ปุ่มของ ADMIN (แก้ค่า) จะหายจนกว่าจะเข้าหน้า Master · 401 = apiCall ล้าง session ให้เอง
const SessionRefresh = () => {
  useEffect(() => {
    if (!getSession()) return;
    apiCall('/auth/me')
      .then((r) => { const s = getSession(); if (s && r?.user) setSession({ ...s, user: r.user }); })
      .catch(() => {});
  }, []);
  return null;
};

const MainNav = () => {
  const [params] = useSearchParams();
  const modelId = params.get('model') || readStation().modelId;

  return (
    <Nav className="me-auto">
      <Nav.Link as={NavLink} to="/" end>ใบตรวจ</Nav.Link>
      <Nav.Link as={NavLink} to={modelHref('/dashboard', modelId)}>Dashboard</Nav.Link>
      <Nav.Link as={NavLink} to={modelHref('/sc', modelId)}>SC Chart</Nav.Link>
      <Nav.Link as={NavLink} to={modelHref('/report', modelId)}>รายงาน</Nav.Link>
      <Nav.Link as={NavLink} to="/setup">Set up / Last Piece<SetupBadge /></Nav.Link>
      <Nav.Link as={NavLink} to="/master">ตั้งค่า Master</Nav.Link>
    </Nav>
  );
};

const App = () => (
  <Router basename={APP_BASE}>
    <SessionRefresh />
    <Navbar variant="dark" expand="lg" className="app-nav">
      <Container fluid>
        <Navbar.Brand as={Link} to="/">Mecha QC Inspection</Navbar.Brand>
        <Navbar.Toggle aria-controls="main-nav" />
        <Navbar.Collapse id="main-nav">
          <MainNav />
        </Navbar.Collapse>
      </Container>
    </Navbar>

    <Routes>
      <Route path="/" element={<InspectionSheet />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/sc" element={<ScSheet />} />
      <Route path="/report" element={<ReportPage />} />
      {/* หน้าเดียวที่ต้อง login — กั้นที่ route ไม่ใช่ใน MasterSetup (ดู RequireLogin.js) */}
      <Route path="/master" element={<RequireLogin roles={['ADMIN']}><MasterSetup /></RequireLogin>} />
      {/* งานส่งต่อ PD → QC — ต้อง login เป็น PD หรือ QC (ADMIN เข้าดูได้) */}
      <Route path="/setup" element={(
        <RequireLogin roles={['PD', 'QC', 'ADMIN']} title="เข้าสู่ระบบ — งาน Set up / Last Piece">
          <SetupJobs />
        </RequireLogin>
      )} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </Router>
);

export default App;
