// frontend/src/components/ReportPage.js — รายงานรายรุ่น
//
// ต่างจาก Dashboard ตรงที่หน้านี้กรองย้อนหลังได้ (ช่วงวัน / MO / shift / ผู้ตรวจ / เครื่อง)
// และไม่รับ realtime — ตั้งใจ เพราะข้อมูลที่กำลังอ่านอยู่ไม่ควรขยับใต้มือระหว่างตรวจสอบ
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { apiCall, apiDownload } from '../utils/api';
import { normalizeRows, normalizeChart } from '../utils/normalize';
import { SHIFTS } from '../utils/config';
import SearchSelect from './SearchSelect';
import { Link } from 'react-router-dom';
import { useModelParam, useUrlParam, scHref } from '../utils/useModelParam';
import ControlChart from './ControlChart';
import InputGrid from './InputGrid';
import InspectionList from './InspectionList';
import EditInspectionModal from './EditInspectionModal';
import useSession from '../utils/useSession';
import SpecValue from './SpecValue';
import DateInput from './DateInput';
import { capTone } from '../utils/capability';

// เกณฑ์ Cp/Cpk มากับผลของแต่ละจุด (capabilityTarget) — ลูกค้าต่างกันเกณฑ์ต่างกัน จุด CTF ก็คนละชุด
// ต่ำกว่าเกณฑ์ถือเป็นเรื่องต้องดู แต่ยังไม่ใช่ของเสีย → เหลือง · ต่ำกว่า 1.0 → แดง
const capStyle = (v, min) => {
  const tone = capTone(v, min);
  if (tone === 'below') return { color: 'var(--amber-text)', fontWeight: 600 };
  if (tone === 'poor') return { color: 'var(--red)', fontWeight: 600 };
  return undefined;
};

const fmtMin = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

// ⚠️ ค่าตั้งต้น = เดือนนี้ (วันที่ 1 ถึงวันนี้ ตามเวลาไทย) ไม่ใช่ "ทั้งหมด" — เดิมไม่มีวันที่ เปิดหน้า/เลือก item/
//    ล้างตัวกรอง = ดึงทุกใบตั้งแต่วันแรกแล้วคำนวณ X̄-R ทุกจุด ยิ่งข้อมูลสะสมยิ่งช้า (ปัญหาเดียวกับ Dashboard)
//    ดูทั้งหมดยังได้: ลบวันทั้งสองช่องแล้วกดค้นหา · ห้าม toISOString (UTC ช่วงเช้ามืดได้วันก่อนหน้า)
const defaultFilter = () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  return { from: `${today.slice(0, 8)}01`, to: today, mo_no: '', shift: '', inspector_id: '', machine_id: '' };
};

// ⚠️ ส่งเฉพาะช่องที่กรอกจริง — ค่าว่างคือไม่กรอง ไม่ใช่กรองด้วยค่าว่าง
// และวันที่ต้องครบทั้ง from/to ถึงจะกรอง (ต้องตรงกับเงื่อนไขฝั่ง backend เป๊ะ
// ไม่งั้นกรอกวันเดียวแล้วหน้าจอบอกว่ากรองแล้วทั้งที่ server ไม่ได้กรอง)
const toQuery = (f) => {
  const p = new URLSearchParams();
  if (f.from && f.to) { p.set('from', f.from); p.set('to', f.to); }
  for (const k of ['mo_no', 'shift', 'inspector_id', 'machine_id']) {
    if (f[k]) p.set(k, f[k]);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—');

const ReportPage = () => {
  const [models, setModels] = useState([]);
  const [lookups, setLookups] = useState({ machines: [], inspectors: [] });
  const [modelId, setModelId] = useModelParam(false);
  const [filter, setFilter] = useState(defaultFilter);
  const [applied, setApplied] = useState(defaultFilter);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  // มุมมองผลลัพธ์อยู่ใน URL (?view=input) — ลิงก์/รีเฟรชแล้วกลับมาที่เดิม ตามหลักเดียวกับ ?model=
  const [view, setView] = useUrlParam('view');
  const [gridKey, setGridKey] = useState(0);
  // ใบที่เปิดกล่อง "แก้ค่าในใบเดิม" อยู่ (ต้อง login — กล่องจัดการเอง) · null = ปิด
  const [editingId, setEditingId] = useState(null);
  // ปุ่มแก้ค่าขึ้นเฉพาะตอน login แล้ว (login ที่หน้า Master) — ตัวกั้นจริงคือ requireLogin ฝั่ง backend
  const session = useSession();
  const [editMsg, setEditMsg] = useState(null);

  useEffect(() => {
    Promise.all([apiCall('/master/models?all=1'), apiCall('/master/lookups?all=1')])
      .then(([ms, lk]) => { setModels(normalizeRows(ms)); setLookups(lk); })
      .catch((e) => setError(e.message));
  }, []);

  // ⚠️ reqRef กัน response เก่า — เปลี่ยน item A → B แล้ว A ตอบช้ากว่า รายงานของ A จะทับ B
  //    แล้วค้างอยู่ใต้ชื่อ B (กฎเดียวกับ loadAll ของ Dashboard)
  const reqRef = useRef(0);
  const load = useCallback(async (id, f) => {
    const my = ++reqRef.current;
    if (!id) { setReport(null); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await apiCall(`/reports/model/${id}${toQuery(f)}`);
      if (my !== reqRef.current) return;
      // inspections ?? [] — กัน backend รุ่นเก่าที่ยังไม่ส่ง field นี้มา หน้าจะได้ไม่ขาว
      setReport({ ...data, charts: data.charts.map(normalizeChart), inspections: data.inspections ?? [] });
      setError(null);
    } catch (e) {
      if (my !== reqRef.current) return;
      setError(e.message);
      setReport(null);
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, []);

  // เปลี่ยน item = ล้างของ item เดิมทันที (รายงาน · error · กล่องแก้ค่าที่เปิดค้างของใบจาก item เก่า)
  useEffect(() => {
    setReport(null);
    setError(null);
    setEditingId(null);
    setEditMsg(null);
  }, [modelId]);

  useEffect(() => { load(modelId, applied); }, [modelId, applied, load]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await apiDownload(`/reports/model/${modelId}/export${toQuery(applied)}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const field = (key) => ({
    value: filter[key],
    onChange: (e) => setFilter((f) => ({ ...f, [key]: e.target.value })),
  });

  // SearchSelect ส่งค่ามาตรง ๆ ไม่ใช่ event
  const pick = (key) => (value) => setFilter((f) => ({ ...f, [key]: value }));

  // ⚠️ ตัวกรองต้องมีทางกลับไป "ทั้งหมด" — ตัวเลือกว่างจึงเป็นแถวจริงในลิสต์
  //    ไม่ใช่แค่ placeholder (placeholder เลือกกลับไม่ได้เมื่อเลือกอะไรไปแล้ว)
  const ALL = { value: '', label: 'ทั้งหมด' };

  const dateIncomplete = Boolean(filter.from) !== Boolean(filter.to);
  const s = report?.summary;

  return (
    <Container fluid className="page">
      <div className="page-head">
        <h1>รายงานผลตรวจราย model</h1>
        {report && !loading && (
          <div className="page-head__meta num">
            {report.charts.length} จุดตรวจ
            {` · ลูกค้า ${report.model?.customer_name ?? 'ไม่ระบุ'}`}
            {report.targets && (
              ` · เกณฑ์ Cpk ≥ ${fmtMin(report.targets.general.minCpk)}` +
              ` (SC point ≥ ${fmtMin(report.targets.ctf.minCpk)})`
            )}
          </div>
        )}
      </div>

      <Card className="mb-3">
        <Card.Body className="pb-2">
          <Row className="g-2 align-items-end">
            <Col md={3}>
              <Form.Label htmlFor="report-model" className="small mb-1">model</Form.Label>
              <SearchSelect
                id="report-model"
                value={modelId}
                onChange={setModelId}
                placeholder="— เลือก model —"
                emptyText="ไม่พบ item ที่ค้นหา"
                options={models.map((m) => ({
                  value: String(m.id),
                  label: `${m.item_no} — ${m.item_name}`,
                  hint: m.division_name ?? '',
                }))}
              />
            </Col>
            <Col md={2}>
              <Form.Label className="small mb-1">ตั้งแต่วันที่</Form.Label>
              <DateInput value={filter.from} onChange={pick('from')} />
            </Col>
            <Col md={2}>
              <Form.Label className="small mb-1">ถึงวันที่</Form.Label>
              <DateInput value={filter.to} onChange={pick('to')} />
            </Col>
            <Col md={2}>
              <Form.Label className="small mb-1">MO No.</Form.Label>
              <Form.Control {...field('mo_no')} placeholder="ทั้งหมด" />
            </Col>
            <Col md={1}>
              <Form.Label className="small mb-1">shift</Form.Label>
              <Form.Select {...field('shift')}>
                <option value="">ทั้งหมด</option>
                {SHIFTS.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}
              </Form.Select>
            </Col>
            <Col md={2}>
              <Form.Label htmlFor="report-inspector" className="small mb-1">ผู้ตรวจ</Form.Label>
              <SearchSelect
                id="report-inspector"
                value={filter.inspector_id}
                onChange={pick('inspector_id')}
                placeholder="ทั้งหมด"
                emptyText="ไม่พบผู้ตรวจที่ค้นหา"
                options={[ALL, ...lookups.inspectors.map((i) => ({
                  value: String(i.id), label: i.name, hint: i.emp_code ?? '',
                }))]}
              />
            </Col>
          </Row>
          <Row className="g-2 align-items-end mt-1">
            <Col md={3}>
              <Form.Label htmlFor="report-machine" className="small mb-1">เครื่อง</Form.Label>
              <SearchSelect
                id="report-machine"
                value={filter.machine_id}
                onChange={pick('machine_id')}
                placeholder="ทั้งหมด"
                emptyText="ไม่พบเครื่องที่ค้นหา"
                options={[ALL, ...lookups.machines.map((m) => ({
                  value: String(m.id), label: m.code, hint: m.name ?? '',
                }))]}
              />
            </Col>
            <Col md="auto">
              <Button onClick={() => setApplied(filter)} disabled={!modelId}>ค้นหา</Button>
              <Button variant="link" onClick={() => { setFilter(defaultFilter()); setApplied(defaultFilter()); }}>
                ล้างตัวกรอง
              </Button>
            </Col>
            <Col md="auto">
              {/* ไม่ใช้ variant="success" — เขียวสงวนไว้ให้ป้ายผลตัดสินอย่างเดียวทั้งระบบ
                  ปุ่มนี้เป็นการกระทำ ไม่ใช่คำตัดสิน */}
              <Button variant="outline-primary" onClick={handleExport} disabled={!modelId || !report || exporting}>
                {exporting ? <><Spinner size="sm" animation="border" className="me-1" />กำลังสร้าง</> : 'ดาวน์โหลด Excel'}
              </Button>
            </Col>
            {dateIncomplete && (
              <Col>
                {/* ⚠️ ห้ามใช้ .text-warning ตรงนี้ — เหลืองของ bootstrap บนพื้นอ่อนได้ contrast 1.6:1
                    ใช้ --amber-text ที่คำนวณมาให้ผ่าน 4.6:1 แทน */}
                <div className="small" style={{ color: 'var(--amber-text)' }}>
                  กรอกวันที่ให้ครบทั้งสองช่อง ไม่งั้นระบบจะไม่กรองวันที่ให้
                </div>
              </Col>
            )}
            {!dateIncomplete && !(applied.from && applied.to) && (
              <Col>
                <div className="small text-muted">แสดงทุกช่วงเวลา — ข้อมูลเยอะจะโหลดช้า</div>
              </Col>
            )}
          </Row>
        </Card.Body>
      </Card>

      {error && <Alert variant="danger">{error}</Alert>}
      {!modelId && <div className="empty">เลือกรุ่นเพื่อดูรายงาน</div>}
      {loading && (
        <div className="empty"><Spinner animation="border" size="sm" className="me-2" />กำลังโหลดรายงาน</div>
      )}

      {report && !loading && (
        <div className="btn-group mb-3" role="group" aria-label="มุมมอง">
          <Button size="sm" variant={view === 'input' ? 'outline-primary' : 'primary'}
            aria-pressed={view !== 'input'} onClick={() => setView('')}>
            สรุป + กราฟ
          </Button>
          <Button size="sm" variant={view === 'input' ? 'primary' : 'outline-primary'}
            aria-pressed={view === 'input'} onClick={() => setView('input')}>
            ตารางแบบ Input
          </Button>
        </div>
      )}

      {/* ชีต Input ของ Excel — จุดตรวจเป็นคอลัมน์ ชิ้นเป็นแถว ตัวกรองชุดเดียวกับข้างบน */}
      {report && !loading && view === 'input' && (
        <InputGrid
          modelId={modelId}
          query={toQuery(applied)}
          reloadKey={gridKey}
          emptyText="ไม่มีใบตรวจที่ตรงกับตัวกรองนี้"
        />
      )}

      {report && !loading && view !== 'input' && (
        <>
          {/* ตัวเลขสรุป — เงียบเมื่อปกติ มีสีเมื่อผิด
              แดง = หลุดสเปก (ของเสีย) · เหลือง = หลุดคอนโทรล (process เปลี่ยน ของยังไม่เสีย) */}
          <Row className="g-2 mb-3">
            {[
              { label: 'ใบตรวจทั้งหมด', value: s.totalInspections, tone: '' },
              { label: 'ใบที่มี NG', value: s.ngInspections, tone: s.ngInspections > 0 ? 'spec' : '' },
              { label: '%NG (ระดับใบตรวจ)', value: pct(s.ngRate), tone: s.ngRate > 0 ? 'spec' : '' },
              { label: 'จุดที่ out of control', value: s.outOfControlCheckpoints, tone: s.outOfControlCheckpoints > 0 ? 'control' : '' },
            ].map((c) => (
              <Col md={3} key={c.label}>
                <Card
                  className="text-center"
                  style={c.tone ? {
                    borderLeft: `3px solid ${c.tone === 'spec' ? 'var(--red)' : 'var(--amber-line)'}`,
                    background: c.tone === 'spec' ? '#FCECEE' : 'var(--amber-tint)',
                  } : undefined}
                >
                  <Card.Body className="py-2">
                    <div
                      className="fs-4 fw-bold num"
                      style={c.tone ? { color: c.tone === 'spec' ? 'var(--red)' : 'var(--amber-text)' } : undefined}
                    >
                      {c.value}
                    </div>
                    <div className="small text-muted">{c.label}</div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>

          {/* สรุปรายจุด — ตัวเลขชุดเดียวกับที่กราฟข้างล่างใช้ (มาจาก analyze() ตัวเดียวกัน) */}
          <Card className="mb-3">
            <Card.Header className="py-2">สรุปรายจุดตรวจ</Card.Header>
            <div className="sheet-wrap" style={{ maxHeight: 'none', border: 0, borderRadius: 0 }}>
              <table className="sheet">
                <thead>
                  <tr>
                    <th scope="col" className="sheet__seq">#</th>
                    <th scope="col" className="sheet__name">จุดตรวจ</th>
                    <th scope="col" className="sheet__spec">Spec</th>
                    <th scope="col" className="text-end">n</th>
                    <th scope="col" className="text-end">Cp</th>
                    <th scope="col" className="text-end">Cpk</th>
                    <th scope="col" className="text-end">Pp</th>
                    <th scope="col" className="text-end">Ppk</th>
                    <th scope="col" className="text-end">NG</th>
                    <th scope="col">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {report.charts.map((c) => {
                    const cp = c.checkpoint;
                    const cap = c.capability ?? {};
                    const f = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');
                    const isAttr = cp.char_type === 'attribute';
                    const outOfControl = (c.violations?.length ?? 0) > 0;
                    const t = c.capabilityTarget;

                    return (
                      <tr key={cp.id}>
                        <td className="sheet__seq">{cp.seq_no}</td>
                        <th scope="row" className="sheet__name fw-normal">
                          <b>{cp.name}</b>
                          {cp.is_critical && (
                            <span className="badge bg-light text-dark ms-1" title="จุดวิกฤต — SC point">SC point</span>
                          )}
                          {cp.gauge && <span className="sheet__gauge">{cp.gauge}</span>}
                          {!isAttr && (
                            <Link className="sheet__gauge" to={scHref({ modelId: cp.model_id, checkpointId: cp.id, machineId: applied.machine_id })}>
                              ฟอร์ม SC →
                            </Link>
                          )}
                        </th>
                        <td className="sheet__spec"><SpecValue checkpoint={cp} /></td>
                        <td className="text-end num">{isAttr ? '—' : cp.sample_size}</td>
                        <td className="text-end num" style={capStyle(cap.cp, t?.minCp)}
                          title={t ? `เกณฑ์ ≥ ${fmtMin(t.minCp)}` : undefined}>{f(cap.cp)}</td>
                        <td className="text-end num" style={capStyle(cap.cpk, t?.minCpk)}
                          title={t ? `เกณฑ์ ≥ ${fmtMin(t.minCpk)}` : undefined}>{f(cap.cpk)}</td>
                        <td className="text-end num">{f(cap.pp)}</td>
                        <td className="text-end num">{f(cap.ppk)}</td>
                        <td className="text-end num">
                          {c.ngCount ?? 0}
                          {c.ngRate !== null && c.ngRate !== undefined && ` (${pct(c.ngRate)})`}
                        </td>
                        <td>
                          {isAttr ? (
                            <span className="text-muted">—</span>
                          ) : outOfControl ? (
                            <span style={{ color: 'var(--amber-text)', fontWeight: 600 }}>out of control</span>
                          ) : (
                            <span className="text-muted">in control</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Row>
            {report.charts.map((c) => (
              <Col xl={6} key={c.checkpoint.id}>
                <ControlChart chart={c} height={200} machineId={applied.machine_id} />
              </Col>
            ))}
          </Row>

          {/* หน้านี้กรองวัน/MO/กะ/เครื่อง/ผู้ตรวจได้ จึงเป็นทางเดียวที่ไล่เก็บใบเก่าที่กรอกผิดได้
              (ตารางใต้ใบตรวจโชว์แค่ 10 ใบล่าสุดของ item ที่เลือกอยู่) */}
          <Card className="mt-3">
            <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
              <span>ใบตรวจตามตัวกรองนี้</span>
              <span className="text-muted small">
                {report.inspections.length} ใบ
                {/* ⚠️ ตัวเลขสรุปข้างบนกับกราฟไม่นับใบที่ยกเลิก แต่ตารางนี้โชว์ครบ
                    ไม่บอกไว้คนจะนับแถวแล้วสงสัยว่าทำไมไม่ตรงกับหัวรายงาน */}
                {report.summary.voidedInspections > 0 &&
                  ` (ยกเลิกแล้ว ${report.summary.voidedInspections} ใบ — ไม่ถูกนับในสรุป กราฟ และไฟล์ Excel ข้างบน)`}
              </span>
            </Card.Header>
            <Card.Body>
              {editMsg && (
                <Alert variant={editMsg.variant} dismissible onClose={() => setEditMsg(null)}>{editMsg.text}</Alert>
              )}
              <InspectionList
                rows={report.inspections}
                onChanged={() => { load(modelId, applied); setGridKey((k) => k + 1); }}
                onEdit={session ? (row) => { setEditMsg(null); setEditingId(row.id); } : undefined}
                emptyText="ไม่มีใบตรวจที่ตรงกับตัวกรองนี้"
              />
            </Card.Body>
          </Card>
        </>
      )}

      <EditInspectionModal
        inspectionId={editingId}
        onHide={() => setEditingId(null)}
        onSaved={(res) => {
          setEditingId(null);
          // ⚠️ baseline freeze ไว้ — แก้ค่าในช่วงที่ล็อกแล้ว เส้น control limit ยังมาจากค่าเดิม
          setEditMsg(res.staleBaselines?.length
            ? { variant: 'warning', text: `แก้แล้ว ${res.changed} ค่า · ใบนี้อยู่ในช่วง baseline ที่ล็อกไว้ ต้อง Re-baseline ที่หน้า Master: ${res.staleBaselines.join(', ')}` }
            : { variant: 'success', text: `แก้แล้ว ${res.changed} ค่า · ผลรวมใบนี้ ${res.overall_result}` });
          load(modelId, applied);
          setGridKey((k) => k + 1);
        }}
      />
    </Container>
  );
};

export default ReportPage;
