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
import { MENU, MASTER_KEYS } from './utils/useMenuAccess';

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
          {/* ทุกหน้ากั้นตามสิทธิ์เมนูที่ ADMIN ตั้ง (Master › ผู้ใช้ & สิทธิ์) — เมนูที่เปิดให้คนไม่ login ผ่านเลย
              ค่าเริ่มต้น: ใบตรวจ/Dashboard/SC/รายงาน ไม่ต้อง login · Set up = PD/QC/ADMIN · Master = ADMIN */}
          <Route path="/inspect" element={<RequireLogin menu={MENU.inspect} title="เข้าสู่ระบบ — ใบตรวจ Regular time"><InspectionSheet /></RequireLogin>} />
          <Route path="/dashboard" element={<RequireLogin menu={MENU.dashboard} title="เข้าสู่ระบบ — Dashboard"><Dashboard /></RequireLogin>} />
          <Route path="/sc" element={<RequireLogin menu={MENU.sc} title="เข้าสู่ระบบ — SC Chart"><ScSheet /></RequireLogin>} />
          <Route path="/report" element={<RequireLogin menu={MENU.report} title="เข้าสู่ระบบ — รายงาน"><ReportPage /></RequireLogin>} />
          <Route path="/master" element={<RequireLogin menu={MASTER_KEYS}><MasterSetup /></RequireLogin>} />
          <Route path="/setup" element={(
            <RequireLogin menu={MENU.setup} title="เข้าสู่ระบบ — งาน Set up / Last Piece">
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
