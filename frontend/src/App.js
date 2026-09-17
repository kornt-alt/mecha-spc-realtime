import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, NavLink } from 'react-router-dom';
import { Navbar, Nav, Container } from 'react-bootstrap';

import InspectionSheet from './components/InspectionSheet';
import Dashboard from './components/Dashboard';
import ReportPage from './components/ReportPage';
import MasterSetup from './components/MasterSetup';
import { APP_BASE } from './utils/config';

import './index.css';
import 'bootstrap/dist/css/bootstrap.min.css';

const NotFound = () => (
  <Container className="text-center mt-5">
    <h2>404 — ไม่พบหน้านี้</h2>
    <Link to="/">กลับหน้าหลัก</Link>
  </Container>
);

const App = () => (
  <Router basename={APP_BASE}>
    <Navbar bg="dark" variant="dark" expand="lg">
      <Container fluid>
        <Navbar.Brand as={Link} to="/">Mecha QC Inspection</Navbar.Brand>
        <Navbar.Toggle aria-controls="main-nav" />
        <Navbar.Collapse id="main-nav">
          <Nav className="me-auto">
            <Nav.Link as={NavLink} to="/" end>ใบตรวจ</Nav.Link>
            <Nav.Link as={NavLink} to="/dashboard">Dashboard</Nav.Link>
            <Nav.Link as={NavLink} to="/report">รายงาน</Nav.Link>
            <Nav.Link as={NavLink} to="/master">ตั้งค่า Master</Nav.Link>
          </Nav>
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
