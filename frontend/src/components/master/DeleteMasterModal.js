// components/master/DeleteMasterModal.js — กล่องลบ master ทุกชนิด (item · จุดตรวจ · เครื่อง · ผู้ตรวจ · ลูกค้า · Division)
//
// Korn สั่ง (2026-11-12): "ให้โปรแกรมบอกได้มั้ยว่าใบอะไรที่ค้างอยู่ ให้เลือกเป็น soft delete และลบจริงได้"
//   เปิดกล่อง = GET /master/delete-impact (ไม่เขียนอะไร) → โชว์ใบตรวจ / งาน Set up ที่อ้างอยู่
//   ① ปิดใช้งาน (ค่าเริ่ม · แนะนำ) = PUT /master/update is_active 0 — ใบเก่าอ่านได้ครบ ไม่ขึ้นในตัวเลือกใหม่
//   ② ลบถาวร = DELETE /master/delete { force, confirm } — ลบใบ/งานที่อ้างไปด้วย · ADMIN เท่านั้น · พิมพ์ชื่อยืนยัน
//
// ⚠️ ไม่มีอะไรอ้าง = ลบถาวรแบบปกติได้เลย (ไม่ force · ไม่ต้องพิมพ์ชื่อ แต่ยังกดยืนยันในกล่อง)
// ⚠️ ตัวกั้นจริงอยู่ที่ backend (role ADMIN + confirm ตรงชื่อ) — ปุ่มที่ disable บนจอเป็นแค่ UI
// ⚠️ animation={false} + backdrop="static" + .form-note ไม่ใช่ <Alert> ตามกฎกล่องของทั้งแอป · โฟกัสเริ่มที่ปุ่มปิด
import React, { useEffect, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { apiCall } from '../../utils/api';
import { hasRole } from '../../utils/auth';
import useSession from '../../utils/useSession';
import { fmtDateTime } from '../../utils/dateFormat';

const KIND = {
  models: 'item', checkpoints: 'จุดตรวจ', machines: 'เครื่องจักร', inspectors: 'ผู้ตรวจ', customers: 'ลูกค้า', divisions: 'Division',
};
const JOB_STATUS = {
  pd_checking: 'PD กำลังตรวจ', waiting_qc: 'รอ QC', qc_checking: 'QC กำลังตรวจ', passed: 'ผ่าน', cancelled: 'ยกเลิก',
};

const DeleteMasterModal = ({ target, onHide, onDone }) => {
  const session = useSession();
  const isAdmin = hasRole(session, 'ADMIN');
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [choice, setChoice] = useState('soft');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!target) return undefined;
    let alive = true;
    setImpact(null); setErr(null); setTyped(''); setBusy(false); setLoading(true);
    apiCall(`/master/delete-impact?table=${target.table}&id=${target.id}`)
      .then((r) => {
        if (!alive) return;
        setImpact(r);
        const hasRefs = r.refs.inspections.total + r.refs.checkJobs.total > 0;
        // มีอ้างอยู่ + ยังเปิดอยู่ = แนะนำปิดใช้งาน · ไม่มีอะไรอ้าง หรือปิดอยู่แล้ว = ลบถาวร
        setChoice(hasRefs && r.isActive && r.softDelete ? 'soft' : 'hard');
      })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [target]);

  if (!target) return null;
  const ins = impact?.refs.inspections;
  const jobs = impact?.refs.checkJobs;
  const hasRefs = Boolean(impact) && ins.total + jobs.total > 0;
  const kind = KIND[target.table] ?? '';
  const hardBlocked = impact?.blockedReason || (hasRefs && !isAdmin);
  const typedOk = typed.trim().toLowerCase() === String(impact?.label ?? '').trim().toLowerCase();
  const canSubmit = impact && !busy && (
    choice === 'soft' || choice === 'restore'
    || (choice === 'hard' && !hardBlocked && (!hasRefs || typedOk))
  );

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (choice === 'soft' || choice === 'restore') {
        await apiCall('/master/update', { method: 'PUT', body: { table: target.table, id: target.id, data: { is_active: choice === 'soft' ? 0 : 1 } } });
        onDone({ kind: choice, label: impact.label });
      } else {
        const res = await apiCall('/master/delete', {
          method: 'DELETE',
          body: { table: target.table, id: target.id, ...(hasRefs ? { force: true, confirm: typed } : {}) },
        });
        onDone({ kind: 'hard', label: impact.label, ...res });
      }
    } catch (e) {
      setErr(e.message); setBusy(false);
    }
  };

  const reportLinks = (ins?.models ?? []).slice(0, 8);
  return (
    <Modal show onHide={busy ? undefined : onHide} animation={false} backdrop="static" size="lg">
      <Modal.Header closeButton={!busy}>
        <Modal.Title>ลบ{kind} "{target.label}"</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && <div className="text-muted"><Spinner size="sm" className="me-2" />กำลังตรวจว่ามีอะไรอ้างอยู่…</div>}
        {impact && (
          <>
            {!hasRefs && (
              <div className="form-note form-note--info mb-3">ไม่มีใบตรวจหรืองาน Set up อ้างอยู่ — ลบได้เลย</div>
            )}
            {hasRefs && (
              <div className="form-note form-note--warning mb-3">
                มีอ้างอยู่: <b>ใบตรวจ {ins.total} ใบ</b>{ins.voided ? ` (ยกเลิกแล้ว ${ins.voided})` : ''}
                {jobs.total > 0 && <> · <b>งาน Set up {jobs.total} งาน</b>{jobs.open ? ` (ยังค้าง ${jobs.open})` : ''}</>}
              </div>
            )}
            {impact.children.map((c) => <div key={c} className="small text-muted mb-1">• {c}</div>)}

            {ins.total > 0 && (
              <>
                <div className="cp-section mt-3">ใบตรวจที่อ้างอยู่ {ins.total > ins.list.length && <span className="fw-normal text-muted">(แสดง {ins.list.length} ใบล่าสุด)</span>}</div>
                <div className="mc-freeze del-list">
                  <table className="table table-sm mb-0 text-nowrap">
                    <thead><tr><th>ใบ #</th><th>วันที่</th><th>MO</th><th>item</th><th>เครื่อง</th><th>หมวด</th><th>ผล</th><th /></tr></thead>
                    <tbody>
                      {ins.list.map((r) => (
                        <tr key={r.id} className={r.voided_at ? 'text-muted' : undefined}>
                          <td className="num">{r.id}</td>
                          <td>{fmtDateTime(r.inspected_at)}</td>
                          <td>{r.mo_no || '—'}</td>
                          <td>{r.item_no}</td>
                          <td>{r.machine ?? '—'}</td>
                          <td>{r.category ?? '—'}</td>
                          <td className={r.overall_result === 'NG' ? 'text-danger fw-semibold' : undefined}>{r.overall_result ?? '—'}</td>
                          <td>{r.voided_at ? 'ยกเลิกแล้ว' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {reportLinks.length > 0 && (
                  <div className="small mt-1">
                    ดูในหน้ารายงาน:{' '}
                    {reportLinks.map((m, i) => (
                      <React.Fragment key={m.id}>
                        {i > 0 && ' · '}
                        <Link to={`/report?model=${m.id}`} target="_blank" rel="noreferrer">{m.item_no}</Link>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </>
            )}
            {jobs.total > 0 && (
              <>
                <div className="cp-section mt-3">งาน Set up / Last Piece ที่อ้างอยู่</div>
                <div className="mc-freeze del-list">
                  <table className="table table-sm mb-0 text-nowrap">
                    <thead><tr><th>งาน #</th><th>เปิดเมื่อ</th><th>หมวด</th><th>item</th><th>เครื่อง</th><th>MO</th><th>สถานะ</th></tr></thead>
                    <tbody>
                      {jobs.list.map((j) => (
                        <tr key={j.id}>
                          <td className="num">{j.id}</td>
                          <td>{fmtDateTime(j.opened_at)}</td>
                          <td>{j.category ?? '—'}</td>
                          <td>{j.item_no}</td>
                          <td>{j.machine ?? '—'}</td>
                          <td>{j.mo_no}</td>
                          <td>{JOB_STATUS[j.status] ?? j.status}{j.round_no > 1 ? ` (รอบ ${j.round_no})` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="cp-section mt-3">จะทำอะไร</div>
            <div role="radiogroup" aria-label="วิธีลบ">
              {impact.softDelete && impact.isActive && (
                <Form.Check type="radio" id="del-soft" name="del-choice" className="mb-2" disabled={busy}
                  checked={choice === 'soft'} onChange={() => setChoice('soft')}
                  label={<><b>ปิดใช้งาน</b> (แนะนำ) <span className="small text-muted d-block">ไม่ขึ้นในตัวเลือกของใบใหม่ · ใบเก่าและกราฟยังอ่านได้ครบ · เปิดกลับได้</span></>} />
              )}
              {impact.softDelete && !impact.isActive && (
                <Form.Check type="radio" id="del-restore" name="del-choice" className="mb-2" disabled={busy}
                  checked={choice === 'restore'} onChange={() => setChoice('restore')}
                  label={<><b>เปิดใช้งานอีกครั้ง</b> <span className="small text-muted d-block">ตอนนี้ปิดใช้งานอยู่</span></>} />
              )}
              {!impact.softDelete && (
                <div className="small text-muted mb-2">ปิดใช้งาน Division ได้หลังรัน <code>npm run db:apply</code></div>
              )}
              <Form.Check type="radio" id="del-hard" name="del-choice" disabled={busy || Boolean(hardBlocked)}
                checked={choice === 'hard'} onChange={() => setChoice('hard')}
                label={<><b className={hardBlocked ? undefined : 'text-danger'}>ลบถาวร</b>
                  {hasRefs && <> พร้อมใบตรวจ {ins.total} ใบ{jobs.total ? ` + งาน ${jobs.total} งาน` : ''}</>}
                  {impact.blockedReason && <span className="small text-muted d-block">{impact.blockedReason}</span>}
                  {!impact.blockedReason && hasRefs && !isAdmin && <span className="small text-muted d-block">ลบถาวรพร้อมใบตรวจได้เฉพาะ ADMIN</span>}
                </>} />
            </div>
            {choice === 'hard' && hasRefs && !hardBlocked && (
              <div className="form-note form-note--danger mt-2">
                <b>กู้คืนไม่ได้</b> — ใบตรวจ {ins.total} ใบ (รวมผลวัดทุกค่า · Event Log · ประวัติการแก้){jobs.total ? ` และงาน Set up ${jobs.total} งาน` : ''} จะหายจาก DB ถาวร
                หลักฐานการตรวจหายไปด้วย · item ที่ล็อก baseline ไว้อาจต้อง Re-baseline
                <Form.Group className="mt-2" controlId="del-confirm">
                  <Form.Label className="small mb-1">พิมพ์ <b>{impact.label}</b> เพื่อยืนยัน</Form.Label>
                  <Form.Control size="sm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={busy} />
                </Form.Group>
              </div>
            )}
          </>
        )}
        {err && <div className="form-note form-note--danger mt-2" role="status">{err}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={busy} autoFocus>ปิด</Button>
        <Button variant={choice === 'hard' ? 'danger' : 'primary'} onClick={submit} disabled={!canSubmit}>
          {busy && <Spinner size="sm" className="me-1" />}
          {choice === 'soft' ? 'ปิดใช้งาน' : choice === 'restore' ? 'เปิดใช้งาน' : 'ลบถาวร'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DeleteMasterModal;
