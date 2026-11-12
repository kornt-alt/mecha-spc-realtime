// frontend/src/components/SetupJobs.js — หน้า /setup งานตรวจที่ส่งต่อ PD → QC (Set up / Last Piece)
//
// ลำดับตามชีต "SET UP & LAST PIECE INSPECTION RECORD":
//   PD เปิดงานด้วยเลข WOS → กรอก Production Check → ส่ง → คิว QC (badge + toast)
//   → QC รับงาน → กรอก QC Confirm → ผ่าน / ไม่ผ่าน (ตีกลับ PD เป็นรอบใหม่)
//
// ⚠️ ต้อง login (RequireLogin ที่ App.js) · ปุ่มที่โชว์ตาม role เป็นแค่ UI ตัวกั้นจริงคือ requireRole ฝั่ง backend
// ⚠️ ไม่ตัดสินอะไรเอง — สีแดงตอนพิมพ์คือ judgeLocal (advisory) ผลจริงมาจาก server
// ⚠️ ตารางกรอกสลับได้ 2 แบบ (Korn สั่ง 2026-11): แนวตั้ง = จุดตรวจเป็นแถว ชิ้นเป็นคอลัมน์ ตามชีต SET UP (ค่าเริ่ม) ·
//    แนวนอน = จุดตรวจเป็นคอลัมน์ ชิ้นเป็นแถว แบบใบตรวจตามรอบ (GridHead ตัวเดียวกัน) · จำใน localStorage spc.setupLayout
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
import { GridHead } from './InputGrid';
import LayoutToggle, { useLayout } from './LayoutToggle';
import { cleanDecimal, specAllowsMinus } from '../utils/numericInput';
import { itemsForMachine, machinesForItem } from '../utils/machineItems';
import { useDataTable, FilterBar } from './table/useDataTable';
import Pager, { usePager } from './table/Pager';

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
  open: 'เปิดงาน',
  pd_submit: 'PD ส่งให้ QC',
  qc_accept: 'QC รับงาน',
  qc_pass: 'QC ยืนยัน ผ่าน',
  qc_reject: 'QC ไม่ผ่าน',
  pd_pass: 'PD ยืนยัน ผ่าน',
  pd_reject: 'PD ไม่ผ่าน — ตรวจซ้ำ',
  cancel: 'ยกเลิกงาน',
};

// ใครตรวจของหมวด (check_categories.flow · ตั้งที่ Master › หมวดการตรวจ) — ตัวบังคับจริงอยู่ที่ routes/checkJobs.js
//   pd_qc = PD ตรวจ → ส่ง QC ยืนยัน · pd = PD ตรวจแล้วตัดสินเอง · qc = QC เปิดงานแล้วตรวจเอง
export const FLOW_LABEL = { pd_qc: 'PD ตรวจ → QC ยืนยัน', pd: 'PD ตรวจอย่างเดียว', qc: 'QC ตรวจอย่างเดียว' };
const flowOfJob = (job) => job?.category_flow || 'pd_qc';
const openerRole = (flow) => (flow === 'qc' ? 'QC' : 'PD');

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

// ── แนวตั้ง / แนวนอน ── ปุ่ม/hook กลางอยู่ที่ components/LayoutToggle.js (ใบตรวจตามรอบใช้ตัวเดียวกัน)
// ⚠️ แค่วิธีวาด — values ('<cpId>:<piece>') ชุดเดียวกัน สลับกลางคันค่าไม่หาย · buildResults/isComplete ไม่รู้ว่ามีโหมด
const LAYOUT_KEY = 'spc.setupLayout';
const LAYOUT_DEFAULT = 'vertical';

// Enter = ไปช่องถัดไปตามลำดับ "จุดตรวจ → ชิ้น" ทั้งสองแบบ (แนวตั้งไปทางขวา · แนวนอนลงล่าง)
// ⚠️ ลำดับอ่านจาก data-cp / data-piece ของช่องเอง ไม่ใช่ array ของ ref (หลักเดียวกับ InspectionSheet)
const onEnterNext = (e) => {
  if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return;
  const root = e.currentTarget.closest('[data-grid]');
  if (!root) return;
  e.preventDefault();
  const cells = Array.from(root.querySelectorAll('[data-cell]'))
    .filter((el) => !el.disabled)
    .sort((a, b) => Number(a.dataset.cp) - Number(b.dataset.cp) || Number(a.dataset.piece) - Number(b.dataset.piece));
  const next = cells[cells.indexOf(e.currentTarget) + 1];
  if (next) { next.focus(); if (typeof next.select === 'function') next.select(); }
};

// ช่องกรอก 1 ช่อง (จุด × ชิ้น) ใช้ร่วมสองแบบ — null = ไม่มีช่อง (เกินจำนวนชิ้น / attribute ชิ้นที่ 2+)
const PieceInput = ({ cp, cpIndex, piece, values, set, disabled, compact = false }) => {
  if (cp.char_type === 'attribute') {
    if (piece > 1) return null;
    const k = keyOf(cp.id, 1);
    const cls = compact ? `cell${values[k] === 'NG' ? ' cell--ng' : ''}` : 'form-select form-select-sm';
    return (
      <select className={cls} value={values[k] ?? ''} disabled={disabled}
        data-cell="" data-cp={cpIndex} data-piece={1} onKeyDown={onEnterNext}
        aria-label={`${cp.name} ผล`} onChange={(e) => set(k, e.target.value)}>
        <option value="">—</option>
        <option value="OK">OK</option>
        <option value="NG">NG</option>
      </select>
    );
  }
  if (piece > cp.sample_size) return null;
  const k = keyOf(cp.id, piece);
  const ng = judgeLocal(values[k], cp.usl, cp.lsl) === 'NG';
  const cls = compact ? `cell${ng ? ' cell--ng' : ''}` : `form-control form-control-sm${ng ? ' is-invalid' : ''}`;
  return (
    <input className={cls} type="text" inputMode="decimal" autoComplete="off"
      value={values[k] ?? ''} disabled={disabled}
      data-cell="" data-cp={cpIndex} data-piece={piece} onKeyDown={onEnterNext}
      aria-label={`${cp.name} ชิ้นที่ ${piece}`}
      onChange={(e) => set(k, cleanDecimal(e.target.value, { allowMinus: specAllowsMinus(cp) }))} />
  );
};

const StageForm = ({ checkpoints, values, onChange, disabled, layout }) => {
  const maxQty = Math.max(1, ...checkpoints.map((c) => c.sample_size));
  const set = (k, v) => onChange((prev) => ({ ...prev, [k]: v }));
  const pieces = Array.from({ length: maxQty }, (_, i) => i + 1);

  if (layout === 'horizontal') {
    // แนวนอน = หน้าตาเดียวกับใบตรวจตามรอบ (GridHead + .igrid) · แถว = ชิ้น
    return (
      <div className="igrid-wrap" data-grid="">
        <table className="igrid">
          <GridHead checkpoints={checkpoints} leftCols={H_LEFT}
            sizeLabel={(cp) => `${cp.char_type === 'attribute' ? 1 : cp.sample_size} pcs`} />
          <tbody>
            {pieces.map((piece) => (
              <tr key={piece}>
                <th scope="row" className="igrid__left igrid__meta text-end" style={H_LEFT_STYLE}>{piece}</th>
                {checkpoints.map((cp, i) => {
                  const has = cp.char_type === 'attribute' ? piece === 1 : piece <= cp.sample_size;
                  // ช่องที่ไม่มี (เกินจำนวนชิ้น) ต้องว่างและ focus ไม่ได้ — เหมือนใบตรวจตามรอบ
                  if (!has) return <td key={cp.id} className="igrid__entry" aria-hidden="true" />;
                  return (
                    <td key={cp.id} className="igrid__entry">
                      <PieceInput cp={cp} cpIndex={i} piece={piece} values={values} set={set} disabled={disabled} compact />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="mc-freeze setup-grid-wrap" data-grid="">
      <Table size="sm" bordered className="align-middle mb-0 setup-grid">
        <thead>
          <tr>
            <th style={{ width: 40 }}>No</th>
            <th className="mc-sticky-start">จุดตรวจ</th>
            <th>สเปก</th>
            <th>เครื่องมือวัด</th>
            {pieces.map((p) => (
              <th key={p} className="text-center" style={{ width: 96 }}>{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {checkpoints.map((cp, i) => (
            <tr key={cp.id}>
              <td>{cp.seq_no}</td>
              <td className="mc-sticky-start">{cp.name}{cp.is_critical ? <Badge bg="danger" className="ms-1">SC</Badge> : null}</td>
              <td className="small"><SpecValue checkpoint={cp} /></td>
              <td className="small text-muted">{cp.gauge || '—'}</td>
              {pieces.map((piece) => {
                const has = cp.char_type === 'attribute' ? piece === 1 : piece <= cp.sample_size;
                return has
                  ? <td key={piece}><PieceInput cp={cp} cpIndex={i} piece={piece} values={values} set={set} disabled={disabled} /></td>
                  : <td key={piece} className="bg-light" />;
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

// คอลัมน์ซ้ายของแนวนอน (ตรึง) — ความกว้างต้อง fix ตามกฎของ GridHead
const H_LEFT = [{ key: 'piece', label: 'ชิ้น', width: 4.5 }];
const H_LEFT_STYLE = { left: 0, width: '4.5rem', minWidth: '4.5rem' };

// ── ผลที่บันทึกแล้ว: แถว = จุดตรวจ · คอลัมน์ = ชิ้นของแต่ละใบ (PD / QC ของรอบนั้นคู่กัน) ──────────
const ResultsTable = ({ checkpoints, inspections, layout }) => {
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
  const cellOf = (ins, cp, piece) => ins.results.find((x) => x.checkpoint_id === cp.id && x.piece_no === piece);
  const ngStyle = (r) => (r?.judgment === 'NG' ? { color: 'var(--red)', fontWeight: 600 } : undefined);

  if (layout === 'horizontal') {
    // แนวนอน: คอลัมน์ = จุดตรวจ · แถว = ใบ × ชิ้น (ชื่อแถวบอกรอบ/ขั้น/ผู้ตรวจ)
    return (
      <div className="table-responsive">
        <Table size="sm" bordered className="align-middle small mb-0">
          <thead>
            <tr>
              <th>รอบ · ขั้น</th>
              <th className="text-center">ชิ้น</th>
              {cps.map((cp) => <th key={cp.id} className="text-center text-nowrap">{cp.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {cols.flatMap(({ ins, n }) => Array.from({ length: n }, (_, i) => (
              <tr key={`${ins.id}-${i}`}>
                {i === 0 && (
                  <td rowSpan={n} className="text-nowrap">
                    รอบ {ins.round_no ?? '?'} · {ins.stage === 'pd' ? 'Production Check' : 'QC Confirm'}
                    <div className="text-muted">{ins.inspector_name} · {fmtDateTime(ins.inspected_at)}</div>
                  </td>
                )}
                <td className="text-center">{i + 1}</td>
                {cps.map((cp) => {
                  const r = cellOf(ins, cp, i + 1);
                  return <td key={cp.id} className="text-center" style={ngStyle(r)}>{r ? (r.value ?? r.judgment) : ''}</td>;
                })}
              </tr>
            )))}
          </tbody>
        </Table>
      </div>
    );
  }

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
                const r = cellOf(ins, cp, i + 1);
                return (
                  <td key={`${ins.id}-${i}`} className="text-center" style={ngStyle(r)}>
                    {r ? (r.value ?? r.judgment) : ''}
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
  const [layout, setLayout] = useLayout(LAYOUT_KEY, LAYOUT_DEFAULT);
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

  const flow = flowOfJob(job);
  const stage = job.status === 'pd_checking' && isPD && flow !== 'qc' ? 'pd'
    : job.status === 'qc_checking' && isQC && mineQc ? 'qc'
      : null;
  const stageCps = stage ? checkpoints[stage] : [];
  const doneCount = stageCps.filter((cp) => isComplete(cp, values)).length;
  const allDone = stageCps.length > 0 && doneCount === stageCps.length;
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

  // ขั้นนี้ตัดสินผลเองไหม — ขั้น QC เสมอ · ขั้น PD เฉพาะหมวด flow pd (ไม่มี QC)
  const decides = stage === 'qc' || (stage === 'pd' && flow === 'pd');
  const submitPd = () => run(() => apiCall(`/check-jobs/${job.id}/submit`, {
    method: 'POST', body: { results: buildResults(stageCps, values) },
  }), 'ส่งให้ QC แล้ว — งานเข้าคิว QC');

  const accept = () => run(() => apiCall(`/check-jobs/${job.id}/accept`, { method: 'POST' }), null);

  const pass = () => run(() => apiCall(`/check-jobs/${job.id}/decide`, {
    method: 'POST', body: { result: 'pass', results: buildResults(stageCps, values) },
  }), 'ยืนยันผ่านแล้ว — ปิดงาน');

  // ไม่ผ่าน: flow pd_qc = ตีกลับ PD · pd / qc = ตรวจซ้ำรอบใหม่ที่ขั้นเดิม
  const failLabel = flow === 'pd_qc' ? 'ไม่ผ่าน — ตีกลับ PD' : 'ไม่ผ่าน — ตรวจซ้ำ';
  const fail = () => showPrompt({
    title: failLabel,
    body: 'ระบุเหตุผล/จุดที่ต้องแก้ (ค่าที่กรอกไว้จะถูกบันทึกเป็นหลักฐานด้วย)',
    inputLabel: 'เหตุผล',
    confirmLabel: flow === 'pd_qc' ? 'ตีกลับ PD' : 'บันทึกไม่ผ่าน',
    onConfirm: (note) => run(() => apiCall(`/check-jobs/${job.id}/decide`, {
      method: 'POST', body: { result: 'fail', note, results: buildResults(stageCps, values) },
    }), flow === 'pd_qc' ? 'ตีกลับ PD แล้ว' : 'บันทึกไม่ผ่านแล้ว — เริ่มรอบใหม่'),
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
          <Card.Header className="d-flex flex-wrap align-items-center gap-2">
            <span>{stage === 'pd' ? `Production Check — รอบ ${job.round_no}` : `QC Confirm — รอบ ${job.round_no}`}</span>
            <span className="ms-auto"><LayoutToggle layout={layout} onChange={setLayout} /></span>
          </Card.Header>
          <Card.Body>
            {stageCps.length === 0 ? (
              <div className="small text-muted">ยังไม่ได้ตั้งจุดตรวจของขั้นนี้ — ให้ ADMIN ตั้งที่ Master › จุดตรวจ</div>
            ) : (
              <StageForm checkpoints={stageCps} values={values} onChange={setValues} disabled={busy} layout={layout} />
            )}
            {/* แถบปุ่มติดขอบล่าง (ตัวเดียวกับใบตรวจตามรอบ) — ฟอร์มยาวไม่ต้องเลื่อนลงไปหาปุ่ม */}
            <div className="savebar">
              <span className="savebar__count">
                กรอกครบแล้ว {doneCount}/{stageCps.length} จุด
              </span>
              {anyNg && <span className="verdict verdict--ng">มีค่า NG</span>}
              {decides && anyNg && (
                <span className="small" style={{ color: 'var(--red)' }}>ยืนยันผ่านไม่ได้ — กดไม่ผ่าน</span>
              )}
              <span className="savebar__spacer" />
              {!decides && (
                <Button size="lg" disabled={busy || !allDone} onClick={submitPd}>
                  {busy && <Spinner size="sm" animation="border" className="me-1" />}ส่งให้ QC
                </Button>
              )}
              {decides && (
                <>
                  <Button size="lg" variant="outline-danger" disabled={busy} onClick={fail}>{failLabel}</Button>
                  <Button size="lg" variant="success" disabled={busy || !allDone || anyNg} onClick={pass}>
                    {busy && <Spinner size="sm" animation="border" className="me-1" />}ผ่าน
                  </Button>
                </>
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
        <Card.Header className="d-flex flex-wrap align-items-center gap-2">
          <span>ผลตรวจที่บันทึกแล้ว</span>
          {!stage && <span className="ms-auto"><LayoutToggle layout={layout} onChange={setLayout} /></span>}
        </Card.Header>
        <Card.Body><ResultsTable checkpoints={checkpoints} inspections={inspections} layout={layout} /></Card.Body>
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
                  <td style={['qc_reject', 'pd_reject'].includes(e.action) ? { color: 'var(--red)' }
                    : ['qc_pass', 'pd_pass'].includes(e.action) ? { color: 'var(--green)' } : undefined}>
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
  const divisionMachines = useMemo(
    () => (lookups.machines ?? []).filter((m) => !model || String(m.division_id) === String(model.division_id)),
    [lookups.machines, model]
  );
  useEffect(() => {
    if (machineId && !divisionMachines.some((m) => String(m.id) === machineId)) setMachineId('');
  }, [machineId, divisionMachines]);
  // เครื่อง↔item ที่รันได้ (Drawing Digital) — ตัวช่วยเลือก ไม่ใช่ตัวกั้น (utils/machineItems.js)
  const machineItems = lookups.machineItems ?? [];
  const machine = divisionMachines.find((m) => String(m.id) === machineId);
  const machines = machinesForItem(divisionMachines, modelId, machineItems, machineId).list;
  const itemScope = itemsForMachine(models, machine, machineItems, modelId);

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
              options={itemScope.list.map((m) => ({ value: String(m.id), label: `${m.item_no} ${m.item_name}`, hint: m.division_name }))} />
            {itemScope.filtered && <div className="small text-muted mt-1">เฉพาะ item ที่เครื่อง {machine?.code} รันได้ (Drawing Digital)</div>}
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

// เรียง/กรองหัวคอลัมน์ — ค่าเริ่ม (ไม่กดเรียง) = ลำดับที่ server ส่งมา (เก่าสุดก่อน = คิว)
const QUEUE_COLS = {
  id: { get: (r) => Number(r.id), text: (r) => `#${r.id}` },
  mo: { get: (r) => r.mo_no ?? '' },
  item: { get: (r) => r.item_no ?? '' },
  mc: { get: (r) => r.machine_code ?? '' },
  shift: { get: (r) => r.shift ?? '' },
  round: { get: (r) => Number(r.round_no) },
  status: { get: (r) => statusInfo(r).label },
  last: { get: (r) => new Date(r.last_event_at).getTime(), text: (r) => r.last_user_name ?? '' },
};

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

  const dt = useDataTable(rows, QUEUE_COLS);
  const pg = usePager(dt.rows, `${dt.resetKey}|${def.key}`);

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
      <Card.Body className="p-2">
        <FilterBar dt={dt} className="mb-2" />
        <div className="mc-freeze">
        <Table hover size="sm" className="mb-0 align-middle text-nowrap queue-table">
          <thead>
            <tr>
              {dt.th('id', 'งาน', { className: 'mc-sticky-start' })}{dt.th('mo', 'WOS')}{dt.th('item', 'Item')}
              {dt.th('mc', 'เครื่อง')}{dt.th('shift', 'กะ')}{dt.th('round', 'รอบ')}{dt.th('status', 'สถานะ')}
              {dt.th('last', 'ล่าสุด')}<th>รอมา</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-muted py-4">ไม่มีงานในช่องนี้</td></tr>
            )}
            {pg.rows.map((r) => {
              const st = statusInfo(r);
              return (
                <tr key={r.id} role="button" tabIndex={0} onClick={() => onOpen(r.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.id); }}>
                  <td className="mc-sticky-start">#{r.id}</td>
                  <td><b>{r.mo_no}</b></td>
                  <td>{r.item_no}</td>
                  <td>{r.machine_code}</td>
                  <td>{r.shift}</td>
                  <td>{r.round_no}</td>
                  <td><Badge bg={st.bg} className="job-status">{st.label}</Badge></td>
                  <td className="text-nowrap">{ACTION_LABEL[r.last_action] ?? '—'} · {r.last_user_name}<div className="text-muted">{fmtDateTime(r.last_event_at)}</div></td>
                  <td className="text-nowrap">{['passed', 'cancelled'].includes(r.status) ? '—' : waitedText(r.last_event_at, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        </div>
        <Pager pg={pg} />
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
  const currentFlow = categories.find((c) => Number(c.id) === Number(categoryId))?.flow || 'pd_qc';

  const loadCounts = useCallback(() => {
    apiCall('/check-jobs/counts').then(setCounts).catch(() => {});
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  // toast เฉพาะเหตุการณ์ที่ "ต้องทำอะไร" ของ role นี้ — QC: มีงานเข้าคิว · PD: QC ตีกลับ / ผ่าน
  useEffect(() => on('check_job_updated', (e) => {
    loadCounts();
    if (isQC && e.action === 'pd_submit') setToast({ id: e.id, text: `WOS ${e.moNo} ส่งมาให้ QC ตรวจ`, bg: 'primary' });
    else if (isPD && e.action === 'qc_reject') setToast({ id: e.id, text: `WOS ${e.moNo} QC ไม่ผ่าน — ตีกลับ PD`, bg: 'danger' });
    else if (isQC && e.action === 'open' && e.status === 'qc_checking') setToast({ id: e.id, text: `WOS ${e.moNo} เปิดงานใหม่ (QC ตรวจ)`, bg: 'primary' });
    else if (isPD && e.action === 'qc_pass') setToast({ id: e.id, text: `WOS ${e.moNo} QC ยืนยันผ่าน`, bg: 'success' });
  }), [isPD, isQC, loadCounts]);

  // แท็บคิวตั้งต้นตาม role — QC เห็นงานที่รอรับก่อน · PD เห็นงานของตัวเอง/ที่ถูกตีกลับ
  // flow qc ไม่มีขั้นรอรับ — งานเปิดแล้วอยู่ "QC กำลังตรวจ" ทันที · flow pd ไม่มี QC เลย
  const tab = tabParam || (currentFlow === 'qc' ? 'qc_checking' : currentFlow === 'pd' ? 'pd_checking' : isQC ? 'waiting_qc' : 'pd_checking');

  return (
    <Container fluid className="page">
      <div className="page-head">
        <h1>งาน Set up / Last Piece</h1>
        <span className="page-head__meta">{FLOW_LABEL[currentFlow]}</span>
      </div>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
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
          {/* คนเปิดงานตามหมวด: flow qc = QC เปิดเอง · อื่น ๆ = PD */}
          {hasRole(session, openerRole(currentFlow)) && (
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
