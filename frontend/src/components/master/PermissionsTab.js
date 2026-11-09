// components/master/PermissionsTab.js — ตารางสิทธิ์เข้าเมนู role × เมนู (สิทธิ์เมนู master.users)
//
// GET/PUT /master/permissions · ช่องที่ล็อก (locked) แก้ไม่ได้: GUEST ของ Set up / Master = ปิดเสมอ ·
// ADMIN ของ "ผู้ใช้ & สิทธิ์" = เปิดเสมอ (กันล็อกตัวเองออก) — server ข้ามช่องพวกนี้อีกชั้น
// ⚠️ GUEST = คนที่ไม่ได้ login · เปิด GUEST = ทุกคนใช้เมนูนั้นได้โดยไม่ต้อง login (ช่องของ role อื่นไม่มีผล)
// ⚠️ ตัวกั้นจริงอยู่ที่ server (requireMenu) — ปิดหน้า Dashboard/SC/รายงาน กั้นได้ที่หน้าจอ แต่ API อ่านที่หลายหน้าใช้ร่วมกันยังเปิด
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Spinner, Table } from 'react-bootstrap';
import { apiCall } from '../../utils/api';

const ROLE_LABEL = { GUEST: 'ไม่ login', ADMIN: 'ADMIN', PD: 'PD', QC: 'QC' };

const PermissionsTab = ({ say, fail }) => {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiCall('/master/permissions');
      setData(d);
      setDraft(d.matrix);
    } catch (e) { fail(e); }
  }, [fail]);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => data && JSON.stringify(draft) !== JSON.stringify(data.matrix), [data, draft]);

  if (!data || !draft) return <div className="text-muted"><Spinner size="sm" animation="border" className="me-2" />กำลังโหลดสิทธิ์…</div>;

  const locked = (key, role) => data.locked[`${key}:${role}`] !== undefined;
  const toggle = (key, role) => setDraft((d) => ({ ...d, [key]: { ...d[key], [role]: !d[key][role] } }));

  const save = async () => {
    setSaving(true);
    try {
      await apiCall('/master/permissions', { method: 'PUT', body: { matrix: draft } });
      say('success', 'บันทึกสิทธิ์เมนูแล้ว — มีผลทันทีทุกเครื่อง');
      await load();
    } catch (e) { fail(e); } finally { setSaving(false); }
  };

  return (
    <Card className="mt-3">
      <Card.Header className="d-flex flex-wrap align-items-center gap-2">
        <span>สิทธิ์เข้าเมนู</span>
        <span className="small text-muted fw-normal">
          ติ๊ก = role นี้ใช้เมนูได้ · "ไม่ login" ติ๊ก = ทุกคนใช้ได้โดยไม่ต้องเข้าสู่ระบบ · ช่องจาง = ล็อกไว้กันระบบใช้ไม่ได้
        </span>
      </Card.Header>
      <Card.Body className="p-2">
        <div className="mc-freeze">
          <Table bordered hover size="sm" className="mb-0 align-middle">
            <thead>
              <tr>
                <th className="mc-sticky-start">เมนู</th>
                {data.roles.map((r) => <th key={r} className="text-center" style={{ width: 110 }}>{ROLE_LABEL[r] ?? r}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.menus.map((m) => {
                const changed = JSON.stringify(draft[m.key]) !== JSON.stringify(data.matrix[m.key]);
                return (
                  <tr key={m.key}>
                    <td className="mc-sticky-start">
                      {changed && <span className="me-1" style={{ color: 'var(--blue-text)' }} title="ยังไม่บันทึก">●</span>}
                      {m.label}
                    </td>
                    {data.roles.map((r) => (
                      <td key={r} className="text-center">
                        <Form.Check
                          className="d-inline-block perm-check"
                          aria-label={`${m.label} — ${ROLE_LABEL[r] ?? r}`}
                          checked={Boolean(draft[m.key]?.[r])}
                          disabled={locked(m.key, r) || saving}
                          title={locked(m.key, r) ? 'ล็อกไว้ — แก้ไม่ได้' : undefined}
                          onChange={() => toggle(m.key, r)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <div className="savebar">
          <span className="savebar__count">
            {dirty ? <b style={{ color: 'var(--red)' }}>ยังไม่บันทึก</b> : 'ยังไม่มีการแก้'}
          </span>
          <span className="savebar__spacer" />
          <Button variant="outline-secondary" disabled={!dirty || saving} onClick={() => setDraft(data.matrix)}>คืนค่าเดิม</Button>
          <Button disabled={!dirty || saving} onClick={save}>
            {saving && <Spinner size="sm" animation="border" className="me-1" />}บันทึกสิทธิ์
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default PermissionsTab;
