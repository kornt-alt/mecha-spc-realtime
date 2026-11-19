// components/master/CategoriesTab.js — แท็บ "หมวดการตรวจ" ในหน้า Master (สิทธิ์เมนู master.categories)
//
// check_categories: ชื่อ / คำอธิบาย (ขึ้นบนการ์ดหน้าแรก) / ใครตรวจ (flow) / ลำดับ / เปิด-ปิด
//   flow: pd_qc = PD ตรวจ → QC ยืนยัน · pd = PD ตรวจแล้วตัดสินเอง · qc = QC ตรวจเอง (routes/checkJobs.js)
// ⚠️ ไม่มีลบ (งาน/ใบตรวจอ้าง id อยู่) ใช้ปิดแทน · รหัส (code) ตั้งได้ตอนเพิ่มเท่านั้น
// ⚠️ หมวดตรวจตามรอบ (id 1) ปิดไม่ได้ และไม่มี "ใครตรวจ" — server ปฏิเสธซ้ำอีกชั้น
import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Table } from 'react-bootstrap';
import { apiCall } from '../../utils/api';

const ROUTINE = 1;
const FLOW_OPTIONS = [
  { value: 'pd_qc', label: 'PD ตรวจ → ส่ง QC ยืนยัน' },
  { value: 'pd', label: 'PD ตรวจอย่างเดียว (PD ตัดสินผ่าน/ไม่ผ่าน)' },
  { value: 'qc', label: 'QC ตรวจอย่างเดียว (QC เปิดงานเอง)' },
];
const flowLabel = (v) => FLOW_OPTIONS.find((o) => o.value === v)?.label ?? v;

const CategoriesTab = ({ showForm, say, fail }) => {
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    try { setRows(await apiCall('/master/categories')); } catch (e) { fail(e); }
  }, [fail]);
  useEffect(() => { load(); }, [load]);

  const fieldsOf = (c, isNew) => [
    ...(isNew ? [{ name: 'code', label: 'รหัส (ภาษาอังกฤษตัวเล็ก เช่น first_piece) — แก้ทีหลังไม่ได้', required: true }] : []),
    { name: 'name', label: 'ชื่อหมวด (ขึ้นบนเมนู/การ์ด)', required: true, defaultValue: c?.name ?? '' },
    { name: 'description', label: 'คำอธิบายบนการ์ดหน้าแรก (เว้นว่างได้)', defaultValue: c?.description ?? '' },
    ...(c?.id === ROUTINE ? [] : [{
      name: 'flow', label: 'ใครตรวจ', type: 'select', required: true,
      options: FLOW_OPTIONS, defaultValue: c?.flow ?? 'pd_qc',
    }]),
    { name: 'sort_order', label: 'ลำดับ (น้อยขึ้นก่อน)', type: 'number', defaultValue: String(c?.sort_order ?? 10) },
  ];

  const add = () => showForm({
    title: 'เพิ่มหมวดการตรวจ',
    body: 'หมวดใหม่เป็นงานส่งต่อแบบเดียวกับ Set up / Last Piece — ตั้งจุดตรวจของหมวดนี้ที่ "ตารางหมวดการตรวจ" ใต้จุดตรวจของแต่ละ item',
    confirmLabel: 'เพิ่ม',
    fields: fieldsOf(null, true),
    onConfirm: async (d) => {
      try {
        await apiCall('/master/categories', { method: 'POST', body: { ...d, sort_order: Number(d.sort_order) } });
        say('success', `เพิ่มหมวด "${d.name}" แล้ว`);
        await load();
      } catch (e) { fail(e); }
    },
  });

  const edit = (c) => showForm({
    title: `แก้หมวด "${c.name}"`,
    confirmLabel: 'บันทึก',
    fields: fieldsOf(c, false),
    onConfirm: async (d) => {
      try {
        await apiCall(`/master/categories/${c.id}`, { method: 'PUT', body: { ...d, sort_order: Number(d.sort_order) } });
        say('success', `บันทึกหมวด "${d.name}" แล้ว`);
        await load();
      } catch (e) { fail(e); }
    },
  });

  const toggle = async (c) => {
    try {
      await apiCall(`/master/categories/${c.id}`, { method: 'PUT', body: { is_active: !Number(c.is_active) } });
      say('success', `${Number(c.is_active) ? 'ปิด' : 'เปิด'}หมวด "${c.name}" แล้ว`);
      await load();
    } catch (e) { fail(e); }
  };

  return (
    <Card>
      <Card.Header className="d-flex align-items-center gap-2">
        <span>หมวดการตรวจ</span>
        <span className="small text-muted fw-normal">ขึ้นเป็นการ์ดที่หน้าแรก · เป็นกลุ่มคอลัมน์ในตารางหมวดของจุดตรวจ</span>
        <Button size="sm" className="ms-auto" onClick={add}>+ เพิ่มหมวด</Button>
      </Card.Header>
      <Card.Body className="p-2">
        <div className="mc-freeze">
          <Table bordered hover size="sm" className="mb-0 align-middle">
            <thead>
              <tr>
                <th className="text-center" style={{ width: 70 }}>ลำดับ</th>
                <th className="mc-sticky-start">หมวด</th>
                <th>คำอธิบาย</th>
                <th>ใครตรวจ</th>
                <th className="text-center">งานที่เปิดแล้ว</th>
                <th>สถานะ</th>
                <th className="mc-sticky-end" style={{ width: 150 }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={Number(c.is_active) ? '' : 'text-muted'}>
                  <td className="text-center num">{c.sort_order}</td>
                  <td className="mc-sticky-start">
                    <b>{c.name}</b> <span className="small text-muted">({c.code})</span>
                  </td>
                  <td className="small">{c.description || <span className="text-muted">—</span>}</td>
                  <td className="small">{c.id === ROUTINE ? 'ใบตรวจ Regular time (ไม่ต้อง login)' : flowLabel(c.flow)}</td>
                  <td className="text-center num">{c.id === ROUTINE ? '—' : c.job_count}</td>
                  <td>{Number(c.is_active) ? <Badge bg="success">ใช้งาน</Badge> : <Badge bg="secondary">ปิด</Badge>}</td>
                  <td className="mc-sticky-end text-nowrap">
                    <Button size="sm" variant="primary" className="me-1" onClick={() => edit(c)}>แก้</Button>
                    {c.id !== ROUTINE && (
                      <Button size="sm" variant={Number(c.is_active) ? 'outline-danger' : 'outline-primary'} onClick={() => toggle(c)}>
                        {Number(c.is_active) ? 'ปิด' : 'เปิด'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card.Body>
    </Card>
  );
};

export default CategoriesTab;
