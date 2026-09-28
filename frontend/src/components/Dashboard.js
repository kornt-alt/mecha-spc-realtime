// frontend/src/components/Dashboard.js — จอ realtime ของไลน์ เลือกรุ่นแล้วเห็นทุกจุดตรวจ
//
// ค่าเริ่มต้นเป็น "ตารางสถานะ" (StatusBoard) 1 แถวต่อจุด จอหน้าไลน์เห็นครบทุกจุดในหน้าเดียว
// แล้วกดไปเจาะที่หน้า SC Chart · การ์ดกราฟเต็มแบบเดิมยังอยู่ที่ ?view=charts
//
// ต่างจากระบบเดิมตรง: เข้า room ของรุ่นที่ดูอยู่เท่านั้น พอมีใบตรวจใหม่เข้ามา server ส่ง
// แค่ "จุดไหนเปลี่ยนบ้าง" มาให้ แล้วหน้านี้โหลดใหม่เฉพาะกราฟที่กระทบ
// (ของเดิม broadcast ประวัติทั้งก้อนของทุก spec ให้ทุกเครื่องทุกครั้งที่มีคนบันทึก)
//
// รุ่นที่กำลังดูอยู่ใน URL (?model=12) ลิงก์จากหน้าอื่นจึงพารุ่นมาด้วยได้ และรีเฟรชแล้วไม่หลุด
// เครื่องที่กำลังดูอยู่ใน URL เหมือนกัน (?machine=3) — จอหน้าไลน์บุ๊กมาร์กเครื่องของตัวเองได้
//
// ⚠️ กราฟรวมทุกเครื่องเป็นค่าเริ่มต้น แต่หลายเครื่องผลิต item เดียวกัน = หลาย process ในกราฟเดียว
//    ค่ากลางที่ได้จึงไม่ใช่ของเครื่องไหนเลย ต้องเลือกเครื่องถึงจะอ่านกราฟเป็นรายเครื่องได้
//    **baseline แยกรายเครื่องแล้ว** (ตาราง checkpoint_baselines) เลือกเครื่องไหนก็ได้เส้นลิมิต
//    ของเครื่องนั้น · เครื่องที่ยังไม่ได้ล็อกจะได้เส้น provisional ที่คำนวณสดจากข้อมูลของตัวเอง
//    ไม่ยืมของชุดรวมมาใช้ (ดู pickBaseline ใน backend/services/baseline.js)
//
// ⚠️ ลำดับการ์ดเรียงตาม seq_no เสมอ ห้ามเรียงใหม่ตามสถานะ — socket ดันของใหม่เข้ามาได้ตลอด
//    ถ้าเรียงตามสถานะ การ์ดจะสลับที่ใต้เมาส์คนที่กำลังอ่านอยู่ จุดที่ผิดใช้เส้นเหลืองซ้ายชี้แทน
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Container, Row, Col, Card, Alert, Spinner, Button } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { on, joinModel, leaveModel } from '../utils/socket';
import { normalizeRows, normalizeChart } from '../utils/normalize';
import { useModelParam, useUrlParam } from '../utils/useModelParam';
import ControlChart from './ControlChart';
import SearchSelect from './SearchSelect';
import SpcReference from './SpcReference';
import StatusBoard, { statusOf } from './StatusBoard';

// ⚠️ ตัวกรองต้องมีทางกลับไป "ทุกเครื่อง" เป็นแถวจริงในลิสต์ ไม่ใช่แค่ placeholder
//    (placeholder เลือกกลับไม่ได้เมื่อเลือกอะไรไปแล้ว — กฎเดียวกับตัวกรองที่ ReportPage)
const ALL_MACHINES = { value: '', label: 'ทุกเครื่อง' };

// event ที่เข้ามากระทบสิ่งที่จอนี้แสดงอยู่ไหม
//
// ⚠️ กำลังดูเครื่องเดียวอยู่ ใบตรวจ/baseline ของเครื่องอื่นต้องไม่ทำให้โหลดกราฟใหม่
//    (โหลดไปก็ได้ภาพเดิม) และต้องไม่ขึ้นแถบ "ใบตรวจล่าสุด" ด้วย — จอที่บอกว่ากรอง MC-01
//    แต่แจ้ง MC-02 คือจอที่โกหก
// ⚠️ `machineId` เป็น null/undefined แปลว่า "กระทบทุกเครื่อง" (ล้างใบที่ยกเลิก หรือ payload
//    จาก backend รุ่นเก่าที่ยังไม่ส่ง field นี้) ต้องโหลดเสมอ ห้ามตีความว่า "ไม่ตรง"
// ⚠️ อยู่นอก component โดยตั้งใจ — ถ้าประกาศไว้ข้างในจะกลายเป็น dependency ใหม่ของ
//    useEffect ทั้งสองตัว แล้ว react-hooks/exhaustive-deps เตือน ซึ่ง CRA แปลงเป็น error
//    ตอน build บนเซิร์ฟเวอร์ (CI=true) ทั้งที่ jest ไม่รัน eslint เลยไม่มีอะไรจับได้ก่อน
const affectsView = (payload, viewing) => {
  if (!viewing) return true;
  if (payload.machineId === null || payload.machineId === undefined) return true;
  return String(payload.machineId) === String(viewing);
};

const Dashboard = () => {
  const [models, setModels] = useState([]);
  const [machines, setMachines] = useState([]);
  const [modelId, setModelId] = useModelParam();
  const [machineId, setMachineId] = useUrlParam('machine');
  // มุมมองอยู่ใน URL — จอหน้าไลน์บุ๊กมาร์กแบบที่ต้องการได้ (ค่าว่าง = ตารางสถานะ)
  const [view, setView] = useUrlParam('view');
  const showCharts = view === 'charts';
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [alerts, setAlerts] = useState([]);

  // เก็บรุ่นปัจจุบันไว้ใน ref ด้วย เพราะ handler ของ socket ถูกผูกครั้งเดียว
  // ถ้าอ่านจาก state ตรง ๆ มันจะค้างอยู่ที่ค่าตอนผูก (stale closure)
  const modelIdRef = useRef('');
  modelIdRef.current = modelId;
  const machineIdRef = useRef('');
  machineIdRef.current = machineId;

  // ⚠️ ดึงด้วย ?all=1 โดยตั้งใจ — ลิงก์จากหน้ารายงานพา ?model= ของรุ่นที่ถูกปิดใช้งานมาได้
  //    ถ้าดึงเฉพาะรุ่นที่ active ช่องเลือกจะว่างทั้งที่กราฟโหลดขึ้น อธิบายตัวเองไม่ได้เลย
  useEffect(() => {
    Promise.all([apiCall('/master/models?all=1'), apiCall('/master/lookups?all=1')])
      .then(([ms, lk]) => {
        setModels(normalizeRows(ms));
        setMachines(normalizeRows(lk?.machines ?? []));
      })
      .catch((e) => setError(e.message));
  }, []);

  // ในลิสต์แสดงเฉพาะรุ่นที่ยังใช้งาน บวกรุ่นที่กำลังดูอยู่ (เผื่อมันถูกปิดไปแล้ว)
  const visibleModels = useMemo(
    () => models.filter((m) => m.is_active || String(m.id) === String(modelId)),
    [models, modelId]
  );

  const selectedModel = useMemo(
    () => models.find((m) => String(m.id) === String(modelId)) ?? null,
    [models, modelId]
  );

  // เครื่องที่ลิสต์ได้ = เครื่องใน division ของ item ที่เลือกเท่านั้น
  // (machines ผูกกับ division ส่วน models ก็ผูกกับ division — ข้ามสายกันไม่ได้)
  // บวกเครื่องที่กำลังเลือกอยู่เสมอ เผื่อมันถูกปิดใช้งานทีหลัง ไม่งั้นช่องจะว่างทั้งที่กราฟกรองอยู่
  const visibleMachines = useMemo(
    () => machines.filter((mc) => (
      String(mc.id) === String(machineId)
      || (mc.is_active && (!selectedModel || mc.division_id === selectedModel.division_id))
    )),
    [machines, machineId, selectedModel]
  );

  // ⚠️ เปลี่ยน item ข้าม division แล้วเครื่องที่จำไว้ใน URL ใช้ไม่ได้อีก ต้องล้าง
  //    ไม่งั้นกราฟจะว่างเปล่าโดยไม่บอกว่าทำไม (กับดักตัวเดียวกับ reconcile() ของ station)
  //    เช็คหลัง machines โหลดเสร็จเท่านั้น ไม่งั้นล้างทิ้งตั้งแต่ยังไม่รู้ว่ามีเครื่องอะไรบ้าง
  useEffect(() => {
    if (!machineId || machines.length === 0 || !selectedModel) return;
    const picked = machines.find((mc) => String(mc.id) === String(machineId));
    if (!picked || picked.division_id !== selectedModel.division_id) setMachineId('');
  }, [machineId, machines, selectedModel, setMachineId]);

  const machineName = useMemo(() => {
    const mc = machines.find((m) => String(m.id) === String(machineId));
    return mc ? `${mc.code} — ${mc.name}` : '';
  }, [machines, machineId]);

  // ⚠️ ค่าว่างคือ "ไม่กรอง" ไม่ใช่ "กรองด้วยค่าว่าง" — ส่ง machine_id= เปล่า ๆ ไปเมื่อไหร่
  //    backend อ่านเป็น falsy แล้วไม่กรองให้อยู่ดี แต่ URL จะโกหกว่ากรองอยู่ (กฎเดียวกับ ReportPage)
  const machineQuery = (machine) => (machine ? `?machine_id=${encodeURIComponent(machine)}` : '');

  // โหลดกราฟทุกจุดของรุ่น — ใช้ /reports/model/:id เพราะดึงค่าวัดทีเดียวแล้วแยกให้
  const loadAll = useCallback(async (id, machine) => {
    if (!id) return setCharts([]);
    setLoading(true);
    try {
      const data = await apiCall(`/reports/model/${id}${machineQuery(machine)}`);
      setCharts(data.charts.map(normalizeChart));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // โหลดใหม่เฉพาะจุดที่เพิ่งมีข้อมูลเข้า ไม่ใช่ทั้งรุ่น
  // ⚠️ ต้องแนบตัวกรองเครื่องไปด้วย ไม่งั้นกราฟที่โหลดซ้ำจะกลายเป็นกราฟรวมทุกเครื่องทีละใบ
  //    จนหน้าจอมีทั้งกราฟที่กรองและไม่กรองปนกันโดยไม่มีอะไรบอก — อ่านจาก ref เพราะ handler
  //    ของ socket ถูกผูกครั้งเดียว ค่าใน closure จะค้างอยู่ที่ตอนผูก
  const reloadCheckpoints = useCallback(async (ids) => {
    const q = machineQuery(machineIdRef.current);
    const fresh = await Promise.all(
      ids.map((id) => apiCall(`/charts/${id}${q}`).then(normalizeChart).catch(() => null))
    );
    setCharts((prev) =>
      prev.map((c) => fresh.find((f) => f?.checkpoint?.id === c.checkpoint?.id) ?? c)
    );
  }, []);

  useEffect(() => { loadAll(modelId, machineId); }, [modelId, machineId, loadAll]);

  // เข้า/ออก room ตามรุ่นที่ดูอยู่
  useEffect(() => {
    if (!modelId) return undefined;
    joinModel(modelId);
    return () => leaveModel(modelId);
  }, [modelId]);

  useEffect(() => on('inspection_saved', (payload) => {
    if (String(payload.modelId) !== String(modelIdRef.current)) return;
    if (!affectsView(payload, machineIdRef.current)) return;

    reloadCheckpoints(payload.checkpointIds);
    setAlerts((prev) => [{
      id: payload.inspectionId,
      at: new Date(),
      moNo: payload.moNo,
      machineId: payload.machineId ?? null,
      subgroupNo: payload.subgroupNo,
      result: payload.overallResult,
      ngCount: payload.ngCheckpointIds?.length ?? 0,
    }, ...prev].slice(0, 5));
  }), [reloadCheckpoints]);

  // ล็อก baseline ที่จออื่น → เส้นลิมิตเปลี่ยน ต้องโหลดกราฟนั้นใหม่
  // ⚠️ baseline แยกรายเครื่องแล้ว ล็อกของ MC-02 ไม่กระทบจอที่กำลังดู MC-01 อยู่
  //    (machineId = 0 คือชุดรวม กระทบเฉพาะจอที่ดู "ทุกเครื่อง" — affectsView จัดการให้แล้ว
  //     เพราะ viewing เป็นค่าว่างจะคืน true เสมอ ส่วน 0 ไม่ตรงกับ id เครื่องไหน)
  useEffect(() => on('baseline_updated', (payload) => {
    if (String(payload.modelId) !== String(modelIdRef.current)) return;
    if (!affectsView(payload, machineIdRef.current)) return;
    reloadCheckpoints([payload.checkpointId]);
  }), [reloadCheckpoints]);

  useEffect(
    () => on('master_updated', () => loadAll(modelIdRef.current, machineIdRef.current)),
    [loadAll]
  );

  // ชื่อเครื่องของแถบ "ใบตรวจล่าสุด" — map ตอน render ไม่ใช่ตอนรับ event
  // (handler ผูกครั้งเดียว ลิสต์เครื่องใน closure จะค้างเป็นลิสต์ว่างตอน mount)
  const machineLabel = useCallback((id) => {
    const mc = machines.find((m) => String(m.id) === String(id));
    return mc ? mc.code : null;
  }, [machines]);

  // ลูกค้าของ item — สี Cp/Cpk บนกราฟเทียบกับเกณฑ์ของลูกค้ารายนี้ คนดูจอต้องรู้ว่าเกณฑ์ของใคร
  const customerName = models.find((m) => String(m.id) === String(modelId))?.customer_name ?? null;

  // ตัวนับหัวจอใช้ statusOf ตัวเดียวกับแถวในตาราง — สองที่ต้องไม่นับไม่ตรงกัน
  const counts = useMemo(() => {
    const out = { ng: 0, ocs: 0, watch: 0 };
    for (const c of charts) {
      const k = statusOf(c).key;
      if (k in out) out[k] += 1;
    }
    return out;
  }, [charts]);
  const needsLook = counts.ng + counts.ocs + counts.watch;

  return (
    <Container fluid className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        {modelId && !loading && (
          <div className="page-head__meta num">
            {charts.length} จุดตรวจสอบ
            {needsLook > 0
              ? ` · NG ${counts.ng} · OCS ${counts.ocs} · ต้องดู ${counts.watch}`
              : ' · ทุกจุดปกติ'}
            {` · ${machineId ? machineName : 'รวมทุกเครื่อง'}`}
            {customerName && ` · ลูกค้า ${customerName}`}
          </div>
        )}
      </div>

      <Row className="align-items-center mb-3 g-2">
        <Col md={5} lg={4}>
          <SearchSelect
            id="dashboard-model"
            aria-label="รุ่นที่จะแสดง"
            value={modelId}
            onChange={setModelId}
            placeholder="— เลือกรุ่นที่จะแสดง —"
            emptyText="ไม่พบ item ที่ค้นหา"
            options={visibleModels.map((m) => ({
              value: String(m.id),
              label: `${m.item_no} — ${m.item_name}${m.is_active ? '' : ' (ปิดใช้งาน)'}`,
              hint: m.division_name ?? '',
            }))}
          />
        </Col>

        <Col md={4} lg={3}>
          <SearchSelect
            id="dashboard-machine"
            aria-label="เครื่องที่จะแสดง"
            value={machineId}
            onChange={setMachineId}
            disabled={!modelId}
            placeholder="— ทุกเครื่อง —"
            emptyText="ไม่พบเครื่องที่ค้นหา"
            options={[
              ALL_MACHINES,
              ...visibleMachines.map((mc) => ({
                value: String(mc.id),
                label: `${mc.code} — ${mc.name}`,
                hint: mc.is_active ? '' : 'ปิดใช้งาน',
              })),
            ]}
          />
        </Col>

        <Col md="auto" className="ms-md-auto">
          <div className="btn-group" role="group" aria-label="มุมมอง">
            <Button size="sm" variant={showCharts ? 'outline-primary' : 'primary'}
              aria-pressed={!showCharts} onClick={() => setView('')}>ตารางสถานะ</Button>
            <Button size="sm" variant={showCharts ? 'primary' : 'outline-primary'}
              aria-pressed={showCharts} onClick={() => setView('charts')}>กราฟเต็ม</Button>
          </div>
        </Col>
      </Row>

      {/* แผงสูตร/กฎ อยู่กับกราฟเต็ม — ตารางสถานะตั้งใจให้กระชับพอดีจอ */}
      {showCharts && <SpcReference />}

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
                {machineLabel(a.machineId) && (
                  <span className="num">เครื่อง {machineLabel(a.machineId)}</span>
                )}
                <span className="num">subgroup #{a.subgroupNo}</span>
                {a.ngCount > 0 && <span className="text-danger">({a.ngCount} จุดไม่ผ่าน)</span>}
              </div>
            ))}
          </Card.Body>
        </Card>
      )}

      {/* ขอบเขตของสิ่งที่เห็นอยู่ — ต้องอ่านออกโดยไม่ต้องเลื่อนไปดูช่องเลือกด้านบน
          จอหน้าไลน์เปิดค้างทั้งกะ คนที่เดินมาดูไม่ได้เป็นคนเลือกเครื่องเอง */}
      {modelId && machineId && charts.length > 0 && (
        <div className="scope-note">
          กำลังดูเฉพาะเครื่อง <b>{machineName}</b> — ทั้งจุดบนกราฟและเส้น control limit
          เป็นของเครื่องนี้เครื่องเดียว · จุดที่ยังไม่ได้ล็อก baseline ของเครื่องนี้จะขึ้น
          provisional แยกเป็นราย<wbr />จุดตรวจ
        </div>
      )}

      {!modelId && <div className="empty">เลือกรุ่นเพื่อดูกราฟ</div>}
      {modelId && loading && (
        <div className="empty"><Spinner animation="border" size="sm" className="me-2" />กำลังโหลดกราฟ</div>
      )}
      {/* ⚠️ เส้นนี้คือ "ไม่มีจุดตรวจ" ไม่ใช่ "ไม่มีข้อมูล" — /reports/model/:id คืนการ์ดครบทุก
          จุดตรวจเสมอ ต่อให้กรองเครื่องแล้วไม่เหลือค่าวัดสักตัว (การ์ดนั้นจะบอกเองว่าไม่มีข้อมูล)
          เติมคำว่าเครื่องตรงนี้เมื่อไหร่คือบอกสาเหตุผิด */}
      {modelId && !loading && charts.length === 0 && !error && (
        <div className="empty">model นี้ยังไม่มีจุดตรวจสอบ หรือยังไม่มีใบตรวจสอบในระบบ</div>
      )}

      {charts.length > 0 && !showCharts && <StatusBoard charts={charts} machineId={machineId} />}

      {showCharts && (
        <Row>
          {charts.map((c) => (
            <Col xl={6} key={c.checkpoint.id}>
              <ControlChart chart={c} machineId={machineId} />
            </Col>
          ))}
        </Row>
      )}
    </Container>
  );
};

export default Dashboard;
