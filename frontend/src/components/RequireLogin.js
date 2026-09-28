// frontend/src/components/RequireLogin.js — กั้นหน้า Master ให้ต้อง login ก่อน
//
// ใช้ที่ App.js ครอบ <MasterSetup> ที่ route · **ไม่แตะใน MasterSetup เอง** (เทสของมันเรนเดอร์ตรง ๆ)
//
// ⚠️ ไม่ redirect ไปหน้า login แยก — URL ต้องไม่เปลี่ยน ปุ่ม "ไปตั้งค่า" จากหน้าใบตรวจหิ้ว
//    ?item_no=…&division_id=… มาให้ (masterHref) login เสร็จแล้ว MasterSetup ต้องได้ prefill ครบ
// ⚠️ session หมดกลางคัน (บันทึกแล้วได้ 401) → **ห้าม unmount หน้า** เปิดกล่อง login ทับแทน
//    ไม่งั้นฟอร์มจุดตรวจที่กรอกค้างไว้หายหมด · login เสร็จกดบันทึกซ้ำได้เลย
import React, { useEffect, useState } from 'react';
import { Button, Card, Container, Form, Modal, Spinner } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { clearSession, getSession, onSessionChange, setSession } from '../utils/auth';

// เข้าได้ 2 ทาง: passkey ช่องเดียว หรือ ชื่อผู้ใช้ + รหัสผ่าน — แยกเป็นสองฟอร์มคนละปุ่ม
// ไม่รวมเป็นฟอร์มเดียวที่ "เดาเอา" ว่าคนตั้งใจใช้ทางไหนจากช่องที่กรอก
export const LoginForm = ({ onDone, idPrefix = 'login' }) => {
  const [passkey, setPasskey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const send = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiCall('/auth/login', { method: 'POST', body });
      setSession({ token: res.token, user: res.user });
      onDone?.();
    } catch (err) {
      setError(err.message);
      setPasskey('');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const submitPasskey = (e) => { e.preventDefault(); send({ passkey }); };
  const submit = (e) => { e.preventDefault(); send({ username, password }); };

  return (
    <>
    <Form onSubmit={submitPasskey}>
      <Form.Group className="mb-2" controlId={`${idPrefix}-passkey`}>
        <Form.Label className="small mb-1">Passkey</Form.Label>
        <Form.Control type="password" autoFocus autoComplete="off" value={passkey}
          onChange={(e) => setPasskey(e.target.value)} />
      </Form.Group>
      <Button type="submit" className="w-100" disabled={busy || !passkey}>เข้าด้วย passkey</Button>
    </Form>
    <div className="text-center small text-muted my-2">หรือ</div>
    <Form onSubmit={submit}>
      <Form.Group className="mb-2" controlId={`${idPrefix}-username`}>
        <Form.Label className="small mb-1">ชื่อผู้ใช้</Form.Label>
        <Form.Control autoComplete="username" value={username}
          onChange={(e) => setUsername(e.target.value)} />
      </Form.Group>
      <Form.Group className="mb-2" controlId={`${idPrefix}-password`}>
        <Form.Label className="small mb-1">รหัสผ่าน</Form.Label>
        <Form.Control type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
      </Form.Group>
      <Button type="submit" className="w-100" disabled={busy || !username || !password}>
        {busy ? <><Spinner size="sm" animation="border" className="me-1" />กำลังเข้าสู่ระบบ</> : 'เข้าสู่ระบบ'}
      </Button>
    </Form>
    {/* ⚠️ ไม่ใช้ <Alert> — พ่วง role="alert" มาด้วย (กฎเดียวกับ AppDialog) */}
    {error && <div className="small mt-2" style={{ color: 'var(--red)' }}>{error}</div>}
    </>
  );
};

const RequireLogin = ({ children }) => {
  const [session, setSessionState] = useState(getSession);
  // เคยเข้าหน้าได้แล้วในรอบนี้ไหม — ตัดสินว่า session หายแล้วจะโชว์ฟอร์มเต็มหน้าหรือกล่องทับ
  const [entered, setEntered] = useState(() => Boolean(getSession()));

  useEffect(() => onSessionChange((s) => {
    setSessionState(s);
    if (s) setEntered(true);
  }), []);

  // token ที่จำไว้อาจใช้ไม่ได้แล้ว (บัญชีถูกปิด / server เปลี่ยน AUTH_SECRET) — เช็คครั้งเดียวตอนเข้า
  // ไม่ผ่าน apiCall ล้าง session ให้เอง แล้วกล่อง login จะเด้งขึ้นมาก่อนคนเริ่มกรอกอะไร
  useEffect(() => {
    if (getSession()) apiCall('/auth/me').catch(() => {});
  }, []);

  const logout = () => {
    setEntered(false);
    clearSession();
  };

  if (!entered) {
    return (
      <Container className="page" style={{ maxWidth: 380 }}>
        <Card className="mt-4">
          <Card.Header>เข้าสู่ระบบเพื่อแก้ไขข้อมูล Master</Card.Header>
          <Card.Body>
            <LoginForm idPrefix="login-page" />
            <div className="small text-muted mt-3">
              หน้าใบตรวจ Dashboard และรายงานใช้งานได้โดยไม่ต้องเข้าสู่ระบบ
            </div>
          </Card.Body>
        </Card>
      </Container>
    );
  }

  return (
    <>
      {session && (
        <div className="d-flex justify-content-end align-items-center gap-2 small text-muted px-3 pt-2">
          <span>เข้าสู่ระบบเป็น <b>{session.user?.display_name || session.user?.username}</b></span>
          <Button size="sm" variant="link" className="p-0" onClick={logout}>ออกจากระบบ</Button>
        </div>
      )}
      {children}
      {/* animation={false} ตามกฎ AppDialog — Fade ยิง setState หลังเทสจบ act() */}
      <Modal show={!session} backdrop="static" keyboard={false} animation={false} centered>
        <Modal.Header>
          <Modal.Title as="h2" className="fs-5">เซสชันหมดอายุ — เข้าสู่ระบบอีกครั้ง</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="small text-muted mb-2">ข้อมูลที่กรอกค้างไว้ยังอยู่ เข้าสู่ระบบแล้วกดบันทึกอีกครั้ง</div>
          <LoginForm idPrefix="login-modal" />
        </Modal.Body>
      </Modal>
    </>
  );
};

export default RequireLogin;
