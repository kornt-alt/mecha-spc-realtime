// frontend/src/components/ScSheet.js — หน้า SC Chart ราย 1 จุดตรวจ ตามฟอร์ม SP-QC-214C
//
// จำลองชีต SC ของ Excel ที่ QC ใช้อยู่ (1 ชีต = 1 จุดตรวจ × 1 เครื่อง × 1 เดือน):
//   หัวกระดาษ → ตาราง subgroup (Date/Time/ค่า/X̄/R) → ตาราง OCS → กล่องสถิติ → กราฟ X̄/R → Event Log
//
// ⚠️ หน้านี้ไม่คำนวณสถิติ/กฎอะไรเลย — จุด ลิมิต Cp/Cpk กฎ OCS มาจาก GET /api/charts/:id ทั้งหมด
//    (กฎเดียวกับ ControlChart) ฝั่งนี้แค่จัดวางให้เหมือนฟอร์มกระดาษ
// ⚠️ URL คือสเตตของหน้า (?model= &checkpoint= &machine= &month=YYYY-MM) — ลิงก์จากการ์ดกราฟ
//    บน Dashboard / รายงาน พามาตรงจุดได้ และพิมพ์/บุ๊กมาร์กได้
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Container, Row, Col, Alert, Button, Form, Spinner, Badge, Overlay, Tooltip } from 'react-bootstrap';
import SearchSelect from './SearchSelect';
import SpecValue from './SpecValue';
import AppDialog from './AppDialog';
import EditInspectionModal from './EditInspectionModal';
import useSession from '../utils/useSession';
import { hasRole } from '../utils/auth';
import XbarRCharts, { fmt, fmtCap, capClass } from './XbarRCharts';
import { apiCall } from '../utils/api';
import { on, joinModel, leaveModel } from '../utils/socket';
import { normalizeRows, normalizeCheckpoints, normalizeChart } from '../utils/normalize';
import { useModelParam, useUrlParam } from '../utils/useModelParam';
import { RULE_BY_ID, RULE_SET_LABEL, chartLabel, rulesFor } from '../utils/spcRules';
import { targetLabel } from '../utils/capability';
import { explain } from '../utils/scExplain';
import useDialog from '../utils/useDialog';
import { fmtDate as fmtDateBase, fmtTime as fmtTimeBase } from '../utils/dateFormat';

// ฟอร์มกระดาษมี 30 คอลัมน์ต่อแผ่น — เดือนที่มีมากกว่านี้ตัดเป็นหลายบล็อกต่อกันลงมา
const COLS_PER_BLOCK = 30;
const ALL_MACHINES = { value: '', label: 'รวมทุกเครื่อง' };
const TZ = 'Asia/Bangkok';

// เดือนปัจจุบันตามเวลาไทย (YYYY-MM) — ไม่ใช้ toISOString เพราะเป็น UTC ช่วงเช้ามืดจะได้เดือน/วันก่อนหน้า
const thisMonth = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${p.find((x) => x.type === 'year').value}-${p.find((x) => x.type === 'month').value}`;
};

// ช่วงวันที่ของเดือน → ตัวกรอง from/to ชุดเดียวกับทุก endpoint (buildInspectionFilter)
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};

const fmtDate = (d) => fmtDateBase(d, '');
const fmtTime = (d) => fmtTimeBase(d, '');
// ชื่อเดือนไทย ปี ค.ศ. ("กันยายน 2026") ให้ตรงกับวันที่ dd/mm/yyyy ค.ศ. ทั้งระบบ
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH-u-ca-gregory', { month: 'long', year: 'numeric' });
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// คอลัมน์ของตารางค่าคงที่ — ชื่อ key ตรงกับ CONSTANTS ใน backend/services/spcConstants.js
const CONST_COLS = [['A2', 'A2'], ['D3', 'D3'], ['D4', 'D4'], ['d2', 'd₂']];
const FREQ_TEXT = { shift: 'ทุกกะ', day: 'ทุกวัน' };

// ช่องของ Event Log — ชื่อ name ต้องตรงคอลัมน์ ocs_events เป๊ะ (routes/events.js TEXT_FIELDS)
const EVENT_FIELDS = [
  { name: 'man_pd', label: 'Man / PD (ฝ่ายผลิต)' },
  { name: 'man_qc', label: 'Man / QC' },
  { name: 'machine_note', label: 'M/C Parameter, Jig, Tool' },
  { name: 'method', label: 'Method' },
  { name: 'material', label: 'Material' },
  { name: 'measurement', label: 'Measurement' },
  { name: 'corrective_action', label: 'Corrective Action (มาตรการแก้ไข)' },
];

const ScSheet = () => {
  const [modelId, setModelId] = useModelParam();
  const [checkpointId, setCheckpointId] = useUrlParam('checkpoint');
  const [machineId, setMachineId] = useUrlParam('machine');
  const [monthParam, setMonth] = useUrlParam('month');
  // หมวดการตรวจ (?category=) — ว่าง = ตรวจตามรอบ (กฎเดียวกับ Dashboard)
  const [category, setCategory] = useUrlParam('category');
  const [categories, setCategories] = useState([]);
  const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : thisMonth();

  const [models, setModels] = useState([]);
  const [machines, setMachines] = useState([]);
  const [model, setModel] = useState(null);
  const [checkpoints, setCheckpoints] = useState([]);
  const [chart, setChart] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { dialog, showAlert, showForm, closeDialog } = useDialog();
  // ใบที่เปิดกล่อง "แก้ค่าในใบเดิม" อยู่ (ต้อง login — กล่องจัดการเอง) · null = ปิด
  // ⚠️ แก้ในใบเดิมเท่านั้น (จุดอยู่ที่เดิมบนฟอร์ม) — "แก้เป็นใบใหม่" อยู่ที่หน้าใบตรวจ
  const [editingId, setEditingId] = useState(null);
  // ช่องที่ชี้อยู่ { key, el } — ล้างเมื่อกราฟโหลดใหม่ (element เดิมอาจหายไปแล้ว)
  const [hot, setHot] = useState(null);
  useEffect(() => setHot(null), [chart]);
  // ปุ่มแก้ค่าขึ้นเฉพาะตอน login แล้ว (login ที่หน้า Master) — ตัวกั้นจริงคือ requireLogin ฝั่ง backend
  // ปุ่มแก้ค่าในใบเดิม = เฉพาะ ADMIN (PUT /inspections/:id/results เป็น requireAdmin) — บัญชี PD/QC ไม่เห็นปุ่ม
  const session = hasRole(useSession(), 'ADMIN');

  // ── master ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([apiCall('/master/models?all=1'), apiCall('/master/lookups?all=1')])
      .then(([ms, lk]) => {
        setModels(normalizeRows(ms));
        setMachines(normalizeRows(lk?.machines ?? []));
        setCategories(lk?.categories ?? []);
      })
      .catch((e) => setError(e.message));
  }, []);

  // จุดตรวจของ item — เฉพาะ variable เพราะจุด attribute ไม่มีค่าตัวเลข วาด control chart ไม่ได้
  //
  // ⚠️ เปลี่ยน item = ล้างของเดิมทันที ก่อนรอผล — ไม่งั้นระหว่างรอ ?checkpoint= เดิมยังเจอในลิสต์จุดตรวจเก่า
  //    แล้ว loadData โหลดกราฟของ item เก่ามาโชว์ใต้ชื่อ item ใหม่ · modelReqRef กัน response เก่าทับของใหม่
  const modelReqRef = useRef(0);
  const loadModel = useCallback(async (id) => {
    const my = ++modelReqRef.current;
    setModel(null);
    setCheckpoints([]);
    setEditingId(null);
    setError(null);
    if (!id) return;
    try {
      const data = await apiCall(`/master/models/${id}`);
      if (my !== modelReqRef.current) return;
      setModel(normalizeRows([data.model])[0]);
      setCheckpoints(normalizeCheckpoints(data.checkpoints).filter((c) => c.char_type === 'variable'));
    } catch (e) {
      if (my === modelReqRef.current) setError(e.message);
    }
  }, []);
  useEffect(() => { loadModel(modelId); }, [modelId, loadModel]);

  // ⚠️ ?checkpoint= ที่ไม่ใช่ของ item นี้ (เปลี่ยน item แล้ว / จุดถูกปิดใช้งาน) → เลือกจุดแรกให้
  //    ไม่งั้นหน้าว่างโดยไม่บอกว่าทำไม · เช็คหลังโหลดจุดตรวจเสร็จเท่านั้น
  useEffect(() => {
    if (checkpoints.length === 0) return;
    if (!checkpoints.some((c) => String(c.id) === String(checkpointId))) {
      setCheckpointId(String(checkpoints[0].id));
    }
  }, [checkpoints, checkpointId, setCheckpointId]);

  const cp = checkpoints.find((c) => String(c.id) === String(checkpointId)) ?? null;
  const cpIndex = cp ? checkpoints.indexOf(cp) : -1;

  // เครื่องที่เลือกได้ = เครื่องใน division ของ item (กฎเดียวกับ Dashboard)
  const visibleMachines = useMemo(
    () => machines.filter((mc) => String(mc.id) === String(machineId)
      || (mc.is_active && (!model || mc.division_id === model.division_id))),
    [machines, machineId, model]
  );
  const machine = machines.find((mc) => String(mc.id) === String(machineId)) ?? null;

  // ⚠️ ?machine= ที่ไม่อยู่ใน division ของ item (ลิงก์/บุ๊กมาร์กเก่า) → ล้าง ไม่งั้นกราฟว่างโดยไม่บอกว่าทำไม
  //    (กฎเดียวกับ Dashboard) · เช็คหลังโหลดทั้ง item และลิสต์เครื่องเสร็จเท่านั้น
  useEffect(() => {
    if (!model || !machineId || machines.length === 0) return;
    const picked = machines.find((mc) => String(mc.id) === String(machineId));
    if (!picked || picked.division_id !== model.division_id) setMachineId('');
  }, [model, machineId, machines, setMachineId]);

  // ── กราฟ + Event Log ─────────────────────────────────────────────────
  const query = useMemo(() => {
    const q = new URLSearchParams(monthRange(month));
    if (machineId) q.set('machine_id', machineId);
    if (category && category !== '1') q.set('category', category);
    return q.toString();
  }, [month, machineId, category]);

  // ⚠️ dataReqRef กัน response เก่า — สลับจุด/เครื่อง/เดือนเร็ว ๆ แล้วคำขอก่อนหน้าตอบทีหลัง จะทับของใหม่
  //    (loadData ถูกเรียกจาก socket และหลังแก้ค่าด้วย ไม่ใช่แค่ effect จึงใช้ ref ไม่ใช่ cancelled)
  const dataReqRef = useRef(0);
  const loadData = useCallback(async () => {
    const my = ++dataReqRef.current;
    if (!cp) {
      setChart(null);
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [c, ev] = await Promise.all([
        apiCall(`/charts/${cp.id}?${query}`),
        apiCall(`/events?checkpoint_id=${cp.id}&${query}`),
      ]);
      if (my !== dataReqRef.current) return;
      setChart(normalizeChart(c));
      setEvents(Array.isArray(ev) ? ev : []);
      setError(null);
    } catch (e) {
      if (my !== dataReqRef.current) return;
      setChart(null);
      setEvents([]);
      setError(e.message);
    } finally {
      if (my === dataReqRef.current) setLoading(false);
    }
    // cp เปลี่ยน object ทุกครั้งที่โหลดจุดตรวจใหม่ ผูกกับ id พอ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cp?.id, query]);
  useEffect(() => { loadData(); }, [loadData]);

  // ── realtime — ใบใหม่ของจุดนี้ (และเครื่องนี้) เข้ามา → โหลดใหม่ ─────────────
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  const watchRef = useRef({});
  watchRef.current = { checkpointId: cp?.id, machineId, category };
  useEffect(() => {
    if (!modelId) return undefined;
    joinModel(modelId);
    return () => leaveModel(modelId);
  }, [modelId]);
  useEffect(() => {
    const relevant = (p) => {
      const w = watchRef.current;
      // payload จาก backend รุ่นเก่าไม่มี categoryId = ตรวจตามรอบ
      if (String(p?.categoryId ?? 1) !== String(w.category || 1)) return false;
      if (w.machineId && p?.machineId !== null && p?.machineId !== undefined
        && String(p.machineId) !== String(w.machineId) && Number(p.machineId) !== 0) return false;
      return !p?.checkpointIds || p.checkpointIds.map(String).includes(String(w.checkpointId));
    };
    const offSaved = on('inspection_saved', (p) => relevant(p) && loadRef.current());
    const offBaseline = on('baseline_updated', () => loadRef.current());
    return () => { offSaved(); offBaseline(); };
  }, []);

  // ── Event Log ───────────────────────────────────────────────────────
  const eventByKey = useMemo(
    () => new Map(events.map((e) => [`${e.inspection_id}:${e.chart}`, e])),
    [events]
  );

  const openEvent = (point, chartKey, rules) => {
    const existing = eventByKey.get(`${point.inspectionId}:${chartKey}`);
    showForm({
      title: `บันทึกสาเหตุ — subgroup ${point.subgroupNo} (${chartLabel(chartKey, chart.limits.mode === 'i-mr')})`,
      body: rules.map((r) => RULE_BY_ID[r]?.label ?? r).join(' · '),
      confirmLabel: 'บันทึก',
      fields: [
        ...EVENT_FIELDS.map((f) => ({ ...f, defaultValue: existing?.[f.name] ?? '' })),
        { name: 'recorded_by', label: 'ผู้บันทึก', required: true, defaultValue: existing?.recorded_by ?? '' },
      ],
      onConfirm: async (values) => {
        try {
          await apiCall('/events', {
            method: 'PUT',
            body: { ...values, checkpoint_id: cp.id, inspection_id: point.inspectionId, chart: chartKey, rules },
          });
          const ev = await apiCall(`/events?checkpoint_id=${cp.id}&${query}`);
          setEvents(Array.isArray(ev) ? ev : []);
        } catch (e) {
          showAlert({ title: 'บันทึกไม่สำเร็จ', body: e.message });
        }
      },
    });
  };

  // ── ข้อมูลที่จัดวางแล้ว ─────────────────────────────────────────────────
  const isVariableChart = chart && chart.mode !== 'attribute' && chart.limits && chart.points?.length > 0;
  const points = isVariableChart ? chart.points : [];
  const limits = chart?.limits ?? null;
  const isImr = limits?.mode === 'i-mr';
  const n = limits?.n ?? cp?.sample_size ?? 1;
  const blocks = [];
  for (let i = 0; i < points.length; i += COLS_PER_BLOCK) blocks.push(points.slice(i, i + COLS_PER_BLOCK));

  // 1 แถวต่อ "จุด × กราฟ" ที่ผิดกฎ เรียงตามเวลา (xbar ก่อน range ในจุดเดียวกัน — backend เรียงมาแล้ว)
  const ocsRows = (chart?.violations ?? [])
    .map((v) => ({ ...v, point: points[v.index] }))
    .filter((v) => v.point);

  const specMid = cp && isNum(cp.usl) && isNum(cp.lsl) ? (cp.usl + cp.lsl) / 2 : cp?.target ?? null;
  const cap = chart?.capability ?? {};
  const stats = chart?.stats ?? {};
  const target = chart?.capabilityTarget ?? null;
  const inspectors = [...new Set(points.map((p) => p.meta?.inspector).filter(Boolean))];

  // ── ชี้ช่องที่คำนวณ → tooltip สูตรแทนค่า + ไฮไลต์ช่องต้นทาง (utils/scExplain.js) ──
  // Overlay ตัวเดียวเกาะ element ที่ชี้อยู่ ไม่ห่อ OverlayTrigger ทีละช่อง (หลายร้อยช่องต่อหน้า)
  const info = hot ? explain(hot.key, { chart, cp }) : null;
  const sourceKeys = new Set(info?.sources ?? []);
  const hl = (key) =>
    `${sourceKeys.has(key) ? ' sc-cell--src' : ''}${hot?.key === key ? ' sc-cell--active' : ''}`;
  const pointAt = (key) => {
    const show = (e) => setHot({ key, el: e.currentTarget });
    const hide = () => setHot((h) => (h?.key === key ? null : h));
    return { tabIndex: 0, onMouseEnter: show, onFocus: show, onMouseLeave: hide, onBlur: hide };
  };

  const outOfSpec = (v) => isNum(v) && ((isNum(cp?.usl) && v > cp.usl) || (isNum(cp?.lsl) && v < cp.lsl));

  return (
    <Container fluid className="page sc-page">
      <div className="page-head no-print">
        <h1>SC Chart</h1>
        <div className="page-head__meta">ฟอร์ม SP-QC-214C · 1 จุดตรวจ × 1 เดือน</div>
      </div>

      {/* ── แถบเลือก (ไม่ออกตอนพิมพ์) ── */}
      <Row className="g-2 mb-3 align-items-end no-print">
        <Col md={4} lg={3}>
          <Form.Label className="small mb-1 text-muted" htmlFor="sc-model">Item</Form.Label>
          <SearchSelect
            id="sc-model"
            value={modelId}
            onChange={(v) => {
              // เปลี่ยน item = จุดตรวจเดิมใช้ไม่ได้แน่ · เครื่องใช้ต่อได้เฉพาะ division เดียวกัน
              setModelId(v);
              setCheckpointId('');
              const next = models.find((m) => String(m.id) === String(v));
              if (machine && next && machine.division_id !== next.division_id) setMachineId('');
            }}
            placeholder="— เลือก item —"
            emptyText="ไม่พบ item ที่ค้นหา"
            options={models
              .filter((m) => m.is_active || String(m.id) === String(modelId))
              .map((m) => ({ value: String(m.id), label: `${m.item_no} — ${m.item_name}`, hint: m.division_name ?? '' }))}
          />
        </Col>
        <Col md={4} lg={3}>
          <Form.Label className="small mb-1 text-muted" htmlFor="sc-checkpoint">จุดตรวจ</Form.Label>
          <div className="d-flex gap-1">
            <Button variant="outline-secondary" size="sm" aria-label="จุดก่อนหน้า"
              disabled={cpIndex <= 0} onClick={() => setCheckpointId(String(checkpoints[cpIndex - 1].id))}>‹</Button>
            <div className="flex-grow-1">
              <SearchSelect
                id="sc-checkpoint"
                value={checkpointId}
                onChange={setCheckpointId}
                disabled={checkpoints.length === 0}
                placeholder={modelId ? '— ไม่มีจุดตรวจแบบค่าตัวเลข —' : '— เลือก item ก่อน —'}
                emptyText="ไม่พบจุดตรวจ"
                options={checkpoints.map((c) => ({
                  value: String(c.id),
                  label: `${c.seq_no}. ${c.name}`,
                  hint: [c.characteristic, c.is_critical ? 'SC point' : null].filter(Boolean).join(' · '),
                }))}
              />
            </div>
            <Button variant="outline-secondary" size="sm" aria-label="จุดถัดไป"
              disabled={cpIndex < 0 || cpIndex >= checkpoints.length - 1}
              onClick={() => setCheckpointId(String(checkpoints[cpIndex + 1].id))}>›</Button>
          </div>
        </Col>
        <Col md={4} lg={3}>
          <Form.Label className="small mb-1 text-muted" htmlFor="sc-machine">เครื่อง</Form.Label>
          <SearchSelect
            id="sc-machine"
            value={machineId}
            onChange={setMachineId}
            disabled={!modelId}
            placeholder="— รวมทุกเครื่อง —"
            emptyText="ไม่พบเครื่อง"
            options={[ALL_MACHINES, ...visibleMachines.map((mc) => ({ value: String(mc.id), label: `${mc.code} — ${mc.name}` }))]}
          />
        </Col>
        {categories.length > 1 && (
          <Col xs={6} md={3} lg={2}>
            <Form.Label className="small mb-1 text-muted" htmlFor="sc-category">หมวดการตรวจ</Form.Label>
            <Form.Select id="sc-category" value={category || '1'} disabled={!modelId}
              onChange={(e) => setCategory(e.target.value === '1' ? '' : e.target.value)}>
              {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </Form.Select>
          </Col>
        )}
        <Col xs={6} md={3} lg={2}>
          <Form.Label className="small mb-1 text-muted" htmlFor="sc-month">เดือน</Form.Label>
          <Form.Control id="sc-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Col>
        <Col xs="auto">
          <Button variant="outline-primary" onClick={() => window.print()} disabled={!isVariableChart}>
            พิมพ์ฟอร์ม
          </Button>
        </Col>
      </Row>

      {error && <Alert variant="danger" className="no-print">{error}</Alert>}
      {!modelId && <div className="empty">เลือก item ก่อน</div>}
      {modelId && checkpoints.length === 0 && model && (
        <div className="empty">item นี้ไม่มีจุดตรวจแบบค่าตัวเลข — จุดที่ตรวจด้วยตาไม่มี control chart</div>
      )}
      {loading && !chart && (
        <div className="empty"><Spinner animation="border" size="sm" className="me-2" />กำลังโหลด</div>
      )}

      {cp && chart && (
        <div className="sc">
          {/* ── หัวกระดาษ ── */}
          <table className="sc-head">
            <tbody>
              <tr>
                <th>Part Name</th><td>{model?.item_name}</td>
                <th>Part No.</th><td className="num">{model?.item_no}</td>
                <th rowSpan={2} className="sc-head__group">Specification</th>
                <th>Max.</th><td className={`num${hl('spec:usl')}`}>{cp.usl ?? '—'}</td>
                <th className="sc-head__group">Chart</th>
                <th>{isImr ? 'I Chart' : 'X̄ Chart'}</th>
                <th>{isImr ? 'MR Chart' : 'R Chart'}</th>
                <th>Machine</th><td>{machine ? `${machine.code} — ${machine.name}` : 'รวมทุกเครื่อง'}</td>
                <th>Month</th><td>{monthLabel(month)}</td>
              </tr>
              <tr>
                <th>Quality Characteristic</th>
                <td colSpan={3}>
                  <b>{cp.seq_no}. {cp.name}</b>
                  {cp.characteristic && <span className="text-muted"> · {cp.characteristic}</span>}
                  {cp.is_critical ? <Badge bg="light" text="dark" className="ms-1">SC point</Badge> : null}
                  <div><SpecValue checkpoint={cp} /></div>
                </td>
                <th>Aver.</th><td className="num">{isNum(specMid) ? specMid : '—'}</td>
                <th>UCL</th>
                <td className={`num sc-calc${hl('lim:ucl')}`} {...pointAt('lim:ucl')}>{fmt(limits?.ucl)}</td>
                <td className={`num sc-calc${hl('lim:rucl')}`} {...pointAt('lim:rucl')}>{fmt(limits?.rangeUcl)}</td>
                <th>Inspector</th><td>{inspectors.join(', ') || '—'}</td>
                <th>Chart no.</th><td className="num">{cp.seq_no}</td>
              </tr>
              <tr>
                <th>Gage name</th><td>{cp.gauge || '—'}</td>
                <th>Unit</th><td>{cp.unit || '—'}</td>
                <th />
                <th>Min.</th><td className={`num${hl('spec:lsl')}`}>{cp.lsl ?? '—'}</td>
                <th>CL</th>
                <td className={`num sc-calc${hl('lim:cl')}`} {...pointAt('lim:cl')}>{fmt(limits?.center)}</td>
                <td className={`num sc-calc${hl('lim:rcl')}`} {...pointAt('lim:rcl')}>{fmt(limits?.rangeCenter)}</td>
                <th>Sample size</th><td className="num">{n} pcs / {FREQ_TEXT[cp.frequency] ?? 'ทุกกะ'}</td>
                <th>Confirm by</th><td className="sc-head__sign" />
              </tr>
              <tr>
                <th colSpan={7} className="sc-head__note">
                  {limits?.provisional
                    ? <span className="sc-provisional">ลิมิตยังไม่ล็อก (provisional) — คำนวณสดจากข้อมูลในช่วงนี้</span>
                    : <span className="text-muted">ลิมิตจาก baseline ที่ล็อกไว้</span>}
                  {chart?.ocs && (
                    <span className="text-muted">
                      {' · '}{RULE_SET_LABEL[chart.ocs.ruleSet] ?? RULE_SET_LABEL.basic}
                      {chart.capabilityTarget?.customerName ? ` (ลูกค้า ${chart.capabilityTarget.customerName})` : ''}
                    </span>
                  )}
                </th>
                <th>LCL</th>
                <td className={`num sc-calc${hl('lim:lcl')}`} {...pointAt('lim:lcl')}>{fmt(limits?.lcl)}</td>
                <td className={`num sc-calc${hl('lim:rlcl')}`} {...pointAt('lim:rlcl')}>{fmt(limits?.rangeLcl)}</td>
                <td colSpan={4} />
              </tr>
            </tbody>
          </table>

          {chart.error && <Alert variant="warning" className="mt-2 mb-0 small">{chart.error}</Alert>}
          {!chart.error && !isVariableChart && (
            <div className="empty">ยังไม่มีข้อมูลค่าวัดของจุดนี้ใน{monthLabel(month)}</div>
          )}

          {isVariableChart && (
            <>
              {/* ── ตาราง subgroup + OCS (30 คอลัมน์ต่อบล็อก) ── */}
              {blocks.map((block, b) => (
                <div className="sc-grid-wrap" key={b}>
                  <table className="sc-grid">
                    <tbody>
                      <tr>
                        <th colSpan={2}>Date</th>
                        {/* dd/mm/yyyy เต็ม แต่ตัดบรรทัดหลัง dd/mm/ ได้ — 30 คอลัมน์ต้องพอดี A4 แนวนอน */}
                        {block.map((p) => {
                          const d = fmtDate(p.meta?.inspectedAt);
                          return <td key={p.index} className="sc-grid__date">{d.slice(0, 6)}<wbr />{d.slice(6)}</td>;
                        })}
                      </tr>
                      <tr>
                        <th colSpan={2}>Time</th>
                        {block.map((p) => <td key={p.index}>{fmtTime(p.meta?.inspectedAt)}</td>)}
                      </tr>
                      <tr>
                        <th colSpan={2}>Shift</th>
                        {block.map((p) => <td key={p.index}>{p.meta?.shift ?? ''}</td>)}
                      </tr>
                      {Array.from({ length: n }, (_, k) => (
                        <tr key={`v${k}`}>
                          {k === 0 && <th rowSpan={n} className="sc-grid__side">ค่าวัด</th>}
                          <th>{k + 1}</th>
                          {block.map((p) => {
                            const v = p.values?.[k];
                            return (
                              <td key={p.index} className={`num${outOfSpec(v) ? ' sc-cell--ng' : ''}${hl(`v:${p.index}:${k}`)}`}>
                                {isNum(v) ? v : ''}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr className="sc-grid__stat">
                        <th colSpan={2}>{isImr ? 'X' : 'X̄'}</th>
                        {block.map((p) => (
                          <td key={p.index} className={`num sc-calc${p.rules?.length ? ' sc-cell--ocs' : ''}${hl(`x:${p.index}`)}`}
                            {...pointAt(`x:${p.index}`)}>{fmt(p.xbar)}</td>
                        ))}
                      </tr>
                      <tr className="sc-grid__stat">
                        <th colSpan={2}>{isImr ? 'MR' : 'R'}</th>
                        {block.map((p) => (
                          <td key={p.index} className={`num sc-calc${p.rangeRules?.length ? ' sc-cell--ocs' : ''}${hl(`r:${p.index}`)}`}
                            {...pointAt(`r:${p.index}`)}>
                            {isNum(p.range) ? fmt(p.range) : ''}
                          </td>
                        ))}
                      </tr>

                      {/* ── แก้ค่าในใบเดิม — ปุ่มแยกแถว ไม่ทำให้เซลล์ตัวเลขคลิกได้ (คลิกพลาดแล้วเด้งกล่อง) ── */}
                      {session && (
                      <tr className="no-print sc-grid__edit">
                        <th colSpan={2}>แก้ค่า</th>
                        {block.map((p) => (
                          <td key={p.index}>
                            <button type="button" className="btn btn-link btn-sm p-0"
                              title={`แก้ค่าใบ subgroup #${p.subgroupNo} (ต้อง login)`}
                              aria-label={`แก้ค่าใบ subgroup ${p.subgroupNo}`}
                              onClick={() => setEditingId(p.inspectionId)}>
                              ✎
                            </button>
                          </td>
                        ))}
                      </tr>
                      )}

                      {/* ── OCS: ● ที่จุดที่ครบเงื่อนไขของกฎ ── */}
                      {/* แถวตามกฎที่ใช้จริงของลูกค้า (chart.ocs) — กฎ 5-8 มีแค่กราฟบน */}
                      {[['xbar', 'rules'], ['range', 'rangeRules']].map(([chartKey, key]) => {
                        const list = rulesFor(chart.ocs?.[chartKey]);
                        return list.map((rule, r) => (
                          <tr key={`${chartKey}-${rule.id}`} className="sc-grid__ocs">
                            {r === 0 && (
                              <th rowSpan={list.length} className="sc-grid__side">
                                OCS {chartLabel(chartKey, isImr)}
                              </th>
                            )}
                            <th className="sc-grid__rule">{rule.no}. {rule.label}</th>
                            {block.map((p) => (
                              <td key={p.index} className={p[key]?.includes(rule.id) ? 'sc-cell--ocs' : ''}>
                                {p[key]?.includes(rule.id) ? '●' : ''}
                              </td>
                            ))}
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                </div>
              ))}

              {/* ── กราฟ + กล่องสถิติ ── */}
              <div className="sc-body">
                <div className="sc-body__charts">
                  <div className="sc-caption">{isImr ? 'I Chart' : 'X̄ Chart'} / {isImr ? 'MR Chart' : 'R Chart'}</div>
                  <XbarRCharts chart={chart} height={240} />
                </div>
                <div className="sc-body__side">
                <table className="sc-stats">
                  <tbody>
                    {/* n = ชิ้นต่อ subgroup ตาม Excel (COUNT(D9:D13)) — ตัวเดียวกับที่เปิดตาราง A2/D3/D4/d₂ */}
                    {[
                      ['n', 'n', n],
                      ['count', 'ค่าวัดทั้งหมด', stats.count ?? '—'],
                      ['subgroups', 'Subgroup', stats.subgroups ?? points.length],
                      ['max', 'Max', fmt(stats.max)],
                      ['min', 'Min', fmt(stats.min)],
                      ['sigma', 'σ (R̄/d₂)', fmt(cap.sigmaWithin, 5)],
                      ['xbarbar', 'x̿', fmt(stats.xbarbar)],
                      ['rbar', isImr ? 'M̄R' : 'R̄', fmt(stats.rbar)],
                      ['cp', 'Cp', fmtCap(cap.cp), capClass(cap.cp, target?.minCp)],
                      ['cpu', 'Cpu', fmtCap(cap.cpu)],
                      ['cpl', 'Cpl', fmtCap(cap.cpl)],
                      ['cpk', 'Cpk', fmtCap(cap.cpk), `fw-bold ${capClass(cap.cpk, target?.minCpk)}`],
                      ['pp', 'Pp / Ppk', `${fmtCap(cap.pp)} / ${fmtCap(cap.ppk)}`, '', 'text-muted'],
                    ].map(([id, label, value, tdClass = '', trClass]) => (
                      <tr key={id} className={trClass}>
                        <th>{label}</th>
                        <td className={`num sc-calc ${tdClass}${hl(`stat:${id}`)}`} {...pointAt(`stat:${id}`)}>{value}</td>
                      </tr>
                    ))}
                    {target && <tr><td colSpan={2} className="sc-stats__note">{targetLabel(target)}</td></tr>}
                  </tbody>
                </table>

                {/* ── ตารางค่าคงที่ (มาจาก server) — แถว n ที่ใช้อยู่เน้นไว้ · ชี้ σ/UCL/LCL แล้วช่องที่ใช้สว่าง ── */}
                {/* ไม่มีตาราง = backend ยังเป็นเวอร์ชันเก่า (ไม่ restart) — บอกตรง ๆ ห้ามหายเงียบ */}
                {!chart.constantsTable && (
                  <div className="sc-stats__note no-print">ตารางค่าคงที่ยังไม่มา — backend ต้องรีสตาร์ตเป็นเวอร์ชันใหม่</div>
                )}
                {chart.constantsTable && (
                  <table className="sc-const">
                    <caption>ค่าคงที่ control chart</caption>
                    <thead>
                      <tr><th>n</th>{CONST_COLS.map(([, label]) => <th key={label}>{label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {chart.constantsTable.rows.map((row) => (
                        <tr key={row.n} className={row.n === (isImr ? 2 : n) ? 'sc-const__current' : ''}>
                          <th>{row.n}</th>
                          {CONST_COLS.map(([col]) => (
                            <td key={col} className={`num${hl(`k:${row.n}:${col}`)}`}>{row[col].toFixed(3)}</td>
                          ))}
                        </tr>
                      ))}
                      <tr className={isImr ? 'sc-const__current' : ''}>
                        <td colSpan={CONST_COLS.length + 1} className={`sc-const__imr${hl('k:imr:E2')}`}>
                          I-MR (n = 1): E2 = {chart.constantsTable.imr.E2.toFixed(3)} · d₂/D3/D4 ใช้แถว n = 2
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
                </div>
              </div>

              <Overlay target={hot?.el} show={Boolean(info && hot?.el)} placement="top">
                {(props) => (
                  <Tooltip {...props} className="sc-tip">
                    {info && (
                      <>
                        <div className="sc-tip__title">{info.title}</div>
                        {info.lines.map((line, j) => <div key={j}>{line}</div>)}
                      </>
                    )}
                  </Tooltip>
                )}
              </Overlay>

              {/* ── Event Log ── */}
              <h2 className="sc-section">Event Log / Corrective Action</h2>
              {ocsRows.length === 0 ? (
                <div className="text-muted small mb-3">ไม่มีจุดที่ผิดกฎ OCS ในเดือนนี้</div>
              ) : (
                <div className="sc-grid-wrap">
                  <table className="sc-events">
                    <thead>
                      <tr>
                        <th>OCS</th><th>Date</th><th>Time</th><th>Shift</th><th>MO</th>
                        {EVENT_FIELDS.map((f) => <th key={f.name}>{f.label}</th>)}
                        <th>ผู้บันทึก</th>
                        <th className="no-print" />
                      </tr>
                    </thead>
                    <tbody>
                      {ocsRows.map((v) => {
                        const e = eventByKey.get(`${v.point.inspectionId}:${v.chart}`);
                        return (
                          <tr key={`${v.index}-${v.chart}`} className={e ? '' : 'sc-events--pending'}>
                            <td>
                              <b>{chartLabel(v.chart, isImr)}</b> #{v.point.subgroupNo}
                              <div className="small">{v.rules.map((r) => RULE_BY_ID[r]?.label ?? r).join(', ')}</div>
                            </td>
                            <td>{fmtDate(v.point.meta?.inspectedAt)}</td>
                            <td>{fmtTime(v.point.meta?.inspectedAt)}</td>
                            <td>{v.point.meta?.shift}</td>
                            <td>{v.point.meta?.moNo}</td>
                            {e
                              ? EVENT_FIELDS.map((f) => <td key={f.name} className="sc-events__text">{e[f.name] ?? ''}</td>)
                              : <td colSpan={EVENT_FIELDS.length} className="sc-events__missing">ยังไม่ได้บันทึกสาเหตุ</td>}
                            <td>{e?.recorded_by ?? ''}</td>
                            <td className="no-print">
                              <Button size="sm" variant={e ? 'outline-secondary' : 'warning'}
                                onClick={() => openEvent(v.point, v.chart, v.rules)}>
                                {e ? 'แก้' : 'บันทึก'}
                              </Button>
                              {/* จุดที่ผิดกฎคือจุดที่มีโอกาสพิมพ์ผิดสูงสุด — แก้ค่าจากตรงนี้ได้เลย */}
                              {session && (
                                <Button size="sm" variant="outline-secondary" className="ms-1"
                                  title="แก้ค่าในใบตรวจนี้"
                                  onClick={() => setEditingId(v.point.inspectionId)}>
                                  แก้ค่า
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <div className="sc-footer">
            <span>Precision Component Mechanical Lopburi</span>
            <span>SP-QC-214C</span>
          </div>
        </div>
      )}

      <AppDialog dialog={dialog} onHide={closeDialog} />
      <EditInspectionModal
        inspectionId={editingId}
        onHide={() => setEditingId(null)}
        onSaved={(res) => {
          setEditingId(null);
          loadData();
          // ⚠️ baseline freeze ไว้ — แก้ค่าในช่วงที่ล็อกแล้ว เส้น control limit ยังมาจากค่าเดิม
          showAlert(res.staleBaselines?.length
            ? {
              title: 'แก้แล้ว — ต้อง Re-baseline',
              body: `แก้ ${res.changed} ค่า · ใบนี้อยู่ในช่วง baseline ที่ล็อกไว้\n\n` +
                `จุดตรวจที่กระทบ: ${res.staleBaselines.join(', ')}\n\nให้ไปกด Re-baseline ที่หน้าตั้งค่า Master`,
            }
            : { title: 'แก้แล้ว', body: `แก้ ${res.changed} ค่า · ผลรวมใบนี้ ${res.overall_result}` });
        }}
      />
    </Container>
  );
};

export default ScSheet;
