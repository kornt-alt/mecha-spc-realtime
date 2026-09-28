// frontend/src/components/EditInspectionModal.js — แก้ค่าในใบตรวจเดิม (ต้อง login)
//
// ต่างจาก "แก้เป็นใบใหม่" ที่หน้าใบตรวจ: ใบนี้อยู่ที่เดิมบนกราฟ (เวลา/เลข subgroup ไม่เปลี่ยน)
// ทุกค่าที่เปลี่ยนลง inspection_result_edits (ค่าเดิม + ค่าใหม่ + เหตุผล + คนแก้) — PUT /inspections/:id/results
//
// ⚠️ ตัดสิน OK/NG ด้วย usl_used / lsl_used ของแถว (สเปก ณ วันที่ตรวจ) ไม่ใช่สเปกปัจจุบัน
//    judgeLocal ที่นี่เป็น advisory เหมือนหน้าใบตรวจ — ตัวตัดสินจริงคือ server
// ⚠️ ไม่มี session → โชว์ LoginForm ในกล่องเดียวกัน ไม่พาออกจากหน้า (ตัวกรองรายงานต้องไม่หาย)
//    401 ระหว่างบันทึก (token หมดอายุ) apiCall ล้าง session ให้แล้ว กล่องสลับไปหน้า login เอง
//    ค่าที่พิมพ์ค้างอยู่ใน state ของกล่อง login เสร็จกดบันทึกซ้ำได้เลย
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, Spinner } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { getSession, onSessionChange } from '../utils/auth';
import { judgeLocal, toNum } from '../utils/normalize';
import { decimalsOf } from './SpecValue';
import { LoginForm } from './RequireLogin';

const keyOf = (r) => `${r.checkpoint_id}:${r.piece_no}`;

// ทศนิยม max(ของสเปก, ของค่าจริง) — กฎเดียวกับ InputGrid ห้ามปัดค่าวัดทิ้ง
const fmtValue = (r, v) => (v === null ? '' : v.toFixed(Math.max(decimalsOf(toNum(r.usl_used), toNum(r.lsl_used)), decimalsOf(v))));

const fmtTime = (v) => (v ? new Date(v).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '—');

const specText = (r) => {
  const U = toNum(r.usl_used);
  const L = toNum(r.lsl_used);
  if (r.char_type === 'attribute') return 'ตรวจด้วยตา';
  if (U !== null && L !== null) return `${L} ~ ${U}`;
  if (U !== null) return `≤ ${U}`;
  if (L !== null) return `≥ ${L}`;
  return 'ไม่มีสเปก';
};

const EditInspectionModal = ({ inspectionId, onHide, onSaved }) => {
  const [session, setSess] = useState(getSession);
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => onSessionChange(setSess), []);

  useEffect(() => {
    if (!inspectionId) return undefined;
    let cancelled = false;
    setData(null);
    setError(null);
    setReason('');
    (async () => {
      try {
        const res = await apiCall(`/inspections/${inspectionId}`);
        if (cancelled) return;
        setData(res);
        setValues(Object.fromEntries((res.results ?? []).map((r) => [
          keyOf(r),
          r.char_type === 'attribute' ? r.judgment : fmtValue(r, toNum(r.value)),
        ])));
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [inspectionId]);

  // จัดกลุ่มตามจุดตรวจ (1 แถว = 1 จุด · คอลัมน์ = ชิ้น) — results มาเรียง seq_no, piece_no แล้ว
  const groups = useMemo(() => {
    const out = [];
    for (const r of data?.results ?? []) {
      const last = out[out.length - 1];
      if (last && last.checkpoint_id === r.checkpoint_id) last.rows.push(r);
      else out.push({ checkpoint_id: r.checkpoint_id, rows: [r] });
    }
    return out;
  }, [data]);
  const maxPieces = Math.max(1, ...groups.map((g) => g.rows.length));

  const original = (r) => (r.char_type === 'attribute' ? r.judgment : fmtValue(r, toNum(r.value)));
  const changed = (data?.results ?? []).filter((r) => {
    const v = values[keyOf(r)] ?? '';
    if (r.char_type === 'attribute') return v !== r.judgment;
    return toNum(v) !== toNum(r.value);
  });
  const invalid = (data?.results ?? []).some((r) => r.char_type !== 'attribute' && toNum(values[keyOf(r)]) === null);
  const voided = Boolean(data?.inspection?.voided_at);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiCall(`/inspections/${inspectionId}/results`, {
        method: 'PUT',
        body: {
          reason,
          results: changed.map((r) => (r.char_type === 'attribute'
            ? { checkpoint_id: r.checkpoint_id, piece_no: r.piece_no, judgment: values[keyOf(r)] }
            : { checkpoint_id: r.checkpoint_id, piece_no: r.piece_no, value: values[keyOf(r)] })),
        },
      });
      onSaved?.(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const ins = data?.inspection;

  return (
    <Modal show={Boolean(inspectionId)} onHide={onHide} size="xl" animation={false}>
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5">
          แก้ค่าในใบตรวจ{ins ? ` #${ins.subgroup_no} · MO ${ins.mo_no}` : ''}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!session ? (
          <>
            <p className="text-muted">แก้ค่าในใบเดิมต้อง login ก่อน (บัญชีเดียวกับหน้า Master)</p>
            <LoginForm idPrefix="edit-login" />
          </>
        ) : !data ? (
          error ? <div className="text-danger">{error}</div>
            : <div className="empty"><Spinner animation="border" size="sm" className="me-2" />กำลังโหลด</div>
        ) : (
          <>
            <div className="small text-muted mb-2">
              {fmtTime(ins.inspected_at)} · {ins.machine_name} · กะ {ins.shift} · {ins.inspector_name}
              {' '}— จุดบนกราฟอยู่ที่เดิม ตัดสิน OK/NG ด้วยสเปก ณ วันที่ตรวจ
            </div>
            {voided && <div className="text-danger mb-2">ใบนี้ถูกยกเลิกแล้ว — คืนค่าก่อนถึงจะแก้ได้</div>}

            <div className="sheet-wrap" style={{ maxHeight: '50vh' }}>
              <table className="sheet">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">จุดตรวจ</th>
                    <th scope="col">สเปก (ตอนตรวจ)</th>
                    {Array.from({ length: maxPieces }, (_, i) => <th key={i} scope="col">ชิ้นที่ {i + 1}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const head = g.rows[0];
                    return (
                      <tr key={g.checkpoint_id}>
                        <td className="num text-muted">{head.seq_no}</td>
                        <th scope="row" className="fw-normal">{head.checkpoint_name}</th>
                        <td className="num small">{specText(head)}</td>
                        {Array.from({ length: maxPieces }, (_, i) => {
                          const r = g.rows[i];
                          if (!r) return <td key={i} aria-hidden="true" />;
                          const k = keyOf(r);
                          const v = values[k] ?? '';
                          const isChanged = changed.includes(r);
                          if (r.char_type === 'attribute') {
                            return (
                              <td key={i} className={isChanged ? 'cell-edited' : ''}>
                                <select className={`cell${v === 'NG' ? ' cell--ng' : ''}`} value={v} disabled={voided}
                                  aria-label={`${head.checkpoint_name} ผลตรวจ`}
                                  onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}>
                                  <option value="OK">OK</option>
                                  <option value="NG">NG</option>
                                </select>
                              </td>
                            );
                          }
                          const j = judgeLocal(v, r.usl_used, r.lsl_used);
                          return (
                            <td key={i} className={isChanged ? 'cell-edited' : ''}
                              title={isChanged ? `ค่าเดิม ${original(r)}` : undefined}>
                              {/* ⚠️ type="text" ไม่ใช่ number — เหตุผลเดียวกับช่องในใบตรวจ */}
                              <input type="text" inputMode="decimal" autoComplete="off" disabled={voided}
                                className={`cell${j === 'NG' ? ' cell--ng' : ''}`}
                                aria-label={`${head.checkpoint_name} ชิ้นที่ ${r.piece_no}`}
                                value={v}
                                onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))} />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Form.Group className="mt-3" controlId="edit-reason">
              <Form.Label>เหตุผลที่แก้ <span className="text-danger">*</span></Form.Label>
              <Form.Control value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255}
                placeholder='เช่น "พิมพ์ค่าชิ้นที่ 2 ผิด ตรวจกับใบกระดาษแล้ว"' disabled={voided} />
              <Form.Text>บันทึกในประวัติพร้อมชื่อ {session.user?.display_name || session.user?.username}</Form.Text>
            </Form.Group>
            {error && <div className="text-danger mt-2">{error}</div>}

            {data.edits?.length > 0 && (
              <details className="mt-3">
                <summary>ประวัติการแก้ ({data.edits.length})</summary>
                <table className="sheet mt-2">
                  <thead>
                    <tr>
                      <th scope="col">เวลา</th><th scope="col">จุดตรวจ</th><th scope="col">ชิ้น</th>
                      <th scope="col">ค่าเดิม</th><th scope="col">ค่าใหม่</th><th scope="col">เหตุผล</th><th scope="col">โดย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.edits.map((e) => (
                      <tr key={e.id}>
                        <td className="num">{fmtTime(e.edited_at)}</td>
                        <td>{e.checkpoint_name}</td>
                        <td className="num">{e.piece_no}</td>
                        <td className="num">{e.old_value ?? e.old_judgment} {e.old_value !== null && `(${e.old_judgment})`}</td>
                        <td className="num">{e.new_value ?? e.new_judgment} {e.new_value !== null && `(${e.new_judgment})`}</td>
                        <td>{e.reason}</td>
                        <td>{e.edited_by_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        {session && data && (
          <span className="me-auto small text-muted">
            {invalid ? 'มีช่องที่ไม่ใช่ตัวเลข' : `เปลี่ยน ${changed.length} ค่า`}
          </span>
        )}
        <Button variant="outline-secondary" onClick={onHide} autoFocus>ปิด</Button>
        {session && data && (
          <Button variant="primary" onClick={save}
            disabled={busy || voided || invalid || changed.length === 0 || !reason.trim()}>
            {busy && <Spinner size="sm" animation="border" className="me-1" />}
            บันทึกการแก้
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default EditInspectionModal;
