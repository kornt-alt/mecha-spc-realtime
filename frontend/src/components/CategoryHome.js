// frontend/src/components/CategoryHome.js — หน้าแรก (`/`): เลือกหมวดของสิ่งที่จะตรวจก่อนเริ่ม
//
// Korn สั่ง (2026-11): เข้ามาแล้วเลือกหมวดก่อน — Inspection Record (ตรวจตามรอบ) · Set up · Last Piece
// การ์ดมาจากตาราง check_categories (`/master/lookups` → categories) — เพิ่มหมวดใหม่ใน DB แล้วขึ้นเองที่นี่
//   routine (id 1, has_workflow 0) → /inspect (ใบตรวจตามรอบ เดิมอยู่ที่ `/`)
//   หมวดที่ has_workflow = 1     → /setup?cat=<id> (งานส่งต่อ PD → QC ใช้ flow เดียวกันทุกหมวด)
//
// ⚠️ บุ๊กมาร์กเก่าของจอหน้าไลน์ชี้ `/?model=…` (สมัยใบตรวจอยู่ที่ `/`) — มี query ของใบตรวจติดมา = พาไป /inspect
//    พร้อม query เดิม ไม่ต้องให้หน้าไลน์มาเลือกหมวดใหม่ทุกเครื่อง
// ⚠️ โหลดหมวดไม่ได้ (backend ล่ม) ยังต้องมีทางไปใบตรวจตามรอบ — การ์ดสำรองชุดเดียวกับ seed ใน schema.sql
import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Container, Row, Col } from 'react-bootstrap';

import { apiCall } from '../utils/api';
import { hasRole } from '../utils/auth';
import useSession from '../utils/useSession';
import { on } from '../utils/socket';
import { readStation } from '../utils/station';
import { modelHref } from '../utils/useModelParam';
import Icon from './layout/Icon';

// ชื่อ/คำอธิบายบนการ์ดตาม code ของหมวด — หมวดที่ไม่รู้จักใช้ชื่อจาก DB + คำอธิบายกลาง ๆ
const VIEW = {
  routine: {
    title: 'Inspection Record',
    sub: 'ตรวจตามรอบ',
    desc: 'สแกน MO แล้วกรอกค่าวัดตามจุดที่ถึงรอบ ผลขึ้นกราฟ SPC ทันที',
    icon: 'clipboard',
  },
  setup: {
    title: 'Set up',
    sub: 'ตรวจหลังตั้งเครื่อง',
    desc: 'PD ตรวจชิ้นแรกหลังตั้งเครื่อง แล้วส่งให้ QC ยืนยันผ่าน / ไม่ผ่าน',
    icon: 'wrench',
  },
  last_piece: {
    title: 'Last Piece',
    sub: 'ตรวจชิ้นสุดท้าย',
    desc: 'PD ตรวจชิ้นสุดท้ายของล็อต แล้วส่งให้ QC ยืนยันผ่าน / ไม่ผ่าน',
    icon: 'flag',
  },
};

const FALLBACK = [
  { id: 1, code: 'routine', name: 'ตรวจตามรอบ', has_workflow: 0 },
  { id: 2, code: 'setup', name: 'Set up', has_workflow: 1 },
  { id: 3, code: 'last_piece', name: 'Last Piece', has_workflow: 1 },
];

// query ของใบตรวจตามรอบ — มีอย่างใดอย่างหนึ่ง = บุ๊กมาร์กเก่า
const SHEET_PARAMS = ['model', 'item_no', 'mo'];

const CategoryHome = () => {
  const { search } = useLocation();
  const session = useSession();
  const [cats, setCats] = useState(null);
  const [counts, setCounts] = useState(null);
  const isQC = hasRole(session, 'QC');
  const isPD = hasRole(session, 'PD');

  useEffect(() => {
    apiCall('/master/lookups')
      .then((lk) => setCats((lk?.categories ?? []).filter((c) => Number(c.is_active ?? 1))))
      .catch(() => setCats(FALLBACK));
  }, []);

  // ตัวเลขงานที่รอคุณบนการ์ด (เฉพาะคนที่ login เป็น PD/QC — /check-jobs ต้อง login)
  useEffect(() => {
    if (!isQC && !isPD) { setCounts(null); return undefined; }
    const load = () => apiCall('/check-jobs/counts').then(setCounts).catch(() => setCounts(null));
    load();
    return on('check_job_updated', load);
  }, [isQC, isPD]);

  const params = new URLSearchParams(search);
  if (SHEET_PARAMS.some((k) => params.has(k))) return <Navigate to={`/inspect${search}`} replace />;

  const modelId = readStation().modelId;
  const list = cats ?? [];

  const hrefOf = (c) => (Number(c.has_workflow) ? `/setup?cat=${c.id}` : modelHref('/inspect', modelId));
  const waitingOf = (c) => {
    const b = counts?.byCategory?.[c.id];
    if (!b) return 0;
    return (isQC ? b.waiting_qc : 0) + (isPD ? b.pd_returned : 0);
  };

  return (
    <Container fluid className="page cat-home">
      <div className="page-head">
        <h1>เลือกหมวดที่จะตรวจ</h1>
      </div>

      {cats === null ? (
        <div className="text-muted">กำลังโหลด…</div>
      ) : (
        <Row className="g-3 g-lg-4">
          {list.map((c) => {
            const v = VIEW[c.code] ?? { title: c.name, sub: '', desc: 'งานตรวจที่ PD ตรวจแล้วส่งให้ QC ยืนยัน', icon: 'clipboard' };
            const waiting = waitingOf(c);
            return (
              <Col key={c.id} sm={6} xl={4}>
                <Link to={hrefOf(c)} className="mc-tile cat-tile">
                  <span className="cat-tile__icon"><Icon name={v.icon} size={28} /></span>
                  <span className="cat-tile__title">{v.title}</span>
                  {v.sub && <span className="cat-tile__sub">{v.sub}</span>}
                  <span className="cat-tile__desc">{v.desc}</span>
                  <span className="cat-tile__foot">
                    {Number(c.has_workflow)
                      ? (waiting > 0
                        ? <span className="cat-tile__waiting">มีงานรอคุณ {waiting} งาน</span>
                        : <span className="text-muted">ต้องเข้าสู่ระบบ (PD / QC)</span>)
                      : <span className="text-muted">ไม่ต้องเข้าสู่ระบบ</span>}
                    <span className="cat-tile__go">เริ่มตรวจ</span>
                  </span>
                </Link>
              </Col>
            );
          })}
        </Row>
      )}
    </Container>
  );
};

export default CategoryHome;
