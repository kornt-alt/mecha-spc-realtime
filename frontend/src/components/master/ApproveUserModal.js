// components/master/ApproveUserModal.js — อนุมัติคำขอสมัคร (หน้า /register) ที่ Master › ผู้ใช้ & สิทธิ์
//
// เลือกสิทธิ์ (ค่าเริ่ม = ตำแหน่งที่ขอ) + ผู้ตรวจที่บัญชีนี้เป็น:
//   รหัสพนักงานตรงผู้ตรวจที่มีอยู่ → ค่าเริ่ม "ผูกกับคนนั้น" · ไม่ตรง → "สร้างผู้ตรวจใหม่" จากชื่อ/รหัสที่คนสมัครกรอก (แก้ได้)
// → POST /users/:id/approve (transaction เดียวฝั่ง server) · ⚠️ animation={false} + backdrop="static" · ข้อความใช้ .form-note
import React, { useEffect, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import { apiCall } from '../../utils/api';
import SearchSelect from '../SearchSelect';

const ROLE_KEYS = [
  { key: 'PD', label: 'PD (Production Check)' },
  { key: 'QC', label: 'QC (QC Confirm)' },
  { key: 'ADMIN', label: 'ADMIN (ตั้งค่า Master)' },
];

const ApproveUserModal = ({ user, inspectors = [], divisions = [], onHide, onDone }) => {
  const [roles, setRoles] = useState([]);
  const [mode, setMode] = useState('create');
  const [linkId, setLinkId] = useState('');
  const [newIns, setNewIns] = useState({ name: '', emp_code: '', division_id: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    setRoles(String(user.role ?? '').split(',').filter(Boolean));
    setMode(user.matched_inspector_id ? 'link' : 'create');
    setLinkId(user.matched_inspector_id ? String(user.matched_inspector_id) : '');
    setNewIns({ name: user.display_name ?? '', emp_code: user.reg_emp_code ?? '', division_id: user.reg_division_id ? String(user.reg_division_id) : '' });
    setErr('');
  }, [user]);

  const toggleRole = (k) => setRoles((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k]));
  const issue = !roles.length ? 'เลือกสิทธิ์อย่างน้อย 1 อย่าง'
    : mode === 'link' && !linkId ? 'เลือกผู้ตรวจที่จะผูก'
      : mode === 'create' && (!newIns.name.trim() || !newIns.emp_code.trim()) ? 'ผู้ตรวจใหม่ต้องมีชื่อและรหัสพนักงาน'
        : null;

  const approve = async () => {
    setBusy(true); setErr('');
    try {
      const inspector = mode === 'link' ? { mode, id: Number(linkId) }
        : mode === 'create' ? { mode, name: newIns.name.trim(), emp_code: newIns.emp_code.trim(), division_id: newIns.division_id || null }
          : { mode: 'none' };
      // ⚠️ ลำดับตามนิยาม SET ('ADMIN','PD','QC') — server เรียงให้อยู่แล้ว แต่ส่งเรียงไว้ให้ log อ่านง่าย
      const ordered = ['ADMIN', 'PD', 'QC'].filter((k) => roles.includes(k));
      await apiCall(`/users/${user.id}/approve`, { method: 'POST', body: { roles: ordered, inspector } });
      onDone(user);
    } catch (e) {
      setErr(e.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal show={Boolean(user)} onHide={busy ? undefined : onHide} animation={false} backdrop="static">
      <Modal.Header closeButton={!busy}>
        <Modal.Title>อนุมัติ {user?.username}</Modal.Title>
      </Modal.Header>
      {user && (
        <Modal.Body>
          <div className="small mb-3">
            {user.display_name} · รหัส {user.reg_emp_code ?? '—'} · {user.reg_division_name ?? 'ไม่ระบุ Division'} · ขอเป็น {user.role}
          </div>
          <div className="fw-semibold small mb-1">สิทธิ์</div>
          {ROLE_KEYS.map((r) => (
            <Form.Check key={r.key} inline id={`appr-role-${r.key}`} label={r.label}
              checked={roles.includes(r.key)} onChange={() => toggleRole(r.key)} disabled={busy} />
          ))}
          <div className="fw-semibold small mt-3 mb-1">ผู้ตรวจ (ชื่อที่ขึ้นบนใบตรวจ)</div>
          <Form.Check type="radio" id="appr-ins-link" name="appr-ins" disabled={busy}
            label={user.matched_inspector_id ? `ผูกกับผู้ตรวจที่มีอยู่ (รหัสตรง: ${user.matched_inspector_name})` : 'ผูกกับผู้ตรวจที่มีอยู่'}
            checked={mode === 'link'} onChange={() => setMode('link')} />
          {mode === 'link' && (
            <div className="ms-4 mb-2">
              <SearchSelect id="appr-ins-pick" value={linkId} onChange={setLinkId} placeholder="ค้นหาผู้ตรวจ"
                options={inspectors.map((i) => ({ value: String(i.id), label: i.name, hint: i.emp_code }))} />
            </div>
          )}
          <Form.Check type="radio" id="appr-ins-create" name="appr-ins" label="สร้างผู้ตรวจใหม่" disabled={busy}
            checked={mode === 'create'} onChange={() => setMode('create')} />
          {mode === 'create' && (
            <div className="ms-4 mb-2 d-flex flex-wrap gap-2">
              <Form.Control size="sm" style={{ maxWidth: 200 }} aria-label="ชื่อผู้ตรวจ" value={newIns.name}
                onChange={(e) => setNewIns((s) => ({ ...s, name: e.target.value }))} />
              <Form.Control size="sm" style={{ maxWidth: 120 }} aria-label="รหัสพนักงาน" value={newIns.emp_code}
                onChange={(e) => setNewIns((s) => ({ ...s, emp_code: e.target.value }))} />
              <Form.Select size="sm" style={{ maxWidth: 140 }} aria-label="Division ของผู้ตรวจ" value={newIns.division_id}
                onChange={(e) => setNewIns((s) => ({ ...s, division_id: e.target.value }))}>
                <option value="">— Division —</option>
                {divisions.filter((d) => Number(d.is_active ?? 1) === 1 || String(d.id) === newIns.division_id)
                  .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Form.Select>
            </div>
          )}
          <Form.Check type="radio" id="appr-ins-none" name="appr-ins" disabled={busy}
            label="ไม่ผูก (ADMIN ล้วน — PD/QC ที่ไม่ผูกจะตรวจงาน Set up ไม่ได้)"
            checked={mode === 'none'} onChange={() => setMode('none')} />
          {err && <div className="form-note form-note--danger mt-2">{err}</div>}
        </Modal.Body>
      )}
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={busy} autoFocus>ปิด</Button>
        <Button onClick={approve} disabled={busy || Boolean(issue)} title={issue ?? undefined}>
          {busy && <Spinner size="sm" className="me-1" />}อนุมัติ
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ApproveUserModal;
