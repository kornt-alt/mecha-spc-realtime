import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Container } from 'react-bootstrap';

import InspectionSheet from './components/InspectionSheet';
import CategoryHome from './components/CategoryHome';
import Dashboard from './components/Dashboard';
import ReportPage from './components/ReportPage';
import ScSheet from './components/ScSheet';
import MasterSetup from './components/MasterSetup';
import RequireLogin from './components/RequireLogin';
import SetupJobs from './components/SetupJobs';
import { apiCall } from './utils/api';
import SiteHeader from './components/layout/SiteHeader';
import SiteFooter from './components/layout/SiteFooter';
import PageTransition from './components/layout/PageTransition';
import { getSession, setSession } from './utils/auth';
import { APP_BASE } from './utils/config';
import { useFollowSystemTheme } from './utils/theme';

// ⚠️ ไม่ import CSS ที่นี่ — ทั้งแอป import ที่ src/index.js ที่เดียวเพื่อคุมลำดับ
//    (ของเดิม import ซ้ำที่นี่ด้วย ทำให้ลำดับที่ webpack ปล่อยออกมาเดาไม่ได้)

const NotFound = () => (
  <Container className="text-center mt-5">
    <h2>ไม่พบหน้านี้</h2>
    <Link to="/">กลับหน้าหลัก</Link>
  </Container>
);

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

// โหมด "อัตโนมัติ" เปลี่ยนตามเครื่องสด ๆ (ผู้ใช้สลับ dark mode ของ OS ระหว่างเปิดแอป)
const ThemeFollower = () => { useFollowSystemTheme(); return null; };

const App = () => (
  <Router basename={APP_BASE}>
    <SessionRefresh />
    <ThemeFollower />
    <SiteHeader />

    <main className="mc-main">
      <PageTransition>
        <Routes>
          {/* หน้าแรก = เลือกหมวดที่จะตรวจ · ใบตรวจตามรอบย้ายไป /inspect (บุ๊กมาร์กเก่า /?model= ถูกพาไปเอง) */}
          <Route path="/" element={<CategoryHome />} />
          <Route path="/inspect" element={<InspectionSheet />} />
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
      </PageTransition>
    </main>
    <SiteFooter />
  </Router>
);

export default App;
