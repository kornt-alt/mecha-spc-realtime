// frontend/src/components/Dashboard.js — จอ realtime ของไลน์ เลือกรุ่นแล้วเห็นทุกจุดตรวจ
//
// ต่างจากระบบเดิมตรง: เข้า room ของรุ่นที่ดูอยู่เท่านั้น พอมีใบตรวจใหม่เข้ามา server ส่ง
// แค่ "จุดไหนเปลี่ยนบ้าง" มาให้ แล้วหน้านี้โหลดใหม่เฉพาะกราฟที่กระทบ
// (ของเดิม broadcast ประวัติทั้งก้อนของทุก spec ให้ทุกเครื่องทุกครั้งที่มีคนบันทึก)
//
// รุ่นที่กำลังดูอยู่ใน URL (?model=12) ลิงก์จากหน้าอื่นจึงพารุ่นมาด้วยได้ และรีเฟรชแล้วไม่หลุด
//
// ⚠️ ลำดับการ์ดเรียงตาม seq_no เสมอ ห้ามเรียงใหม่ตามสถานะ — socket ดันของใหม่เข้ามาได้ตลอด
//    ถ้าเรียงตามสถานะ การ์ดจะสลับที่ใต้เมาส์คนที่กำลังอ่านอยู่ จุดที่ผิดใช้เส้นเหลืองซ้ายชี้แทน
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Container, Row, Col, Form, Card, Alert, Spinner } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { on, joinModel, leaveModel } from '../utils/socket';
import { normalizeRows, normalizeChart } from '../utils/normalize';
import { useModelParam } from '../utils/useModelParam';
import ControlChart from './ControlChart';

const Dashboard = () => {
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useModelParam();
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [alerts, setAlerts] = useState([]);

  // เก็บรุ่นปัจจุบันไว้ใน ref ด้วย เพราะ handler ของ socket ถูกผูกครั้งเดียว
  // ถ้าอ่านจาก state ตรง ๆ มันจะค้างอยู่ที่ค่าตอนผูก (stale closure)
  const modelIdRef = useRef('');
  modelIdRef.current = modelId;

  // ⚠️ ดึงด้วย ?all=1 โดยตั้งใจ — ลิงก์จากหน้ารายงานพา ?model= ของรุ่นที่ถูกปิดใช้งานมาได้
  //    ถ้าดึงเฉพาะรุ่นที่ active ช่องเลือกจะว่างทั้งที่กราฟโหลดขึ้น อธิบายตัวเองไม่ได้เลย
  useEffect(() => {
    apiCall('/master/models?all=1')
      .then((ms) => setModels(normalizeRows(ms)))
      .catch((e) => setError(e.message));
  }, []);

  // ในลิสต์แสดงเฉพาะรุ่นที่ยังใช้งาน บวกรุ่นที่กำลังดูอยู่ (เผื่อมันถูกปิดไปแล้ว)
  const visibleModels = useMemo(
    () => models.filter((m) => m.is_active || String(m.id) === String(modelId)),
    [models, modelId]
  );

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
    <Container fluid className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        {modelId && !loading && (
          <div className="page-head__meta num">
            {charts.length} จุดตรวจสอบ
            {outOfControl.length > 0
              ? ` · ต้องดูก่อน ${outOfControl.length} จุด`
              : ' · ทุกจุด in control'}
          </div>
        )}
      </div>

      <Row className="align-items-center mb-3 g-2">
        <Col md={5} lg={4}>
          <Form.Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">— เลือกรุ่นที่จะแสดง —</option>
            {visibleModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.item_no} — {m.item_name} ({m.division_name}){m.is_active ? '' : ' (ปิดใช้งาน)'}
              </option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      {error && <Alert variant="danger">{error}</Alert>}

      {/* ใบตรวจที่เพิ่งเข้ามาสด ๆ — หน้างานต้องเห็นทันทีว่ามี NG */}
      {alerts.length > 0 && (
        <Card className="mb-3">
          <Card.Header className="py-1 small">ใบตรวจล่าสุดที่เข้ามา</Card.Header>
          <Card.Body className="py-2">
            {alerts.map((a) => (
              <div key={a.id} className="small d-flex align-items-center gap-2">
                <span className={`verdict ${a.result === 'NG' ? 'verdict--ng' : 'verdict--ok'}`}>
                  {a.result}
                </span>
                <span className="num">{a.at.toLocaleTimeString('th-TH')}</span>
                <span>MO {a.moNo}</span>
                <span className="num">subgroup #{a.subgroupNo}</span>
                {a.ngCount > 0 && <span className="text-danger">({a.ngCount} จุดไม่ผ่าน)</span>}
              </div>
            ))}
          </Card.Body>
        </Card>
      )}

      {!modelId && <div className="empty">เลือกรุ่นเพื่อดูกราฟ</div>}
      {modelId && loading && (
        <div className="empty"><Spinner animation="border" size="sm" className="me-2" />กำลังโหลดกราฟ</div>
      )}
      {modelId && !loading && charts.length === 0 && !error && (
        <div className="empty">model นี้ยังไม่มีจุดตรวจสอบ หรือยังไม่มีใบตรวจสอบในระบบ</div>
      )}

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
