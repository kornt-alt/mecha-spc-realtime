// frontend/src/components/ReportPage.js — รายงานรายรุ่น
//
// ต่างจาก Dashboard ตรงที่หน้านี้กรองย้อนหลังได้ (ช่วงวัน / MO / กะ / ผู้ตรวจ / เครื่อง)
// และไม่รับ realtime — ตั้งใจ เพราะข้อมูลที่กำลังอ่านอยู่ไม่ควรขยับใต้มือระหว่างตรวจสอบ
import React, { useCallback, useEffect, useState } from 'react';
import { Container, Row, Col, Card, Form, Button, Table, Badge, Alert, Spinner } from 'react-bootstrap';
import { apiCall, apiDownload } from '../utils/api';
import { normalizeRows, normalizeChart } from '../utils/normalize';
import { SHIFTS } from '../utils/config';
import ControlChart from './ControlChart';

const emptyFilter = () => ({ from: '', to: '', mo_no: '', shift: '', inspector_id: '', machine_id: '' });

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
  const [modelId, setModelId] = useState('');
  const [filter, setFilter] = useState(emptyFilter);
  const [applied, setApplied] = useState(emptyFilter);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    Promise.all([apiCall('/master/models?all=1'), apiCall('/master/lookups?all=1')])
      .then(([ms, lk]) => { setModels(normalizeRows(ms)); setLookups(lk); })
      .catch((e) => setError(e.message));
  }, []);

  const load = useCallback(async (id, f) => {
    if (!id) return setReport(null);
    setLoading(true);
    try {
      const data = await apiCall(`/reports/model/${id}${toQuery(f)}`);
      setReport({ ...data, charts: data.charts.map(normalizeChart) });
      setError(null);
    } catch (e) {
      setError(e.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const dateIncomplete = Boolean(filter.from) !== Boolean(filter.to);
  const s = report?.summary;

  return (
    <Container fluid className="mt-3 pb-5">
      <h4 className="mb-3">📊 รายงานผลตรวจรายรุ่น</h4>

      <Card className="mb-3 bg-light">
        <Card.Body className="pb-2">
          <Row className="g-2 align-items-end">
            <Col md={3}>
              <Form.Label className="small mb-1">รุ่น</Form.Label>
              <Form.Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                <option value="">-- เลือกรุ่น --</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.model_code} — {m.model_name}</option>)}
              </Form.Select>
            </Col>
            <Col md={2}>
              <Form.Label className="small mb-1">ตั้งแต่วันที่</Form.Label>
              <Form.Control type="date" {...field('from')} />
            </Col>
            <Col md={2}>
              <Form.Label className="small mb-1">ถึงวันที่</Form.Label>
              <Form.Control type="date" {...field('to')} />
            </Col>
            <Col md={2}>
              <Form.Label className="small mb-1">MO No.</Form.Label>
              <Form.Control {...field('mo_no')} placeholder="ทั้งหมด" />
            </Col>
            <Col md={1}>
              <Form.Label className="small mb-1">กะ</Form.Label>
              <Form.Select {...field('shift')}>
                <option value="">ทั้งหมด</option>
                {SHIFTS.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}
              </Form.Select>
            </Col>
            <Col md={2}>
              <Form.Label className="small mb-1">ผู้ตรวจ</Form.Label>
              <Form.Select {...field('inspector_id')}>
                <option value="">ทั้งหมด</option>
                {lookups.inspectors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Form.Select>
            </Col>
          </Row>
          <Row className="g-2 align-items-end mt-1">
            <Col md={3}>
              <Form.Label className="small mb-1">เครื่อง</Form.Label>
              <Form.Select {...field('machine_id')}>
                <option value="">ทั้งหมด</option>
                {lookups.machines.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
              </Form.Select>
            </Col>
            <Col md="auto">
              <Button onClick={() => setApplied(filter)} disabled={!modelId}>ค้นหา</Button>
              <Button variant="link" onClick={() => { setFilter(emptyFilter()); setApplied(emptyFilter()); }}>
                ล้างตัวกรอง
              </Button>
            </Col>
            <Col md="auto">
              <Button variant="success" onClick={handleExport} disabled={!modelId || !report || exporting}>
                {exporting ? <><Spinner size="sm" animation="border" className="me-1" />กำลังสร้าง</> : '⬇ Excel'}
              </Button>
            </Col>
            {dateIncomplete && (
              <Col>
                <div className="text-warning small">
                  กรอกวันที่ให้ครบทั้งสองช่อง ไม่งั้นระบบจะไม่กรองวันที่ให้
                </div>
              </Col>
            )}
          </Row>
        </Card.Body>
      </Card>

      {error && <Alert variant="danger">{error}</Alert>}
      {!modelId && <Alert variant="light" className="text-center text-muted">เลือกรุ่นเพื่อดูรายงาน</Alert>}
      {loading && <div className="text-center text-muted py-4">กำลังโหลด…</div>}

      {report && !loading && (
        <>
          <Row className="g-2 mb-3">
            {[
              { label: 'ใบตรวจทั้งหมด', value: s.totalInspections, variant: 'primary' },
              { label: 'ใบที่มี NG', value: s.ngInspections, variant: s.ngInspections > 0 ? 'danger' : 'success' },
              { label: '%NG (ระดับใบตรวจ)', value: pct(s.ngRate), variant: 'warning' },
              { label: 'จุดที่ out of control', value: s.outOfControlCheckpoints, variant: s.outOfControlCheckpoints > 0 ? 'danger' : 'success' },
            ].map((c) => (
              <Col md={3} key={c.label}>
                <Card className={`text-center border-${c.variant}`}>
                  <Card.Body className="py-2">
                    <div className={`fs-4 fw-bold text-${c.variant}`}>{c.value}</div>
                    <div className="small text-muted">{c.label}</div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>

          {/* สรุปรายจุด — ตัวเลขชุดเดียวกับที่กราฟข้างล่างใช้ (มาจาก analyze() ตัวเดียวกัน) */}
          <Card className="mb-3">
            <Card.Header className="py-2">สรุปรายจุดตรวจ</Card.Header>
            <Table striped bordered hover responsive size="sm" className="mb-0">
              <thead className="table-dark">
                <tr>
                  <th>ลำดับ</th><th>จุดตรวจ</th><th>ชนิด</th><th>LSL ~ USL</th><th>n</th>
                  <th>Cp</th><th>Cpk</th><th>Pp</th><th>Ppk</th><th>NG</th><th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {report.charts.map((c) => {
                  const cp = c.checkpoint;
                  const cap = c.capability ?? {};
                  const f = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');
                  return (
                    <tr key={cp.id}>
                      <td>{cp.seq_no}</td>
                      <td>{cp.is_critical && '🔴 '}{cp.name}</td>
                      <td className="small">{cp.char_type === 'attribute' ? 'ตรวจด้วยตา' : 'วัดค่า'}</td>
                      <td className="small">{cp.char_type === 'attribute' ? '—' : `${cp.lsl ?? '-'} ~ ${cp.usl ?? '-'}`}</td>
                      <td>{cp.char_type === 'attribute' ? '—' : cp.sample_size}</td>
                      <td>{f(cap.cp)}</td><td>{f(cap.cpk)}</td><td>{f(cap.pp)}</td><td>{f(cap.ppk)}</td>
                      <td>{c.ngCount ?? 0}{c.ngRate !== null && c.ngRate !== undefined && ` (${pct(c.ngRate)})`}</td>
                      <td>
                        {cp.char_type === 'attribute'
                          ? '—'
                          : (c.violations?.length ?? 0) > 0
                            ? <Badge bg="danger">out of control</Badge>
                            : <Badge bg="success">in control</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <Row>
            {report.charts.map((c) => (
              <Col xl={6} key={c.checkpoint.id}>
                <ControlChart chart={c} height={200} />
              </Col>
            ))}
          </Row>
        </>
      )}
    </Container>
  );
};

export default ReportPage;
