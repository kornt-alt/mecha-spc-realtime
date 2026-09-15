import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Navbar, Nav, Container } from 'react-bootstrap';

import MasterSetup from './components/MasterSetup';
import InputStation from './components/InputStation';
import Dashboard from './components/Dashboard';
import { API_ORIGIN, APP_BASE } from './utils/config';

import './index.css';
import 'bootstrap/dist/css/bootstrap.min.css';

const BACKEND_URL = `${API_ORIGIN}${APP_BASE}`;

const API_BASE = `${BACKEND_URL}/api`;

const apiCall = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');

  const { body, ...restOptions } = options;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...restOptions,
    body: body ? JSON.stringify(body) : undefined,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, config);

  let data;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text;
  }

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = `${APP_BASE}/`;
      throw new Error('Session expired');
    }
    // backend ตอบ error มาในรูป { error: "..." } ไม่ใช่ { message: "..." }
    // ถ้าอ่านผิด key จะได้ [object Object] แทนข้อความจริง
    const reason =
      data?.error ||
      data?.message ||
      (typeof data === 'string' && data ? data : `Request failed (${response.status})`);
    throw new Error(reason);
  }
  return data;
};

const NotFound = () => (
  <Container className="text-center mt-5">
    <h2>404 - Page Not Found</h2>
    <p>Sorry kub. Don't Have This Page eiei</p>
    <Link to="/">กลับหน้าหลัก</Link>
  </Container>
);

const App = () => {
  return (
    <Router basename={APP_BASE}>
      <Navbar bg="dark" variant="dark" expand="lg">
        <Container>
          <Navbar.Brand as={Link} to="/">Mecha SPC Realtime</Navbar.Brand>
          <Nav className="me-auto">
            <Nav.Link as={Link} to="/">Dashboard</Nav.Link>
            <Nav.Link as={Link} to="/input">Input Station</Nav.Link>
            <Nav.Link as={Link} to="/master">Master Setup</Nav.Link>
          </Nav>
        </Container>
      </Navbar>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/input" element={<InputStation />} />
        <Route path="/master" element={<MasterSetup />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
};

export default App;
export { apiCall, API_BASE, BACKEND_URL };
