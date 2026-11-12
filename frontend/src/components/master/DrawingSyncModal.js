// components/master/DrawingSyncModal.js — "ดึงจาก Drawing Digital" (Master › ข้อมูลพื้นฐาน)
//
// เปิดกล่อง = GET /master/drawing-sync/preview (ไม่เขียนอะไร) → โชว์ว่าจะเพิ่ม / ผูก / ปิดใช้งาน / ข้ามอะไร
// กดยืนยัน = POST /master/drawing-sync/apply — server คำนวณแผนใหม่ใน transaction เอง (ไม่ส่งแผนจากหน้าจอไป)
// ⚠️ ทางเดียว Drawing → SPC · ไม่ทับชื่อที่ตั้งไว้ · ไม่เปิดคืนของที่ SPC ปิดเอง (กฎอยู่ที่ backend/services/drawingSync.js)
import React, { useEffect, useState } from 'react';
import { Button, Modal, Spinner } from 'react-bootstrap';
import { apiCall } from '../../utils/api';

const Section = ({ title, rows, render, empty }) => (
  <div className="mb-3">
    <div className="cp-section">{title} <span className="text-muted fw-normal">({rows.length})</span></div>
    {rows.length === 0
      ? <div className="small text-muted">{empty}</div>
      : (
        <div className="mc-freeze sync-list">
          <table className="table table-sm mb-0">
            <tbody>{rows.map(render)}</tbody>
          </table>
        </div>
      )}
  </div>
);

const DrawingSyncModal = ({ show, onHide, onDone }) => {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!show) return undefined;
    let alive = true;
    setPlan(null); setErr(null); setLoading(true); setBusy(false);
    apiCall('/master/drawing-sync/preview')
      .then((p) => alive && setPlan(p))
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [show]);

  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await apiCall('/master/drawing-sync/apply', { method: 'POST' });
      onDone(res);
    } catch (e) {
      setErr(e.message); setBusy(false);
    }
  };

  const m = plan?.machines;
  const it = plan?.items;
  return (
    <Modal show={show} onHide={busy ? undefined : onHide} animation={false} backdrop="static" size="lg">
      <Modal.Header closeButton={!busy}>
        <Modal.Title>ดึงจาก Drawing Digital</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="form-note form-note--info mb-3">
          ดึงเครื่องจักร / item / เครื่อง↔item ที่รันได้ จากระบบ Drawing Digital (MECHA1) มาไว้ในระบบนี้ —
          อ่านอย่างเดียว ไม่แก้ระบบ Drawing · ชื่อที่ตั้งไว้แล้วไม่ถูกเปลี่ยน · ของที่ไม่มีใน Drawing (เช่น Mecha 2) ไม่ถูกแตะ
        </div>
        {loading && <div className="text-muted"><Spinner size="sm" className="me-2" />กำลังเทียบข้อมูล…</div>}
        {plan && (
          <>
            {plan.changed === 0 && <div className="form-note form-note--info mb-3">ข้อมูลตรงกับ Drawing แล้ว ไม่มีอะไรต้องดึง</div>}
            {plan.warnings.map((w) => <div key={w} className="form-note form-note--warning mb-2">{w}</div>)}
            <Section title="เครื่องจักรที่จะเพิ่ม" rows={m.add} empty="ไม่มี"
              render={(r) => <tr key={r.code}><td className="fw-semibold">{r.code}</td><td>{r.name}</td><td className="small text-muted">{r.division_name}{r.allow_all_items ? ' · รันได้ทุก item' : ''}</td></tr>} />
            <Section title="เครื่องจักรที่มีอยู่แล้ว — จะผูกกับ Drawing" rows={m.link} empty="ไม่มี"
              render={(r) => <tr key={r.id}><td className="fw-semibold">{r.name}</td><td className="small">{r.changes.join(' · ')}</td></tr>} />
            {m.deactivate.length > 0 && (
              <Section title="เครื่องจักรที่จะปิดใช้งาน (ปิดใน Drawing แล้ว)" rows={m.deactivate} empty=""
                render={(r) => <tr key={r.id}><td>{r.code}</td><td>{r.name}</td></tr>} />
            )}
            <Section title="Item ที่จะเพิ่ม" rows={it.add} empty="ไม่มี"
              render={(r) => <tr key={r.item_no}><td className="fw-semibold">{r.item_no}</td><td>{r.item_name}</td><td className="small text-muted">{r.drawing_no ?? '—'} · {r.division_name}</td></tr>} />
            <Section title="Item ที่มีอยู่แล้ว — จะผูกกับ Drawing" rows={it.link} empty="ไม่มี"
              render={(r) => <tr key={r.id}><td className="fw-semibold">{r.item_no}</td><td>{r.item_name}</td><td className="small">{r.changes.join(' · ')}</td></tr>} />
            {it.deactivate.length > 0 && (
              <Section title="Item ที่จะปิดใช้งาน (ปิดใน Drawing แล้ว)" rows={it.deactivate} empty=""
                render={(r) => <tr key={r.id}><td>{r.item_no}</td><td>{r.item_name}</td></tr>} />
            )}
            {(m.skip.length > 0 || it.skip.length > 0) && (
              <Section title="ข้าม (ดึงไม่ได้)" rows={[...m.skip.map((s) => ({ ...s, key: `m${s.code}`, label: `เครื่อง ${s.code}` })), ...it.skip.map((s) => ({ ...s, key: `i${s.item_no}`, label: `item ${s.item_no}` }))]} empty=""
                render={(r) => <tr key={r.key}><td className="fw-semibold">{r.label}</td><td className="small">{r.reason}</td></tr>} />
            )}
            <div className="cp-section">เครื่อง↔item ที่รันได้</div>
            <div className="small">
              {plan.links.total} คู่ บน {plan.links.machines.length} เครื่อง (เพิ่ม {plan.links.add} · เอาออก {plan.links.remove})
              — หน้าใบตรวจ / เปิดงาน Set up เลือกเครื่องแล้วจะเห็นเฉพาะ item ที่รันได้ (มีปุ่มดูทั้งหมด) · เครื่องที่ตั้ง "รันได้ทุก item" ใน Drawing ไม่กรอง
            </div>
          </>
        )}
        {err && <div className="form-note form-note--danger mt-2" role="status">{err}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={busy}>ปิด</Button>
        <Button onClick={apply} disabled={!plan || plan.changed === 0 || busy}>
          {busy && <Spinner size="sm" className="me-1" />}ยืนยันดึงข้อมูล
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DrawingSyncModal;
