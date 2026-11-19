// frontend/src/components/UsersTab.js — แท็บ "ผู้ใช้" ในหน้า Master: บัญชีที่ login หน้า Master ได้
//
// บัญชีเกิดจาก: ADMIN เพิ่มที่นี่ · หรือคนสมัครเองที่ /register → การ์ด "คำขอสมัคร" ข้างบน (pending — login ไม่ได้จนกว่าอนุมัติ)
//    (หน้าเว็บเปิดได้ทุกเครื่องในโรงงาน สมัครแล้วใช้ได้ทันที = login ไม่ได้กันอะไร)
// ⚠️ ใช้ /users ไม่ใช่ generic CRUD /master/add — รหัสผ่านต้อง hash ที่ server
// ไม่มีปุ่มลบ ใช้ปิดใช้งานแทน · ปิดบัญชีตัวเองไม่ได้ (server กันอีกชั้น)
import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Col, Form, Row, Table } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { getSession } from '../utils/auth';
import { fmtDateTime } from '../utils/dateFormat';
import { useDataTable, FilterBar } from './table/useDataTable';
import Pager, { usePager } from './table/Pager';
import ApproveUserModal from './master/ApproveUserModal';

const MIN_PASSWORD = 6; // เท่ากับ backend/routes/users.js
const MIN_PASSKEY = 6;  // เท่ากับ backend/routes/users.js
const blank = () => ({ username: '', display_name: '', password: '', confirm: '', role: 'ADMIN', inspector_id: '' });

// role ของบัญชี (users.role เป็น SET) — ADMIN = แก้ Master · PD / QC = หน้า Set up / Last Piece
// ⚠️ ตัวกั้นจริงคือ requireRole ฝั่ง backend · ลิสต์นี้เป็นแค่ตัวเลือกบนจอ
// ใช้ dropdown ครบทุกชุดแทน checkbox — กล่อง showForm มีแต่ช่อง text/select
// ⚠️ value ต้องเรียงตามนิยาม SET ('ADMIN','PD','QC') — MariaDB คืนค่าเรียงแบบนั้น ไม่ตรง = ช่องว่าง
export const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'ADMIN (ตั้งค่า Master)' },
  { value: 'PD', label: 'PD (Production Check)' },
  { value: 'QC', label: 'QC (QC Confirm)' },
  { value: 'PD,QC', label: 'PD + QC' },
  { value: 'ADMIN,PD', label: 'ADMIN + PD' },
  { value: 'ADMIN,QC', label: 'ADMIN + QC' },
  { value: 'ADMIN,PD,QC', label: 'ADMIN + PD + QC' },
];
const roleLabel = (r) => String(r ?? '').split(',').filter(Boolean).join(' + ') || '—';

const fmtTime = (v) => fmtDateTime(v);

const USER_COLS = {
  username: { get: (u) => u.username },
  display: { get: (u) => u.display_name ?? '' },
  role: { get: (u) => roleLabel(u.role) },
  insp: { get: (u) => u.inspector_name ?? '' },
  active: { get: (u) => (Number(u.is_active) ? 'ใช้งาน' : 'ปิดใช้งาน') },
  passkey: { get: (u) => (Number(u.has_passkey) ? 'ตั้งแล้ว' : '—') },
  login: { get: (u) => (u.last_login_at ? new Date(u.last_login_at).getTime() : null), text: (u) => fmtTime(u.last_login_at).slice(0, 10) },
};

const UsersTab = ({ say, fail, showForm, showConfirm, onAlert }) => {
  const [allUsers, setUsers] = useState([]);
  // คำขอสมัคร (pending) แยกการ์ด — ตารางบัญชีโชว์เฉพาะบัญชีจริง
  const pendingUsers = allUsers.filter((u) => Number(u.pending));
  const users = allUsers.filter((u) => !Number(u.pending));
  const [approving, setApproving] = useState(null);
  const [divisions, setDivisions] = useState([]);
  const dt = useDataTable(users, USER_COLS);
  const pg = usePager(dt.rows, dt.resetKey);
  const [form, setForm] = useState(blank);
  const me = getSession()?.user?.id;
  const [inspectors, setInspectors] = useState([]);
  useEffect(() => {
    apiCall('/master/lookups').then((lk) => { setInspectors(lk.inspectors ?? []); setDivisions(lk.divisions ?? []); }).catch(() => {});
  }, []);
  const inspectorOptions = inspectors.map((i) => ({ value: String(i.id), label: `${i.emp_code} ${i.name}` }));

  const load = useCallback(async () => {
    try { setUsers(await apiCall('/users')); } catch (e) { fail(e); }
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const add = async (e) => {
    e.preventDefault();
    if (!form.username || !form.password) {
      return onAlert({ title: 'กรอกข้อมูลไม่ครบ', body: 'กรอกชื่อผู้ใช้และรหัสผ่าน' });
    }
    if (form.password.length < MIN_PASSWORD) {
      return onAlert({ title: 'รหัสผ่านสั้นเกินไป', body: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว` });
    }
    if (form.password !== form.confirm) {
      return onAlert({ title: 'รหัสผ่านไม่ตรงกัน', body: 'พิมพ์รหัสผ่านสองช่องให้ตรงกัน' });
    }
    try {
      await apiCall('/users', {
        method: 'POST',
        body: {
          username: form.username.trim(), display_name: form.display_name, password: form.password,
          role: form.role, inspector_id: form.inspector_id || null,
        },
      });
      say('success', `เพิ่มบัญชี ${form.username.trim()} แล้ว — แจ้งรหัสผ่านให้เจ้าของบัญชี แล้วให้เขาเปลี่ยนเอง`);
      setForm(blank());
      await load();
    } catch (err) { fail(err); }
  };

  const resetPassword = (u) => showForm({
    title: `ตั้งรหัสผ่านใหม่ให้ ${u.username}`,
    confirmLabel: 'บันทึกรหัสผ่าน',
    fields: [
      { name: 'password', label: `รหัสผ่านใหม่ (อย่างน้อย ${MIN_PASSWORD} ตัว)`, type: 'password', required: true },
      { name: 'confirm', label: 'พิมพ์ซ้ำอีกครั้ง', type: 'password', required: true },
    ],
    onConfirm: async ({ password, confirm }) => {
      if (password !== confirm) return onAlert({ title: 'รหัสผ่านไม่ตรงกัน', body: 'ลองใหม่อีกครั้ง' });
      if (password.length < MIN_PASSWORD) {
        return onAlert({ title: 'รหัสผ่านสั้นเกินไป', body: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว` });
      }
      try {
        await apiCall(`/users/${u.id}/password`, { method: 'PUT', body: { password } });
        say('success', `ตั้งรหัสผ่านใหม่ให้ ${u.username} แล้ว`);
      } catch (err) { fail(err); }
    },
  });

  // passkey = รหัสลับที่พิมพ์ช่องเดียวแล้วเข้าได้เลย — ห้ามซ้ำกับของบัญชีอื่น (server ตรวจ)
  const setPasskey = (u) => showForm({
    title: `ตั้ง passkey ให้ ${u.username}`,
    body: 'ใช้พิมพ์ช่องเดียวเข้าหน้า Master ได้เลยโดยไม่ต้องใส่ชื่อผู้ใช้ — ตั้งให้เดายาก',
    confirmLabel: 'บันทึก passkey',
    fields: [
      { name: 'passkey', label: `Passkey (อย่างน้อย ${MIN_PASSKEY} ตัว)`, type: 'password', required: true },
      { name: 'confirm', label: 'พิมพ์ซ้ำอีกครั้ง', type: 'password', required: true },
    ],
    onConfirm: async ({ passkey, confirm }) => {
      if (passkey !== confirm) return onAlert({ title: 'passkey ไม่ตรงกัน', body: 'ลองใหม่อีกครั้ง' });
      if (passkey.length < MIN_PASSKEY) {
        return onAlert({ title: 'passkey สั้นเกินไป', body: `passkey ต้องยาวอย่างน้อย ${MIN_PASSKEY} ตัว` });
      }
      try {
        await apiCall(`/users/${u.id}/passkey`, { method: 'PUT', body: { passkey } });
        say('success', `ตั้ง passkey ให้ ${u.username} แล้ว`);
        await load();
      } catch (err) { fail(err); }
    },
  });

  const removePasskey = (u) => showConfirm({
    title: `ลบ passkey ของ ${u.username} ?`,
    body: 'หลังลบต้องเข้าด้วยชื่อผู้ใช้และรหัสผ่านเท่านั้น ตั้งใหม่ได้ภายหลัง',
    confirmLabel: 'ลบ passkey',
    onConfirm: async () => {
      try {
        await apiCall(`/users/${u.id}/passkey`, { method: 'DELETE' });
        say('success', `ลบ passkey ของ ${u.username} แล้ว`);
        await load();
      } catch (err) { fail(err); }
    },
  });

  const rename = (u) => showForm({
    title: `แก้ชื่อที่แสดงของ ${u.username}`,
    confirmLabel: 'บันทึก',
    fields: [{ name: 'display_name', label: 'ชื่อที่แสดง', defaultValue: u.display_name ?? '' }],
    onConfirm: async ({ display_name: displayName }) => {
      try {
        await apiCall(`/users/${u.id}`, { method: 'PUT', body: { display_name: displayName } });
        await load();
      } catch (err) { fail(err); }
    },
  });

  // PD/QC ต้องผูกผู้ตรวจ — ใบตรวจอ้าง inspectors เหมือนเดิม ไม่ผูก = ส่งผลตรวจไม่ได้ (server ตอบ 400)
  const editRole = (u) => showForm({
    title: `สิทธิ์ / ผู้ตรวจ ของ ${u.username}`,
    body: 'PD / QC (และ ADMIN ที่จะตรวจเอง) ต้องผูกกับรายชื่อผู้ตรวจ — ชื่อนี้จะไปอยู่บนใบตรวจ Set up / Last Piece',
    confirmLabel: 'บันทึก',
    fields: [
      { name: 'role', label: 'สิทธิ์', options: ROLE_OPTIONS, required: true, defaultValue: u.role ?? 'ADMIN' },
      { name: 'inspector_id', label: 'ผู้ตรวจ', options: inspectorOptions, placeholder: '— ไม่ผูก —',
        defaultValue: u.inspector_id ? String(u.inspector_id) : '' },
    ],
    onConfirm: async ({ role, inspector_id: inspectorId }) => {
      try {
        await apiCall(`/users/${u.id}`, { method: 'PUT', body: { role, inspector_id: inspectorId || null } });
        say('success', `แก้สิทธิ์ของ ${u.username} แล้ว — มีผลครั้งถัดไปที่เปิดหน้า`);
        await load();
      } catch (err) { fail(err); }
    },
  });

  const setActive = async (u, active) => {
    try {
      await apiCall(`/users/${u.id}`, { method: 'PUT', body: { is_active: active } });
      say('success', active ? `เปิดใช้งาน ${u.username} แล้ว` : `ปิดบัญชี ${u.username} แล้ว — มีผลทันที`);
      await load();
    } catch (err) { fail(err); }
  };

  const disable = (u) => showConfirm({
    title: `ปิดบัญชี ${u.username} ?`,
    body: 'เข้าหน้า Master ไม่ได้ทันที (หน้าที่เปิดค้างอยู่จะบันทึกไม่ได้) เปิดใช้งานคืนได้ภายหลัง',
    confirmLabel: 'ปิดบัญชี',
    onConfirm: () => setActive(u, false),
  });

  const reject = (u) => showConfirm({
    title: `ปฏิเสธคำขอของ ${u.username} ?`,
    body: 'ลบคำขอนี้ทิ้ง (บัญชียังไม่เคยใช้งาน) — ถ้าเป็นคนจริง เขาสมัครใหม่ได้',
    confirmLabel: 'ปฏิเสธ',
    cancelLabel: 'ปิด',
    onConfirm: async () => {
      try {
        await apiCall(`/users/${u.id}/pending`, { method: 'DELETE' });
        say('success', `ปฏิเสธคำขอของ ${u.username} แล้ว`);
        await load();
      } catch (e) { fail(e); }
    },
  });

  return (
    <>
    {pendingUsers.length > 0 && (
      <Card className="mb-3 user-requests">
        <Card.Header>คำขอสมัคร <Badge bg="danger" pill>{pendingUsers.length}</Badge>
          <span className="small text-muted ms-2">สมัครจากหน้า "สมัครใช้งาน" — เข้าสู่ระบบได้หลังอนุมัติ</span>
        </Card.Header>
        <Card.Body>
          <div className="mc-freeze" style={{ maxHeight: '40vh' }}>
            <Table bordered hover size="sm" className="mb-0 text-nowrap">
              <thead>
                <tr>
                  <th className="mc-sticky-start">ชื่อผู้ใช้</th><th>ชื่อ-นามสกุล</th><th>รหัสพนักงาน</th><th>Division</th>
                  <th>ขอเป็น</th><th>สมัครเมื่อ</th><th className="mc-sticky-end">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {pendingUsers.map((u) => (
                  <tr key={u.id}>
                    <td className="mc-sticky-start">{u.username}</td>
                    <td>{u.display_name ?? '—'}</td>
                    <td>{u.reg_emp_code ?? '—'}{u.matched_inspector_id ? <span className="small text-muted ms-1">(มีผู้ตรวจรหัสนี้)</span> : null}</td>
                    <td>{u.reg_division_name ?? '—'}</td>
                    <td>{roleLabel(u.role)}</td>
                    <td className="num">{fmtTime(u.created_at)}</td>
                    <td className="mc-sticky-end">
                      <Button size="sm" className="me-1" onClick={() => setApproving(u)}>อนุมัติ</Button>
                      <Button size="sm" variant="outline-danger" onClick={() => reject(u)}>ปฏิเสธ</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>
    )}
    <ApproveUserModal
      user={approving}
      inspectors={inspectors}
      divisions={divisions}
      onHide={() => setApproving(null)}
      onDone={async (u) => {
        setApproving(null);
        say('success', `อนุมัติ ${u.username} แล้ว — เข้าสู่ระบบได้เลย`);
        await load();
        apiCall('/master/lookups').then((lk) => setInspectors(lk.inspectors ?? [])).catch(() => {});
      }}
    />
    <Card>
      <Card.Body>
        <Form onSubmit={add} autoComplete="off">
          <Row className="g-2 align-items-end mb-3">
            <Form.Group as={Col} md={2} controlId="user-username">
              <Form.Label className="small mb-1">ชื่อผู้ใช้</Form.Label>
              <Form.Control placeholder="เช่น LBLE355" {...field('username')} />
            </Form.Group>
            <Form.Group as={Col} md={3} controlId="user-display-name">
              <Form.Label className="small mb-1">ชื่อที่แสดง</Form.Label>
              <Form.Control {...field('display_name')} />
            </Form.Group>
            <Form.Group as={Col} md={2} controlId="user-password">
              <Form.Label className="small mb-1">รหัสผ่าน</Form.Label>
              <Form.Control type="password" autoComplete="new-password" {...field('password')} />
            </Form.Group>
            <Form.Group as={Col} md={2} controlId="user-confirm">
              <Form.Label className="small mb-1">พิมพ์รหัสผ่านซ้ำ</Form.Label>
              <Form.Control type="password" autoComplete="new-password" {...field('confirm')} />
            </Form.Group>
            <Form.Group as={Col} md={2} controlId="user-role">
              <Form.Label className="small mb-1">สิทธิ์</Form.Label>
              <Form.Select {...field('role')}>
                {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group as={Col} md={3} controlId="user-inspector">
              <Form.Label className="small mb-1">ผู้ตรวจ (PD/QC หรือ ADMIN ที่ตรวจเอง ต้องเลือก)</Form.Label>
              <Form.Select {...field('inspector_id')}>
                <option value="">— ไม่ผูก —</option>
                {inspectorOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Form.Select>
            </Form.Group>
            <Col md="auto">
              <Button type="submit">เพิ่มผู้ใช้</Button>
            </Col>
          </Row>
        </Form>

        <FilterBar dt={dt} className="mb-2" />
        <div className="mc-freeze">
        <Table striped bordered hover size="sm" className="mb-0 text-nowrap">
          <thead>
            <tr>
              {dt.th('username', 'ชื่อผู้ใช้', { className: 'mc-sticky-start' })}{dt.th('display', 'ชื่อที่แสดง')}
              {dt.th('role', 'สิทธิ์')}{dt.th('insp', 'ผู้ตรวจ')}{dt.th('active', 'สถานะ')}{dt.th('passkey', 'Passkey')}
              {dt.th('login', 'login ล่าสุด')}
              <th className="mc-sticky-end" style={{ width: 380 }}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {pg.rows.map((u) => {
              const active = Boolean(Number(u.is_active));
              const isMe = u.id === me;
              return (
                <tr key={u.id} className={active ? '' : 'text-muted'}>
                  <td className="mc-sticky-start">{u.username}{isMe && <Badge bg="light" text="dark" className="ms-1">คุณ</Badge>}</td>
                  <td>{u.display_name ?? '—'}</td>
                  <td>{roleLabel(u.role)}</td>
                  <td>{u.inspector_name ? `${u.inspector_code ?? ''} ${u.inspector_name}` : '—'}</td>
                  <td>{active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                  <td>{Number(u.has_passkey) ? 'ตั้งแล้ว' : '—'}</td>
                  <td className="num">{fmtTime(u.last_login_at)}</td>
                  <td className="mc-sticky-end">
                    <Button size="sm" variant="outline-primary" className="me-1" onClick={() => rename(u)}>แก้ชื่อ</Button>
                    <Button size="sm" variant="outline-primary" className="me-1" onClick={() => editRole(u)}>สิทธิ์ / ผู้ตรวจ</Button>
                    <Button size="sm" variant="outline-primary" className="me-1" onClick={() => resetPassword(u)}>
                      ตั้งรหัสผ่านใหม่
                    </Button>
                    <Button size="sm" variant="outline-primary" className="me-1" onClick={() => setPasskey(u)}>
                      {Number(u.has_passkey) ? 'เปลี่ยน passkey' : 'ตั้ง passkey'}
                    </Button>
                    {Number(u.has_passkey) > 0 && (
                      <Button size="sm" variant="outline-secondary" className="me-1" onClick={() => removePasskey(u)}>
                        ลบ passkey
                      </Button>
                    )}
                    {active
                      ? !isMe && <Button size="sm" variant="outline-danger" onClick={() => disable(u)}>ปิดบัญชี</Button>
                      : <Button size="sm" variant="outline-secondary" onClick={() => setActive(u, true)}>เปิดใช้งาน</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        </div>
        <Pager pg={pg} />
      </Card.Body>
    </Card>
    </>
  );
};

export default UsersTab;
