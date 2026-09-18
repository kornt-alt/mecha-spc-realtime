import React from 'react';
import {
  BrowserRouter as Router, Routes, Route, Link, NavLink, useSearchParams,
} from 'react-router-dom';
import { Navbar, Nav, Container } from 'react-bootstrap';

import InspectionSheet from './components/InspectionSheet';
import Dashboard from './components/Dashboard';
import ReportPage from './components/ReportPage';
import MasterSetup from './components/MasterSetup';
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
const MainNav = () => {
  const [params] = useSearchParams();
  const modelId = params.get('model') || readStation().modelId;

  return (
    <Nav className="me-auto">
      <Nav.Link as={NavLink} to="/" end>ใบตรวจ</Nav.Link>
      <Nav.Link as={NavLink} to={modelHref('/dashboard', modelId)}>Dashboard</Nav.Link>
      <Nav.Link as={NavLink} to={modelHref('/report', modelId)}>รายงาน</Nav.Link>
      <Nav.Link as={NavLink} to="/master">ตั้งค่า Master</Nav.Link>
    </Nav>
  );
};

const App = () => (
  <Router basename={APP_BASE}>
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
      <Route path="/report" element={<ReportPage />} />
      <Route path="/master" element={<MasterSetup />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </Router>
);

export default App;
