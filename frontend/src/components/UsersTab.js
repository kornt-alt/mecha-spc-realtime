// frontend/src/components/UsersTab.js — แท็บ "ผู้ใช้" ในหน้า Master: บัญชีที่ login หน้า Master ได้
//
// ⚠️ ไม่มีหน้าสมัครสาธารณะโดยตั้งใจ — คนที่ login อยู่เป็นคนเพิ่มบัญชีให้คนอื่น
//    (หน้าเว็บเปิดได้ทุกเครื่องในโรงงาน สมัครเองได้ = login ไม่ได้กันอะไร)
// ⚠️ ใช้ /users ไม่ใช่ generic CRUD /master/add — รหัสผ่านต้อง hash ที่ server
// ไม่มีปุ่มลบ ใช้ปิดใช้งานแทน · ปิดบัญชีตัวเองไม่ได้ (server กันอีกชั้น)
import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Col, Form, Row, Table } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { getSession } from '../utils/auth';

const MIN_PASSWORD = 6; // เท่ากับ backend/routes/users.js
const MIN_PASSKEY = 6;  // เท่ากับ backend/routes/users.js
const blank = () => ({ username: '', display_name: '', password: '', confirm: '' });

const fmtTime = (v) => (v ? new Date(v).toLocaleString('th-TH') : '—');

const UsersTab = ({ say, fail, showForm, showConfirm, onAlert }) => {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(blank);
  const me = getSession()?.user?.id;

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
        body: { username: form.username.trim(), display_name: form.display_name, password: form.password },
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

  return (
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
            <Col md="auto">
              <Button type="submit">เพิ่มผู้ใช้</Button>
            </Col>
          </Row>
        </Form>

        <Table striped bordered hover responsive size="sm" className="mb-0">
          <thead className="table-dark">
            <tr>
              <th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>สถานะ</th><th>Passkey</th><th>login ล่าสุด</th>
              <th style={{ width: 380 }}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const active = Boolean(Number(u.is_active));
              const isMe = u.id === me;
              return (
                <tr key={u.id} className={active ? '' : 'text-muted'}>
                  <td>{u.username}{isMe && <Badge bg="light" text="dark" className="ms-1">คุณ</Badge>}</td>
                  <td>{u.display_name ?? '—'}</td>
                  <td>{active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                  <td>{Number(u.has_passkey) ? 'ตั้งแล้ว' : '—'}</td>
                  <td className="num">{fmtTime(u.last_login_at)}</td>
                  <td>
                    <Button size="sm" variant="outline-primary" className="me-1" onClick={() => rename(u)}>แก้ชื่อ</Button>
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
      </Card.Body>
    </Card>
  );
};

export default UsersTab;
