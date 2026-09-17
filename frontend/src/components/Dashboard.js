// frontend/src/components/Dashboard.js — จอ realtime ของไลน์ เลือกรุ่นแล้วเห็นทุกจุดตรวจ
//
// ต่างจากระบบเดิมตรง: เข้า room ของรุ่นที่ดูอยู่เท่านั้น พอมีใบตรวจใหม่เข้ามา server ส่ง
// แค่ "จุดไหนเปลี่ยนบ้าง" มาให้ แล้วหน้านี้โหลดใหม่เฉพาะกราฟที่กระทบ
// (ของเดิม broadcast ประวัติทั้งก้อนของทุก spec ให้ทุกเครื่องทุกครั้งที่มีคนบันทึก)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Container, Row, Col, Form, Card, Badge, Alert } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { on, joinModel, leaveModel } from '../utils/socket';
import { normalizeRows, normalizeChart } from '../utils/normalize';
import ControlChart from './ControlChart';

const Dashboard = () => {
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState('');
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [alerts, setAlerts] = useState([]);

  // เก็บรุ่นปัจจุบันไว้ใน ref ด้วย เพราะ handler ของ socket ถูกผูกครั้งเดียว
  // ถ้าอ่านจาก state ตรง ๆ มันจะค้างอยู่ที่ค่าตอนผูก (stale closure)
  const modelIdRef = useRef('');
  modelIdRef.current = modelId;

  useEffect(() => {
    apiCall('/master/models')
      .then((ms) => setModels(normalizeRows(ms)))
      .catch((e) => setError(e.message));
  }, []);

  // โหลดกราฟทุกจุดของรุ่น — ใช้ /reports/model/:id เพราะดึงค่าวัดทีเดียวแล้วแยกให้
  const loadAll = useCallback(async (id) => {
    if (!id) return setCharts([]);
    setLoading(true);
    try {
      const data = await apiCall(`/reports/model/${id}`);
      setCharts(data.charts.map(normalizeChart));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // โหลดใหม่เฉพาะจุดที่เพิ่งมีข้อมูลเข้า ไม่ใช่ทั้งรุ่น
  const reloadCheckpoints = useCallback(async (ids) => {
    const fresh = await Promise.all(
      ids.map((id) => apiCall(`/charts/${id}`).then(normalizeChart).catch(() => null))
    );
    setCharts((prev) =>
      prev.map((c) => fresh.find((f) => f?.checkpoint?.id === c.checkpoint?.id) ?? c)
    );
  }, []);

  useEffect(() => { loadAll(modelId); }, [modelId, loadAll]);

  // เข้า/ออก room ตามรุ่นที่ดูอยู่
  useEffect(() => {
    if (!modelId) return undefined;
    joinModel(modelId);
    return () => leaveModel(modelId);
  }, [modelId]);

  useEffect(() => on('inspection_saved', (payload) => {
    if (String(payload.modelId) !== String(modelIdRef.current)) return;

    reloadCheckpoints(payload.checkpointIds);
    setAlerts((prev) => [{
      id: payload.inspectionId,
      at: new Date(),
      moNo: payload.moNo,
      subgroupNo: payload.subgroupNo,
      result: payload.overallResult,
      ngCount: payload.ngCheckpointIds?.length ?? 0,
    }, ...prev].slice(0, 5));
  }), [reloadCheckpoints]);

  // ล็อก baseline ที่เครื่องอื่น → เส้นลิมิตเปลี่ยน ต้องโหลดกราฟนั้นใหม่
  useEffect(() => on('baseline_updated', (payload) => {
    if (String(payload.modelId) !== String(modelIdRef.current)) return;
    reloadCheckpoints([payload.checkpointId]);
  }), [reloadCheckpoints]);

  useEffect(() => on('master_updated', () => loadAll(modelIdRef.current)), [loadAll]);

  const outOfControl = charts.filter((c) => (c.violations?.length ?? 0) > 0);

  return (
    <Container fluid className="mt-3 pb-5">
      <Row className="align-items-center mb-3 g-2">
        <Col md={4}>
          <Form.Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">-- เลือกรุ่นที่จะแสดง --</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.model_code} — {m.model_name}</option>
            ))}
          </Form.Select>
        </Col>
        <Col>
          {modelId && !loading && (
            <>
              <Badge bg="secondary" className="me-2">{charts.length} จุดตรวจ</Badge>
              {outOfControl.length > 0
                ? <Badge bg="danger">{outOfControl.length} จุด out of control</Badge>
                : <Badge bg="success">ทุกจุด in control</Badge>}
            </>
          )}
        </Col>
      </Row>

      {error && <Alert variant="danger">{error}</Alert>}

      {/* ใบตรวจที่เพิ่งเข้ามาสด ๆ — หน้างานต้องเห็นทันทีว่ามี NG */}
      {alerts.length > 0 && (
        <Card className="mb-3">
          <Card.Header className="py-1 small">ใบตรวจล่าสุดที่เข้ามา</Card.Header>
          <Card.Body className="py-2">
            {alerts.map((a) => (
              <div key={a.id} className="small">
                <Badge bg={a.result === 'NG' ? 'danger' : 'success'} className="me-2">{a.result}</Badge>
                {a.at.toLocaleTimeString('th-TH')} · MO {a.moNo} · subgroup #{a.subgroupNo}
                {a.ngCount > 0 && <span className="text-danger ms-2">({a.ngCount} จุดไม่ผ่าน)</span>}
              </div>
            ))}
          </Card.Body>
        </Card>
      )}

      {!modelId && <Alert variant="light" className="text-center text-muted">เลือกรุ่นเพื่อดูกราฟ</Alert>}
      {modelId && loading && <div className="text-center text-muted py-4">กำลังโหลด…</div>}

      <Row>
        {charts.map((c) => (
          <Col xl={6} key={c.checkpoint.id}>
            <ControlChart chart={c} />
          </Col>
        ))}
      </Row>
    </Container>
  );
};

export default Dashboard;
