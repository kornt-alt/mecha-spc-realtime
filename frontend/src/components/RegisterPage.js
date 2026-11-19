// components/RegisterPage.js — หน้าสมัครใช้งาน (/register · ไม่ต้อง login)
//
// ⚠️ สมัครแล้วยังใช้ไม่ได้ — บัญชีเป็น pending จนกว่า ADMIN อนุมัติที่ Master › ผู้ใช้ & สิทธิ์ (POST /auth/register)
//    ตอนอนุมัติ ADMIN ผูก/สร้างผู้ตรวจจากชื่อ + รหัสพนักงานที่กรอกที่นี่ (ชื่อนี้ขึ้นบนใบตรวจ)
// ตำแหน่งที่ขอได้แค่ PD / QC — ADMIN ให้สิทธิ์เพิ่มได้ตอนอนุมัติ
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import BrandLogo from './layout/BrandLogo';

const MIN_PASSWORD = 6; // เท่ากับ backend/services/userRules.js
const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;
const blank = { username: '', display_name: '', emp_code: '', division_id: '', role: '', password: '', confirm: '' };

const RegisterPage = () => {
  const [form, setForm] = useState(blank);
  const [divisions, setDivisions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    apiCall('/master/lookups')
      .then((lk) => setDivisions((lk.divisions ?? []).filter((d) => Number(d.is_active ?? 1) === 1)))
      .catch(() => {});
  }, []);

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  // ตรวจบนจอก่อนส่ง (ตัวกั้นจริงอยู่ที่ server กฎชุดเดียวกัน)
  const issue = (() => {
    if (!USERNAME_RE.test(form.username.trim())) return 'ชื่อผู้ใช้: ภาษาอังกฤษ ตัวเลข หรือ . _ - ยาว 3-50 ตัว ห้ามเว้นวรรค';
    if (!form.display_name.trim()) return 'กรอกชื่อ-นามสกุล';
    if (!form.emp_code.trim()) return 'กรอกรหัสพนักงาน';
    if (!form.role) return 'เลือกตำแหน่ง PD หรือ QC';
    if (form.password.length < MIN_PASSWORD) return `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว`;
    if (form.password !== form.confirm) return 'รหัสผ่านสองช่องไม่ตรงกัน';
    return null;
  })();

  const submit = async (e) => {
    e.preventDefault();
    if (issue) { setError(issue); return; }
    setBusy(true); setError(null);
    try {
      await apiCall('/auth/register', {
        method: 'POST',
        body: {
          username: form.username.trim(), display_name: form.display_name.trim(), emp_code: form.emp_code.trim(),
          division_id: form.division_id || null, role: form.role, password: form.password,
        },
      });
      setDone(form.username.trim());
      setForm(blank);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <Container className="mc-auth">
      <Card style={{ width: '100%', maxWidth: 460 }}>
        <Card.Body className="p-4">
          <div className="mc-auth__head">
            <BrandLogo size="sm" />
            <h2 className="fs-5">สมัครใช้งาน</h2>
          </div>
          {done ? (
            <div role="status">
              <div className="form-note form-note--info mb-3">
                ส่งคำขอของ <b>{done}</b> แล้ว — รอ ADMIN อนุมัติ จึงจะเข้าสู่ระบบได้
              </div>
              <Link to="/" className="btn btn-primary w-100">กลับหน้าแรก</Link>
            </div>
          ) : (
            <Form onSubmit={submit} noValidate>
              <div className="small text-muted mb-3">สมัครแล้วต้องรอ ADMIN อนุมัติก่อน จึงจะเข้าสู่ระบบได้</div>
              <Form.Group className="mb-2" controlId="reg-username">
                <Form.Label className="small mb-1">ชื่อผู้ใช้ (ใช้ตอนเข้าสู่ระบบ)</Form.Label>
                <Form.Control autoComplete="username" autoFocus placeholder="เช่น LBLE355" {...field('username')} />
              </Form.Group>
              <Form.Group className="mb-2" controlId="reg-name">
                <Form.Label className="small mb-1">ชื่อ-นามสกุล (ขึ้นบนใบตรวจ)</Form.Label>
                <Form.Control autoComplete="name" {...field('display_name')} />
              </Form.Group>
              <div className="d-flex gap-2">
                <Form.Group className="mb-2 flex-grow-1" controlId="reg-emp">
                  <Form.Label className="small mb-1">รหัสพนักงาน</Form.Label>
                  <Form.Control {...field('emp_code')} />
                </Form.Group>
                <Form.Group className="mb-2 flex-grow-1" controlId="reg-division">
                  <Form.Label className="small mb-1">Division</Form.Label>
                  <Form.Select {...field('division_id')}>
                    <option value="">— ไม่ระบุ —</option>
                    {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Form.Select>
                </Form.Group>
              </div>
              <Form.Group className="mb-2">
                <Form.Label className="small mb-1 d-block">ตำแหน่ง</Form.Label>
                <Form.Check inline type="radio" id="reg-role-pd" name="reg-role" label="PD (Production Check)"
                  checked={form.role === 'PD'} onChange={() => setForm((f) => ({ ...f, role: 'PD' }))} />
                <Form.Check inline type="radio" id="reg-role-qc" name="reg-role" label="QC (QC Confirm)"
                  checked={form.role === 'QC'} onChange={() => setForm((f) => ({ ...f, role: 'QC' }))} />
              </Form.Group>
              <div className="d-flex gap-2">
                <Form.Group className="mb-2 flex-grow-1" controlId="reg-password">
                  <Form.Label className="small mb-1">รหัสผ่าน</Form.Label>
                  <Form.Control type="password" autoComplete="new-password" {...field('password')} />
                </Form.Group>
                <Form.Group className="mb-2 flex-grow-1" controlId="reg-confirm">
                  <Form.Label className="small mb-1">พิมพ์ซ้ำ</Form.Label>
                  <Form.Control type="password" autoComplete="new-password" {...field('confirm')} />
                </Form.Group>
              </div>
              {error && <div className="form-note form-note--danger mb-2">{error}</div>}
              <Button type="submit" className="w-100 mt-1" disabled={busy}>
                {busy ? <><Spinner size="sm" animation="border" className="me-1" />กำลังส่ง</> : 'ส่งคำขอสมัคร'}
              </Button>
              <div className="text-center small mt-3"><Link to="/">กลับหน้าแรก</Link></div>
            </Form>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
};

export default RegisterPage;
