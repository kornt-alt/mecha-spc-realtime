// frontend/src/components/SetupJobs.js — หน้า /setup งานตรวจที่ส่งต่อ PD → QC (Set up / Last Piece)
//
// ลำดับตามชีต "SET UP & LAST PIECE INSPECTION RECORD":
//   PD เปิดงานด้วยเลข WOS → กรอก Production Check → ส่ง → คิว QC (badge + toast)
//   → QC รับงาน → กรอก QC Confirm → ผ่าน / ไม่ผ่าน (ตีกลับ PD เป็นรอบใหม่)
//
// ⚠️ ต้อง login (RequireLogin ที่ App.js) · ปุ่มที่โชว์ตาม role เป็นแค่ UI ตัวกั้นจริงคือ requireRole ฝั่ง backend
// ⚠️ ไม่ตัดสินอะไรเอง — สีแดงตอนพิมพ์คือ judgeLocal (advisory) ผลจริงมาจาก server
// ⚠️ ตารางกรอก = จุดตรวจเป็นแถว ชิ้นเป็นคอลัมน์ ตามชีต SET UP (ต่างจากใบตรวจตามรอบที่กลับด้านตามชีต Input)
// ⚠️ ?job= คือที่อยู่ของงานที่เปิดดู (useUrlParam) — QC กดจาก toast/คิวแล้วรีเฟรชได้ไม่หลุด
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge, Button, Card, Col, Container, Form, Row, Spinner, Table, Toast, ToastContainer,
} from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { hasRole } from '../utils/auth';
import useSession from '../utils/useSession';
import { useDialog } from '../utils/useDialog';
import { useUrlParam } from '../utils/useModelParam';
import { on } from '../utils/socket';
import { SHIFTS } from '../utils/config';
import { fmtDateTime } from '../utils/dateFormat';
import { judgeLocal, normalizeCheckpoints, normalizeRows, toNum } from '../utils/normalize';
import AppDialog from './AppDialog';
import MoLookupBar from './MoLookupBar';
import SearchSelect from './SearchSelect';
import SpecValue from './SpecValue';

// ── สถานะ ─────────────────────────────────────────────────────────────────
// สี: แดง = ไม่ผ่าน (ของเสีย) · เขียว = ผ่าน · น้ำเงิน = งานที่เดินอยู่ · ไม่ใช้เหลือง (แกนเหลืองคือ control limit)
export const statusInfo = (job) => {
  switch (job.status) {
    case 'pd_checking':
      return Number(job.round_no) > 1
        ? { label: `ตีกลับ — PD ตรวจใหม่ (รอบ ${job.round_no})`, bg: 'danger' }
        : { label: 'PD กำลังตรวจ', bg: 'secondary' };
    case 'waiting_qc': return { label: 'รอ QC รับงาน', bg: 'primary' };
    case 'qc_checking': return { label: 'QC กำลังตรวจ', bg: 'info' };
    case 'passed': return { label: 'ผ่าน', bg: 'success' };
    case 'cancelled': return { label: 'ยกเลิก', bg: 'dark' };
    default: return { label: job.status, bg: 'secondary' };
  }
};

const ACTION_LABEL = {
  open: 'PD เปิดงาน',
  pd_submit: 'PD ส่งให้ QC',
  qc_accept: 'QC รับงาน',
  qc_pass: 'QC ยืนยัน ผ่าน',
  qc_reject: 'QC ไม่ผ่าน — ตีกลับ PD',
  cancel: 'ยกเลิกงาน',
};

// "รอมา 12 นาที" — นับจากเหตุการณ์ล่าสุดของงาน
const waitedText = (from, now) => {
  const t = from ? new Date(from).getTime() : NaN;
  if (!Number.isFinite(t)) return '—';
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 60) return `${min} นาที`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} ชม. ${min % 60} นาที` : `${Math.floor(h / 24)} วัน ${h % 24} ชม.`;
};

const useNow = (ms = 30000) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
};

// ── ตารางกรอกค่า (1 ขั้น) ───────────────────────────────────────────────────
//
// values: { '<cpId>:<piece>': string } · attribute: { '<cpId>:1': 'OK'|'NG' }
// ⚠️ ช่องกรอกเป็น type="text" inputMode="decimal" ห้าม type="number" (กฎเดียวกับใบตรวจตามรอบ:
//    type=number ปฏิเสธบางรูปแบบแล้วคืนค่าว่างเงียบ ๆ)
const keyOf = (cpId, piece) => `${cpId}:${piece}`;

export const buildResults = (checkpoints, values) => checkpoints.flatMap((cp) => {
  if (cp.char_type === 'attribute') {
    const j = values[keyOf(cp.id, 1)];
    return j ? [{ checkpoint_id: cp.id, judgment: j }] : [];
  }
  const pieces = [];
  for (let p = 1; p <= cp.sample_size; p += 1) {
    const v = String(values[keyOf(cp.id, p)] ?? '').trim();
    if (v !== '') pieces.push({ piece_no: p, value: v });
  }
  return pieces.length ? [{ checkpoint_id: cp.id, pieces }] : [];
});

// จุดที่กรอกครบทุกชิ้นแล้ว (นับเฉพาะตัวเลขที่อ่านได้)
export const isComplete = (cp, values) => (cp.char_type === 'attribute'
  ? Boolean(values[keyOf(cp.id, 1)])
  : Array.from({ length: cp.sample_size }, (_, i) => toNum(values[keyOf(cp.id, i + 1)])).every((v) => v !== null));

const StageForm = ({ checkpoints, values, onChange, disabled }) => {
  const maxQty = Math.max(1, ...checkpoints.map((c) => c.sample_size));
  const set = (k, v) => onChange((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="table-responsive">
      <Table size="sm" bordered className="align-middle mb-0 setup-grid">
        <thead>
          <tr>
            <th style={{ width: 40 }}>No</th>
            <th>จุดตรวจ</th>
            <th>สเปก</th>
            <th>เครื่องมือวัด</th>
            {Array.from({ length: maxQty }, (_, i) => (
              <th key={i} className="text-center" style={{ width: 96 }}>{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {checkpoints.map((cp) => (
            <tr key={cp.id}>
              <td>{cp.seq_no}</td>
              <td>{cp.name}{cp.is_critical ? <Badge bg="danger" className="ms-1">SC</Badge> : null}</td>
              <td className="small"><SpecValue checkpoint={cp} /></td>
              <td className="small text-muted">{cp.gauge || '—'}</td>
              {Array.from({ length: maxQty }, (_, i) => {
                const piece = i + 1;
                if (cp.char_type === 'attribute') {
                  if (piece > 1) return <td key={piece} className="bg-light" />;
                  const k = keyOf(cp.id, 1);
                  return (
                    <td key={piece} colSpan={1}>
                      <Form.Select size="sm" value={values[k] ?? ''} disabled={disabled}
                        aria-label={`${cp.name} ผล`}
                        onChange={(e) => set(k, e.target.value)}>
                        <option value="">—</option>
                        <option value="OK">OK</option>
                        <option value="NG">NG</option>
                      </Form.Select>
                    </td>
                  );
                }
                if (piece > cp.sample_size) return <td key={piece} className="bg-light" />;
                const k = keyOf(cp.id, piece);
                const ng = judgeLocal(values[k], cp.usl, cp.lsl) === 'NG';
                return (
                  <td key={piece}>
                    <Form.Control size="sm" type="text" inputMode="decimal" autoComplete="off"
                      value={values[k] ?? ''} disabled={disabled}
                      aria-label={`${cp.name} ชิ้นที่ ${piece}`}
                      isInvalid={ng}
                      onChange={(e) => set(k, e.target.value)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

// ── ผลที่บันทึกแล้ว: แถว = จุดตรวจ · คอลัมน์ = ชิ้นของแต่ละใบ (PD / QC ของรอบนั้นคู่กัน) ──────────
const ResultsTable = ({ checkpoints, inspections }) => {
  const cps = useMemo(() => {
    const map = new Map();
    for (const cp of [...checkpoints.pd, ...checkpoints.qc]) if (!map.has(cp.id)) map.set(cp.id, cp);
    return [...map.values()].sort((a, b) => a.seq_no - b.seq_no);
  }, [checkpoints]);
  if (!inspections.length) return <div className="small text-muted">ยังไม่มีผลตรวจที่บันทึก</div>;

  const cols = inspections.map((ins) => ({
    ins,
    n: Math.max(1, ...ins.results.map((r) => r.piece_no)),
  }));

  return (
    <div className="table-responsive">
      <Table size="sm" bordered className="align-middle small mb-0">
        <thead>
          <tr>
            <th rowSpan={2}>จุดตรวจ</th>
            {cols.map(({ ins, n }) => (
              <th key={ins.id} colSpan={n} className="text-center">
                รอบ {ins.round_no ?? '?'} · {ins.stage === 'pd' ? 'Production Check' : 'QC Confirm'}
                <div className="fw-normal text-muted">{ins.inspector_name} · {fmtDateTime(ins.inspected_at)}</div>
              </th>
            ))}
          </tr>
          <tr>
            {cols.flatMap(({ ins, n }) => Array.from({ length: n }, (_, i) => (
              <th key={`${ins.id}-${i}`} className="text-center">{i + 1}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {cps.map((cp) => (
            <tr key={cp.id}>
              <td>{cp.seq_no}. {cp.name}</td>
              {cols.flatMap(({ ins, n }) => Array.from({ length: n }, (_, i) => {
                const r = ins.results.find((x) => x.checkpoint_id === cp.id && x.piece_no === i + 1);
                const text = r ? (r.value ?? r.judgment) : '';
                return (
                  <td key={`${ins.id}-${i}`} className="text-center"
                    style={r?.judgment === 'NG' ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
                    {text}
                  </td>
                );
              }))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

// ── รายละเอียดงาน + ขั้นที่ต้องทำ ────────────────────────────────────────────
const JobDetail = ({ jobId, session, onBack, showAlert, showPrompt }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    try {
      const res = await apiCall(`/check-jobs/${jobId}`);
      if (req !== reqRef.current) return;
      setData({
        ...res,
        checkpoints: { pd: normalizeCheckpoints(res.checkpoints.pd), qc: normalizeCheckpoints(res.checkpoints.qc) },
        inspections: res.inspections.map((i) => ({ ...i, results: normalizeRows(i.results) })),
      });
      setError(null);
    } catch (err) {
      if (req === reqRef.current) setError(err.message);
    }
  }, [jobId]);

  useEffect(() => { setData(null); setValues({}); load(); }, [load]);
  // งานนี้ถูกขยับจากจออื่น (QC รับ / PD ส่งรอบใหม่) → โหลดใหม่ · ค่าที่กรอกค้างไม่ล้าง
  useEffect(() => on('check_job_updated', (e) => { if (Number(e.id) === Number(jobId)) load(); }), [jobId, load]);

  if (error) return <div style={{ color: 'var(--red)' }}>{error}</div>;
  if (!data) return <Spinner animation="border" size="sm" />;

  const { job, events, inspections, checkpoints } = data;
  const st = statusInfo(job);
  const isPD = hasRole(session, 'PD');
  const isQC = hasRole(session, 'QC');
  const lastAccept = [...events].reverse().find((e) => e.action === 'qc_accept');
  const mineQc = lastAccept && Number(lastAccept.user_id) === Number(session?.user?.id);
  const open = ['pd_checking', 'waiting_qc', 'qc_checking'].includes(job.status);

  const stage = job.status === 'pd_checking' && isPD ? 'pd'
    : job.status === 'qc_checking' && isQC && mineQc ? 'qc'
      : null;
  const stageCps = stage ? checkpoints[stage] : [];
  const allDone = stageCps.length > 0 && stageCps.every((cp) => isComplete(cp, values));
  const anyNg = stageCps.some((cp) => (cp.char_type === 'attribute'
    ? values[keyOf(cp.id, 1)] === 'NG'
    : Array.from({ length: cp.sample_size }, (_, i) => judgeLocal(values[keyOf(cp.id, i + 1)], cp.usl, cp.lsl)).includes('NG')));

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      setValues({});
      if (okText) showAlert({ title: 'สำเร็จ', body: okText });
      await load();
    } catch (err) {
      showAlert({ title: 'ทำรายการไม่สำเร็จ', body: err.message });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const submitPd = () => run(() => apiCall(`/check-jobs/${job.id}/submit`, {
    method: 'POST', body: { results: buildResults(stageCps, values) },
  }), 'ส่งให้ QC แล้ว — งานเข้าคิว QC');

  const accept = () => run(() => apiCall(`/check-jobs/${job.id}/accept`, { method: 'POST' }), null);

  const pass = () => run(() => apiCall(`/check-jobs/${job.id}/decide`, {
    method: 'POST', body: { result: 'pass', results: buildResults(stageCps, values) },
  }), 'ยืนยันผ่านแล้ว — ปิดงาน');

  const fail = () => showPrompt({
    title: 'ไม่ผ่าน — ตีกลับ PD',
    body: 'ระบุเหตุผล/จุดที่ต้องแก้ ให้ PD เห็น (ค่าที่กรอกไว้จะถูกบันทึกเป็นหลักฐานด้วย)',
    inputLabel: 'เหตุผล',
    confirmLabel: 'ตีกลับ PD',
    onConfirm: (note) => run(() => apiCall(`/check-jobs/${job.id}/decide`, {
      method: 'POST', body: { result: 'fail', note, results: buildResults(stageCps, values) },
    }), 'ตีกลับ PD แล้ว'),
  });

  const cancel = () => showPrompt({
    title: `ยกเลิกงาน WOS ${job.mo_no}`,
    body: 'ใบตรวจที่บันทึกไปแล้วยังอยู่เป็นหลักฐาน',
    inputLabel: 'เหตุผลที่ยกเลิก',
    confirmLabel: 'ยกเลิกงาน',
    cancelLabel: 'ปิด',
    onConfirm: (reason) => run(() => apiCall(`/check-jobs/${job.id}/cancel`, { method: 'POST', body: { reason } }), null),
  });

  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-2 no-print">
        <Button size="sm" variant="link" className="p-0" onClick={onBack}>← กลับไปที่คิว</Button>
      </div>

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <h2 className="fs-5 mb-0">{job.category_name} · WOS {job.mo_no}</h2>
            <Badge bg={st.bg}>{st.label}</Badge>
            <span className="small text-muted">งาน #{job.id}</span>
          </div>
          <Row className="small mt-2 g-1">
            <Col md={4}>Item: <b>{job.item_no}</b> {job.item_name}</Col>
            <Col md={3}>Drawing: {job.drawing_no || '—'}{job.drawing_rev ? ` Rev ${job.drawing_rev}` : ''}</Col>
            <Col md={2}>เครื่อง: <b>{job.machine_code}</b></Col>
            <Col md={1}>กะ: <b>{job.shift}</b></Col>
            <Col md={2}>Lot: {job.lot_no || '—'}</Col>
          </Row>
          {job.status === 'pd_checking' && job.last_reject_note && (
            <div className="small mt-2" style={{ color: 'var(--red)' }}>
              QC ตีกลับ: {job.last_reject_note}
            </div>
          )}
        </Card.Body>
      </Card>

      {/* ── ขั้นที่ต้องทำตอนนี้ ── */}
      {stage && (
        <Card className="mb-3">
          <Card.Header>
            {stage === 'pd' ? `Production Check — รอบ ${job.round_no}` : `QC Confirm — รอบ ${job.round_no}`}
          </Card.Header>
          <Card.Body>
            {stageCps.length === 0 ? (
              <div className="small text-muted">ยังไม่ได้ตั้งจุดตรวจของขั้นนี้ — ให้ ADMIN ตั้งที่ Master › จุดตรวจ</div>
            ) : (
              <StageForm checkpoints={stageCps} values={values} onChange={setValues} disabled={busy} />
            )}
            <div className="d-flex flex-wrap gap-2 mt-3">
              {stage === 'pd' && (
                <Button disabled={busy || !allDone} onClick={submitPd}>ส่งให้ QC</Button>
              )}
              {stage === 'qc' && (
                <>
                  <Button variant="success" disabled={busy || !allDone || anyNg} onClick={pass}>ผ่าน</Button>
                  <Button variant="danger" disabled={busy} onClick={fail}>ไม่ผ่าน — ตีกลับ PD</Button>
                </>
              )}
              {!allDone && stageCps.length > 0 && (
                <span className="small text-muted align-self-center">กรอกให้ครบทุกช่องก่อน</span>
              )}
              {stage === 'qc' && anyNg && (
                <span className="small align-self-center" style={{ color: 'var(--red)' }}>มีค่า NG — ยืนยันผ่านไม่ได้</span>
              )}
            </div>
          </Card.Body>
        </Card>
      )}

      {job.status === 'waiting_qc' && isQC && (
        <Card className="mb-3"><Card.Body className="d-flex align-items-center gap-3">
          <span>PD ส่งงานมาแล้ว — กดรับงานเพื่อเริ่มตรวจ (ระบบบันทึกเวลารับงาน)</span>
          <Button disabled={busy} onClick={accept}>รับงาน</Button>
        </Card.Body></Card>
      )}
      {job.status === 'qc_checking' && isQC && !mineQc && (
        <div className="small text-muted mb-3">งานนี้ {lastAccept?.user_name} รับไว้แล้ว</div>
      )}

      <Card className="mb-3">
        <Card.Header>ผลตรวจที่บันทึกแล้ว</Card.Header>
        <Card.Body><ResultsTable checkpoints={checkpoints} inspections={inspections} /></Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Header>ลำดับเวลา</Card.Header>
        <Card.Body className="p-0">
          <Table size="sm" className="mb-0 small">
            <thead><tr><th>เวลา</th><th>รอบ</th><th>ขั้น</th><th>โดย</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="text-nowrap">{fmtDateTime(e.at)}</td>
                  <td>{e.round_no}</td>
                  <td style={e.action === 'qc_reject' ? { color: 'var(--red)' } : e.action === 'qc_pass' ? { color: 'var(--green)' } : undefined}>
                    {ACTION_LABEL[e.action] ?? e.action}
                  </td>
                  <td>{e.user_name}</td>
                  <td>{e.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {open && (
        <div className="no-print mb-4">
          <Button size="sm" variant="outline-danger" disabled={busy} onClick={cancel}>ยกเลิกงานนี้</Button>
        </div>
      )}
    </>
  );
};

// ── PD เปิดงานใหม่ ────────────────────────────────────────────────────────
const OpenJob = ({ categoryId, lookups, models, onOpened, showAlert }) => {
  const [moNo, setMoNo] = useState('');
  const [moInfo, setMoInfo] = useState(null);
  const [modelId, setModelId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [shift, setShift] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [busy, setBusy] = useState(false);

  const model = models.find((m) => String(m.id) === modelId);
  const machines = (lookups.machines ?? []).filter((m) => !model || String(m.division_id) === String(model.division_id));
  useEffect(() => {
    if (machineId && !machines.some((m) => String(m.id) === machineId)) setMachineId('');
  }, [machineId, machines]);

  const pickModel = useCallback((m) => setModelId(String(m.id)), []);
  const ready = moNo.trim() && modelId && machineId && shift;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiCall('/check-jobs', {
        method: 'POST',
        body: {
          category_id: categoryId, model_id: modelId, machine_id: machineId, mo_no: moNo.trim(),
          lot_no: lotNo, shift,
          mo_item_no: moInfo?.itemNo, mo_item_name: moInfo?.itemName, mo_draw: moInfo?.draw,
        },
      });
      setMoNo(''); setLotNo('');
      onOpened(res.id);
    } catch (err) {
      showAlert({ title: 'เปิดงานไม่สำเร็จ', body: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-3">
      <Card.Header>เปิดงานใหม่ (PD)</Card.Header>
      <Card.Body>
        <MoLookupBar
          moNo={moNo}
          onMoNoChange={setMoNo}
          divisions={lookups.divisions ?? []}
          models={models}
          currentModelId={modelId}
          onPickModel={pickModel}
          onInfoChange={setMoInfo}
        />
        <Row className="g-2 mt-1">
          <Col md={5}>
            <Form.Label className="small mb-1">Item</Form.Label>
            <SearchSelect id="setup-model" value={modelId} onChange={setModelId} aria-label="Item"
              options={models.map((m) => ({ value: String(m.id), label: `${m.item_no} ${m.item_name}`, hint: m.division_name }))} />
          </Col>
          <Col md={3}>
            <Form.Label className="small mb-1">เครื่องจักร</Form.Label>
            <SearchSelect id="setup-machine" value={machineId} onChange={setMachineId} aria-label="เครื่องจักร"
              options={machines.map((m) => ({ value: String(m.id), label: m.code, hint: m.name }))} />
          </Col>
          <Col md={2}>
            <Form.Label className="small mb-1" htmlFor="setup-shift">กะ</Form.Label>
            {/* ⚠️ ต้องมี option ว่าง — กฎเดียวกับ StationBar */}
            <Form.Select id="setup-shift" value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">—</option>
              {SHIFTS.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </Form.Select>
          </Col>
          <Col md={2}>
            <Form.Label className="small mb-1" htmlFor="setup-lot">Lot (ถ้ามี)</Form.Label>
            <Form.Control id="setup-lot" value={lotNo} onChange={(e) => setLotNo(e.target.value)} />
          </Col>
        </Row>
        <Button className="mt-3" disabled={busy || !ready} onClick={submit}>เปิดงาน แล้วกรอก Production Check</Button>
      </Card.Body>
    </Card>
  );
};

// ── คิว ───────────────────────────────────────────────────────────────────
const QUEUE_TABS = [
  { key: 'waiting_qc', label: 'รอ QC รับงาน', status: 'waiting_qc' },
  { key: 'qc_checking', label: 'QC กำลังตรวจ', status: 'qc_checking' },
  { key: 'pd_checking', label: 'PD ตรวจ / ตีกลับ', status: 'pd_checking' },
  { key: 'closed', label: 'ปิดแล้ว (7 วัน)', status: 'passed,cancelled', days: 7 },
];

const Queue = ({ categoryId, tab, onTab, onOpen, counts }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const now = useNow();
  const reqRef = useRef(0);
  const def = QUEUE_TABS.find((t) => t.key === tab) ?? QUEUE_TABS[0];

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({ status: def.status, category: String(categoryId) });
      if (def.days) q.set('days', String(def.days));
      const res = await apiCall(`/check-jobs?${q}`);
      if (req === reqRef.current) setRows(res);
    } catch {
      if (req === reqRef.current) setRows([]);
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [categoryId, def.status, def.days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => on('check_job_updated', load), [load]);

  const c = counts?.byCategory?.[categoryId] ?? {};
  const countOf = { waiting_qc: c.waiting_qc, qc_checking: c.qc_checking, pd_checking: c.pd_checking };

  return (
    <Card>
      <Card.Header className="d-flex flex-wrap gap-1">
        {QUEUE_TABS.map((t) => (
          <Button key={t.key} size="sm" variant={t.key === def.key ? 'primary' : 'outline-primary'} onClick={() => onTab(t.key)}>
            {t.label}{countOf[t.key] ? <Badge bg="danger" className="ms-1">{countOf[t.key]}</Badge> : null}
          </Button>
        ))}
        {loading && <Spinner animation="border" size="sm" className="ms-2 align-self-center" />}
      </Card.Header>
      <Card.Body className="p-0">
        <Table hover size="sm" className="mb-0 small align-middle">
          <thead>
            <tr><th>งาน</th><th>WOS</th><th>Item</th><th>เครื่อง</th><th>กะ</th><th>รอบ</th><th>สถานะ</th><th>ล่าสุด</th><th>รอมา</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-muted py-3">ไม่มีงานในช่องนี้</td></tr>
            )}
            {rows.map((r) => {
              const st = statusInfo(r);
              return (
                <tr key={r.id} role="button" onClick={() => onOpen(r.id)}>
                  <td>#{r.id}</td>
                  <td><b>{r.mo_no}</b></td>
                  <td>{r.item_no}</td>
                  <td>{r.machine_code}</td>
                  <td>{r.shift}</td>
                  <td>{r.round_no}</td>
                  <td><Badge bg={st.bg}>{st.label}</Badge></td>
                  <td className="text-nowrap">{ACTION_LABEL[r.last_action] ?? '—'} · {r.last_user_name}<div className="text-muted">{fmtDateTime(r.last_event_at)}</div></td>
                  <td className="text-nowrap">{['passed', 'cancelled'].includes(r.status) ? '—' : waitedText(r.last_event_at, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
};

// ── หน้า ──────────────────────────────────────────────────────────────────
const SetupJobs = () => {
  const session = useSession();
  const { dialog, showAlert, showPrompt, closeDialog } = useDialog();
  const [lookups, setLookups] = useState({});
  const [models, setModels] = useState([]);
  const [counts, setCounts] = useState(null);
  const [toast, setToast] = useState(null);
  const [jobParam, setJobParam] = useUrlParam('job');
  const [catParam, setCatParam] = useUrlParam('cat');
  const [tabParam, setTabParam] = useUrlParam('tab');

  const isPD = hasRole(session, 'PD');
  const isQC = hasRole(session, 'QC');

  useEffect(() => {
    Promise.all([apiCall('/master/lookups'), apiCall('/master/models')])
      .then(([lk, ms]) => { setLookups(lk); setModels(ms); })
      .catch((err) => showAlert({ title: 'โหลดข้อมูลไม่สำเร็จ', body: err.message }));
  }, [showAlert]);

  const categories = useMemo(() => (lookups.categories ?? []).filter((c) => Number(c.has_workflow)), [lookups]);
  const categoryId = Number(catParam) || categories[0]?.id || null;

  const loadCounts = useCallback(() => {
    apiCall('/check-jobs/counts').then(setCounts).catch(() => {});
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  // toast เฉพาะเหตุการณ์ที่ "ต้องทำอะไร" ของ role นี้ — QC: มีงานเข้าคิว · PD: QC ตีกลับ / ผ่าน
  useEffect(() => on('check_job_updated', (e) => {
    loadCounts();
    if (isQC && e.action === 'pd_submit') setToast({ id: e.id, text: `WOS ${e.moNo} ส่งมาให้ QC ตรวจ`, bg: 'primary' });
    else if (isPD && e.action === 'qc_reject') setToast({ id: e.id, text: `WOS ${e.moNo} QC ไม่ผ่าน — ตีกลับ PD`, bg: 'danger' });
    else if (isPD && e.action === 'qc_pass') setToast({ id: e.id, text: `WOS ${e.moNo} QC ยืนยันผ่าน`, bg: 'success' });
  }), [isPD, isQC, loadCounts]);

  // แท็บคิวตั้งต้นตาม role — QC เห็นงานที่รอรับก่อน · PD เห็นงานของตัวเอง/ที่ถูกตีกลับ
  const tab = tabParam || (isQC ? 'waiting_qc' : 'pd_checking');

  return (
    <Container fluid className="page">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h1 className="fs-4 mb-0 me-2">งานตรวจส่งต่อ PD → QC</h1>
        {categories.map((c) => (
          <Button key={c.id} size="sm" variant={c.id === categoryId ? 'primary' : 'outline-primary'}
            onClick={() => { setCatParam(String(c.id)); setJobParam(''); }}>
            {c.name}
          </Button>
        ))}
      </div>

      {!categoryId ? (
        <div className="text-muted">ยังไม่มีหมวดการตรวจที่ต้องส่งต่อ (รัน db:apply แล้วหรือยัง)</div>
      ) : jobParam ? (
        <JobDetail jobId={jobParam} session={session} onBack={() => setJobParam('')}
          showAlert={showAlert} showPrompt={showPrompt} />
      ) : (
        <>
          {isPD && (
            <OpenJob categoryId={categoryId} lookups={lookups} models={models}
              onOpened={(id) => setJobParam(String(id))} showAlert={showAlert} />
          )}
          <Queue categoryId={categoryId} tab={tab} onTab={setTabParam} onOpen={(id) => setJobParam(String(id))} counts={counts} />
        </>
      )}

      <ToastContainer position="top-end" className="p-3" style={{ zIndex: 1080 }}>
        {toast && (
          <Toast bg={toast.bg} onClose={() => setToast(null)} delay={8000} autohide animation={false}>
            <Toast.Body className="text-white d-flex align-items-center gap-2">
              <span>{toast.text}</span>
              <Button size="sm" variant="light" onClick={() => { setJobParam(String(toast.id)); setToast(null); }}>เปิดงาน</Button>
            </Toast.Body>
          </Toast>
        )}
      </ToastContainer>

      <AppDialog dialog={dialog} onHide={closeDialog} />
    </Container>
  );
};

export default SetupJobs;
