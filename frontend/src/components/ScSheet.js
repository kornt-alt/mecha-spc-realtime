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
import { Container, Row, Col, Alert, Button, Form, Spinner, Badge } from 'react-bootstrap';
import SearchSelect from './SearchSelect';
import SpecValue from './SpecValue';
import AppDialog from './AppDialog';
import XbarRCharts, { fmt, fmtCap, capClass } from './XbarRCharts';
import { apiCall } from '../utils/api';
import { on, joinModel, leaveModel } from '../utils/socket';
import { normalizeRows, normalizeCheckpoints, normalizeChart } from '../utils/normalize';
import { useModelParam, useUrlParam } from '../utils/useModelParam';
import { RULE_BY_ID, RULE_SET_LABEL, chartLabel, rulesFor } from '../utils/spcRules';
import { targetLabel } from '../utils/capability';
import useDialog from '../utils/useDialog';

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

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit' }) : '');
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
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

  // ── master ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([apiCall('/master/models?all=1'), apiCall('/master/lookups?all=1')])
      .then(([ms, lk]) => {
        setModels(normalizeRows(ms));
        setMachines(normalizeRows(lk?.machines ?? []));
      })
      .catch((e) => setError(e.message));
  }, []);

  // จุดตรวจของ item — เฉพาะ variable เพราะจุด attribute ไม่มีค่าตัวเลข วาด control chart ไม่ได้
  const loadModel = useCallback(async (id) => {
    if (!id) {
      setModel(null);
      setCheckpoints([]);
      return;
    }
    try {
      const data = await apiCall(`/master/models/${id}`);
      setModel(normalizeRows([data.model])[0]);
      setCheckpoints(normalizeCheckpoints(data.checkpoints).filter((c) => c.char_type === 'variable'));
    } catch (e) {
      setError(e.message);
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

  // ── กราฟ + Event Log ─────────────────────────────────────────────────
  const query = useMemo(() => {
    const q = new URLSearchParams(monthRange(month));
    if (machineId) q.set('machine_id', machineId);
    return q.toString();
  }, [month, machineId]);

  const loadData = useCallback(async () => {
    if (!cp) {
      setChart(null);
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const [c, ev] = await Promise.all([
        apiCall(`/charts/${cp.id}?${query}`),
        apiCall(`/events?checkpoint_id=${cp.id}&${query}`),
      ]);
      setChart(normalizeChart(c));
      setEvents(Array.isArray(ev) ? ev : []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // cp เปลี่ยน object ทุกครั้งที่โหลดจุดตรวจใหม่ ผูกกับ id พอ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cp?.id, query]);
  useEffect(() => { loadData(); }, [loadData]);

  // ── realtime — ใบใหม่ของจุดนี้ (และเครื่องนี้) เข้ามา → โหลดใหม่ ─────────────
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  const watchRef = useRef({});
  watchRef.current = { checkpointId: cp?.id, machineId };
  useEffect(() => {
    if (!modelId) return undefined;
    joinModel(modelId);
    return () => leaveModel(modelId);
  }, [modelId]);
  useEffect(() => {
    const relevant = (p) => {
      const w = watchRef.current;
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
            onChange={(v) => { setModelId(v); setCheckpointId(''); }}
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
                <th>Max.</th><td className="num">{cp.usl ?? '—'}</td>
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
                <td className="num">{fmt(limits?.ucl)}</td>
                <td className="num">{fmt(limits?.rangeUcl)}</td>
                <th>Inspector</th><td>{inspectors.join(', ') || '—'}</td>
                <th>Chart no.</th><td className="num">{cp.seq_no}</td>
              </tr>
              <tr>
                <th>Gage name</th><td>{cp.gauge || '—'}</td>
                <th>Unit</th><td>{cp.unit || '—'}</td>
                <th />
                <th>Min.</th><td className="num">{cp.lsl ?? '—'}</td>
                <th>CL</th>
                <td className="num">{fmt(limits?.center)}</td>
                <td className="num">{fmt(limits?.rangeCenter)}</td>
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
                <td className="num">{fmt(limits?.lcl)}</td>
                <td className="num">{fmt(limits?.rangeLcl)}</td>
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
                        {block.map((p) => <td key={p.index}>{fmtDate(p.meta?.inspectedAt)}</td>)}
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
                              <td key={p.index} className={`num${outOfSpec(v) ? ' sc-cell--ng' : ''}`}>
                                {isNum(v) ? v : ''}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr className="sc-grid__stat">
                        <th colSpan={2}>{isImr ? 'X' : 'X̄'}</th>
                        {block.map((p) => (
                          <td key={p.index} className={`num${p.rules?.length ? ' sc-cell--ocs' : ''}`}>{fmt(p.xbar)}</td>
                        ))}
                      </tr>
                      <tr className="sc-grid__stat">
                        <th colSpan={2}>{isImr ? 'MR' : 'R'}</th>
                        {block.map((p) => (
                          <td key={p.index} className={`num${p.rangeRules?.length ? ' sc-cell--ocs' : ''}`}>
                            {isNum(p.range) ? fmt(p.range) : ''}
                          </td>
                        ))}
                      </tr>

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
                <table className="sc-stats">
                  <tbody>
                    <tr><th>n (ค่าวัด)</th><td className="num">{stats.count ?? '—'}</td></tr>
                    <tr><th>Subgroup</th><td className="num">{stats.subgroups ?? points.length}</td></tr>
                    <tr><th>Max</th><td className="num">{fmt(stats.max)}</td></tr>
                    <tr><th>Min</th><td className="num">{fmt(stats.min)}</td></tr>
                    <tr><th>σ (R̄/d₂)</th><td className="num">{fmt(cap.sigmaWithin, 5)}</td></tr>
                    <tr><th>x̿</th><td className="num">{fmt(stats.xbarbar)}</td></tr>
                    <tr><th>{isImr ? 'M̄R' : 'R̄'}</th><td className="num">{fmt(stats.rbar)}</td></tr>
                    <tr><th>Cp</th><td className={`num ${capClass(cap.cp, target?.minCp)}`}>{fmtCap(cap.cp)}</td></tr>
                    <tr><th>Cpu</th><td className="num">{fmtCap(cap.cpu)}</td></tr>
                    <tr><th>Cpl</th><td className="num">{fmtCap(cap.cpl)}</td></tr>
                    <tr><th>Cpk</th><td className={`num fw-bold ${capClass(cap.cpk, target?.minCpk)}`}>{fmtCap(cap.cpk)}</td></tr>
                    <tr className="text-muted"><th>Pp / Ppk</th><td className="num">{fmtCap(cap.pp)} / {fmtCap(cap.ppk)}</td></tr>
                    {target && <tr><td colSpan={2} className="sc-stats__note">{targetLabel(target)}</td></tr>}
                  </tbody>
                </table>
              </div>

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
    </Container>
  );
};

export default ScSheet;
