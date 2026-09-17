// frontend/src/components/MasterSetup.js — ตั้งค่า master ทั้งหมด
//
// ของเดิมมีปุ่มแก้/ลบให้เฉพาะ spec ส่วน division/machine/part เพิ่มได้อย่างเดียว
// (จะแก้ต้องเข้าไปทำที่ DB ตรง ๆ) รอบนี้ทำให้ครบทุกชั้น + จัดลำดับจุดตรวจ + baseline
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Container, Row, Col, Card, Form, Button, Table, Badge, Alert, Nav, Modal } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { on } from '../utils/socket';
import { normalizeRows, normalizeCheckpoints, numOrNull, toNum } from '../utils/normalize';

const CHAR_TYPES = [
  { value: 'variable', label: 'วัดค่า (variable)' },
  { value: 'attribute', label: 'ตรวจด้วยตา (attribute)' },
];

const blankCheckpoint = () => ({
  name: '', char_type: 'variable', unit: '', gauge: '',
  usl: '', lsl: '', target: '', sample_size: 1, is_critical: false, is_active: true,
});

const MasterSetup = () => {
  const [tab, setTab] = useState('models');
  const [lookups, setLookups] = useState({ divisions: [], machines: [], inspectors: [] });
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [checkpoints, setCheckpoints] = useState([]);
  const [msg, setMsg] = useState(null);
  const [baselineInfo, setBaselineInfo] = useState(null);

  // setMsg เป็น setter ที่ React การันตีว่าคงที่ ห่อ useMemo ไว้ให้ say/fail คงที่ตาม
  // ไม่งั้น useCallback ที่เรียกใช้จะถูกสร้างใหม่ทุก render แล้ว useEffect วิ่งรัว
  const { say, fail } = useMemo(() => {
    const s = (variant, text) => setMsg({ variant, text });
    return { say: s, fail: (e) => s('danger', e.message) };
  }, []);

  // ── โหลด ──────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [lk, ms] = await Promise.all([
        apiCall('/master/lookups?all=1'),
        apiCall('/master/models?all=1'),
      ]);
      setLookups(lk);
      setModels(normalizeRows(ms));
    } catch (e) { fail(e); }
  }, [fail]);

  const loadCheckpoints = useCallback(async (modelId) => {
    if (!modelId) return setCheckpoints([]);
    try {
      const { checkpoints: cps } = await apiCall(`/master/models/${modelId}?all=1`);
      setCheckpoints(normalizeCheckpoints(cps));
    } catch (e) { fail(e); }
  }, [fail]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => on('master_updated', loadAll), [loadAll]);
  useEffect(() => { loadCheckpoints(selectedModel); }, [selectedModel, loadCheckpoints]);

  // ── CRUD กลาง ─────────────────────────────────────────────────────────
  const save = async (table, data, id) => {
    try {
      const res = id
        ? await apiCall('/master/update', { method: 'PUT', body: { table, id, data } })
        : await apiCall('/master/add', { method: 'POST', body: { table, data } });

      say('success', id ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว');
      if (res.baselineMayBeStale) {
        say('warning', 'แก้ sample_size แล้ว — baseline เดิมของจุดนี้ใช้ไม่ได้ ต้องกด Re-baseline ใหม่');
      }
      await loadAll();
      if (table === 'checkpoints') await loadCheckpoints(selectedModel);
      return true;
    } catch (e) { fail(e); return false; }
  };

  const remove = async (table, id, label) => {
    if (!window.confirm(`ลบ "${label}" ?\n\nถ้ามีใบตรวจอ้างอิงอยู่ ระบบจะไม่ยอมลบ — ให้ปิดใช้งานแทน`)) return;
    try {
      await apiCall('/master/delete', { method: 'DELETE', body: { table, id } });
      say('success', 'ลบแล้ว');
      await loadAll();
      if (table === 'checkpoints') await loadCheckpoints(selectedModel);
    } catch (e) { fail(e); }
  };

  const moveCheckpoint = async (id, direction) => {
    try {
      await apiCall(`/master/checkpoints/${id}/move`, { method: 'PUT', body: { direction } });
      await loadCheckpoints(selectedModel);
    } catch (e) { fail(e); }
  };

  // ── baseline ──────────────────────────────────────────────────────────
  const previewBaseline = async (cp) => {
    try {
      setBaselineInfo({ checkpoint: cp, ...(await apiCall(`/charts/${cp.id}/baseline/preview`)) });
    } catch (e) { fail(e); }
  };

  const confirmBaseline = async () => {
    try {
      await apiCall(`/charts/${baselineInfo.checkpoint.id}/baseline`, { method: 'POST', body: {} });
      setBaselineInfo(null);
      say('success', 'ล็อก control limit แล้ว');
      await loadCheckpoints(selectedModel);
    } catch (e) { fail(e); }
  };

  const clearBaseline = async (cp) => {
    if (!window.confirm(`ล้าง baseline ของ "${cp.name}" ?\n\nกราฟจะกลับไปคำนวณลิมิตสด (provisional)`)) return;
    try {
      await apiCall(`/charts/${cp.id}/baseline`, { method: 'DELETE' });
      say('success', 'ล้าง baseline แล้ว');
      await loadCheckpoints(selectedModel);
    } catch (e) { fail(e); }
  };

  return (
    <Container fluid className="mt-3 pb-5">
      <h4 className="mb-3">⚙️ ตั้งค่า Master</h4>
      {msg && <Alert variant={msg.variant} dismissible onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <Nav variant="tabs" activeKey={tab} onSelect={setTab} className="mb-3">
        <Nav.Item><Nav.Link eventKey="models">รุ่น &amp; จุดตรวจ</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="divisions">Division</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="machines">เครื่อง</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="inspectors">ผู้ตรวจ</Nav.Link></Nav.Item>
      </Nav>

      {tab === 'models' && (
        <ModelsTab
          models={models} divisions={lookups.divisions}
          selectedModel={selectedModel} setSelectedModel={setSelectedModel}
          checkpoints={checkpoints}
          onSave={save} onRemove={remove} onMove={moveCheckpoint}
          onPreviewBaseline={previewBaseline} onClearBaseline={clearBaseline}
        />
      )}
      {tab === 'divisions' && (
        <SimpleTab
          title="Division" table="divisions" rows={lookups.divisions}
          columns={[{ key: 'name', label: 'ชื่อ', required: true }]}
          onSave={save} onRemove={remove} labelOf={(r) => r.name}
        />
      )}
      {tab === 'machines' && (
        <SimpleTab
          title="เครื่อง" table="machines" rows={lookups.machines}
          columns={[
            { key: 'code', label: 'รหัส', required: true },
            { key: 'name', label: 'ชื่อ', required: true },
            { key: 'division_id', label: 'Division', type: 'select', options: lookups.divisions, required: true },
            { key: 'is_active', label: 'ใช้งาน', type: 'check' },
          ]}
          onSave={save} onRemove={remove} labelOf={(r) => `${r.code} — ${r.name}`}
        />
      )}
      {tab === 'inspectors' && (
        <SimpleTab
          title="ผู้ตรวจ" table="inspectors" rows={lookups.inspectors}
          columns={[
            { key: 'emp_code', label: 'รหัสพนักงาน', required: true },
            { key: 'name', label: 'ชื่อ', required: true },
            { key: 'division_id', label: 'Division', type: 'select', options: lookups.divisions },
            { key: 'is_active', label: 'ใช้งาน', type: 'check' },
          ]}
          onSave={save} onRemove={remove} labelOf={(r) => r.name}
        />
      )}

      <BaselineModal info={baselineInfo} onClose={() => setBaselineInfo(null)} onConfirm={confirmBaseline} />
    </Container>
  );
};

// ── แท็บ master ธรรมดา (division / เครื่อง / ผู้ตรวจ) ───────────────────────
//
// ตารางเดียวใช้ได้ทั้งสามชั้น เพราะ backend เป็น generic CRUD อยู่แล้ว
// ⚠️ key ของ columns ต้องตรงชื่อคอลัมน์ใน DB เป๊ะ — ไม่อยู่ใน ALLOWED_COLUMNS จะถูกตอบ 400
const SimpleTab = ({ title, table, rows, columns, onSave, onRemove, labelOf }) => {
  const blank = () => Object.fromEntries(columns.map((c) => [c.key, c.type === 'check' ? true : '']));
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);

  const reset = () => { setForm(blank()); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    for (const c of columns) {
      if (c.required && form[c.key] === '') return window.alert(`กรอก "${c.label}" ก่อน`);
    }
    const data = Object.fromEntries(columns.map((c) => [
      c.key,
      c.type === 'check' ? (form[c.key] ? 1 : 0) : c.type === 'select' ? (form[c.key] || null) : form[c.key],
    ]));
    if (await onSave(table, data, editingId)) reset();
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    // ⚠️ ค่า null ต้องกลายเป็น '' ไม่งั้น <Form.Control> เปลี่ยนเป็น uncontrolled กลางคัน
    setForm(Object.fromEntries(columns.map((c) => [
      c.key, c.type === 'check' ? Boolean(Number(row[c.key])) : row[c.key] ?? '',
    ])));
  };

  return (
    <Card>
      <Card.Body>
        <Form onSubmit={submit}>
          <Row className="g-2 align-items-end mb-3">
            {columns.map((c) => (
              <Col md={c.type === 'check' ? 1 : 3} key={c.key}>
                <Form.Label className="small mb-1">{c.label}</Form.Label>
                {c.type === 'check' ? (
                  <Form.Check
                    checked={Boolean(form[c.key])}
                    onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.checked }))}
                  />
                ) : c.type === 'select' ? (
                  <Form.Select
                    value={form[c.key] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                  >
                    <option value="">--</option>
                    {(c.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Form.Select>
                ) : (
                  <Form.Control
                    value={form[c.key] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                  />
                )}
              </Col>
            ))}
            <Col md="auto">
              <Button type="submit" variant={editingId ? 'warning' : 'success'}>
                {editingId ? 'บันทึกการแก้ไข' : `เพิ่ม${title}`}
              </Button>
              {editingId && <Button variant="link" onClick={reset}>ยกเลิก</Button>}
            </Col>
          </Row>
        </Form>

        <Table striped bordered hover responsive size="sm" className="mb-0">
          <thead className="table-dark">
            <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}<th style={{ width: 130 }}>จัดการ</th></tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={columns.length + 1} className="text-center text-muted">ยังไม่มีข้อมูล</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className={Number(r.is_active) === 0 ? 'text-muted' : ''}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.type === 'check'
                        ? (Number(r[c.key]) ? '✓' : '—')
                        : c.type === 'select'
                          ? (c.options ?? []).find((o) => String(o.id) === String(r[c.key]))?.name ?? '—'
                          : r[c.key] ?? '—'}
                    </td>
                  ))}
                  <td>
                    <Button size="sm" variant="primary" className="me-1" onClick={() => startEdit(r)}>แก้</Button>
                    <Button size="sm" variant="danger" onClick={() => onRemove(table, r.id, labelOf(r))}>ลบ</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
};

// ── แท็บรุ่น + จุดตรวจ ─────────────────────────────────────────────────────
const ModelsTab = ({
  models, divisions, selectedModel, setSelectedModel, checkpoints,
  onSave, onRemove, onMove, onPreviewBaseline, onClearBaseline,
}) => {
  const [modelForm, setModelForm] = useState({ division_id: '', model_code: '', model_name: '', drawing_no: '', drawing_rev: '' });
  const [editingModel, setEditingModel] = useState(null);
  const [cpForm, setCpForm] = useState(blankCheckpoint);
  const [editingCp, setEditingCp] = useState(null);

  const resetModel = () => { setModelForm({ division_id: '', model_code: '', model_name: '', drawing_no: '', drawing_rev: '' }); setEditingModel(null); };
  const resetCp = () => { setCpForm(blankCheckpoint()); setEditingCp(null); };

  const submitModel = async (e) => {
    e.preventDefault();
    if (!modelForm.division_id || !modelForm.model_code || !modelForm.model_name) {
      return window.alert('กรอก Division / รหัสรุ่น / ชื่อรุ่น ให้ครบ');
    }
    if (await onSave('models', modelForm, editingModel)) resetModel();
  };

  const submitCp = async (e) => {
    e.preventDefault();
    if (!selectedModel) return window.alert('เลือกรุ่นก่อน');
    if (!cpForm.name) return window.alert('กรอกชื่อจุดตรวจ');

    const isAttr = cpForm.char_type === 'attribute';
    const data = {
      model_id: selectedModel,
      name: cpForm.name,
      char_type: cpForm.char_type,
      unit: cpForm.unit || null,
      gauge: cpForm.gauge || null,
      // จุด attribute ไม่มีค่าตัวเลข ส่ง null ทั้งหมดและบังคับ n = 1
      usl: isAttr ? null : numOrNull(cpForm.usl),
      lsl: isAttr ? null : numOrNull(cpForm.lsl),
      target: isAttr ? null : numOrNull(cpForm.target),
      sample_size: isAttr ? 1 : Number(cpForm.sample_size) || 1,
      is_critical: cpForm.is_critical ? 1 : 0,
      is_active: cpForm.is_active ? 1 : 0,
    };
    // seq_no ต่อท้ายอัตโนมัติตอนเพิ่มใหม่ — ลำดับปรับด้วยปุ่มลูกศรทีหลัง
    if (!editingCp) data.seq_no = (checkpoints.reduce((m, c) => Math.max(m, c.seq_no), 0) || 0) + 1;

    if (await onSave('checkpoints', data, editingCp)) resetCp();
  };

  const startEditCp = (cp) => {
    setEditingCp(cp.id);
    // ⚠️ toNum คืน null ได้ ต้อง ?? '' ก่อนใส่ input
    setCpForm({
      name: cp.name ?? '', char_type: cp.char_type, unit: cp.unit ?? '', gauge: cp.gauge ?? '',
      usl: cp.usl ?? '', lsl: cp.lsl ?? '', target: cp.target ?? '',
      sample_size: cp.sample_size ?? 1, is_critical: cp.is_critical, is_active: cp.is_active,
    });
  };

  const cpField = (key) => ({
    value: cpForm[key] ?? '',
    onChange: (e) => setCpForm((f) => ({ ...f, [key]: e.target.value })),
  });
  const isAttr = cpForm.char_type === 'attribute';

  return (
    <Row>
      {/* รุ่น */}
      <Col lg={4}>
        <Card className="mb-3">
          <Card.Header>รุ่น (Model)</Card.Header>
          <Card.Body>
            <Form onSubmit={submitModel}>
              <Form.Select
                className="mb-2" value={modelForm.division_id}
                onChange={(e) => setModelForm((f) => ({ ...f, division_id: e.target.value }))}
              >
                <option value="">-- Division --</option>
                {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Form.Select>
              <Form.Control className="mb-2" placeholder="รหัสรุ่น เช่น MDL-1001"
                value={modelForm.model_code} onChange={(e) => setModelForm((f) => ({ ...f, model_code: e.target.value }))} />
              <Form.Control className="mb-2" placeholder="ชื่อรุ่น"
                value={modelForm.model_name} onChange={(e) => setModelForm((f) => ({ ...f, model_name: e.target.value }))} />
              <Row className="g-2 mb-2">
                <Col><Form.Control placeholder="เลขแบบ"
                  value={modelForm.drawing_no} onChange={(e) => setModelForm((f) => ({ ...f, drawing_no: e.target.value }))} /></Col>
                <Col xs={4}><Form.Control placeholder="Rev"
                  value={modelForm.drawing_rev} onChange={(e) => setModelForm((f) => ({ ...f, drawing_rev: e.target.value }))} /></Col>
              </Row>
              <Button type="submit" className="w-100" variant={editingModel ? 'warning' : 'success'}>
                {editingModel ? 'บันทึกการแก้ไข' : 'เพิ่มรุ่น'}
              </Button>
              {editingModel && <Button variant="link" className="w-100" onClick={resetModel}>ยกเลิก</Button>}
            </Form>

            <hr />
            <Table size="sm" hover className="mb-0">
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className={selectedModel === String(m.id) ? 'table-primary' : ''}>
                    <td role="button" onClick={() => setSelectedModel(String(m.id))}>
                      <div className="fw-bold">{m.model_code}</div>
                      <div className="small text-muted">
                        {m.model_name} · {toNum(m.checkpoint_count) || 0} จุด
                        {!m.is_active && <Badge bg="secondary" className="ms-1">ปิดใช้งาน</Badge>}
                      </div>
                    </td>
                    <td style={{ width: 96 }} className="text-end align-middle">
                      <Button size="sm" variant="outline-primary" className="me-1"
                        onClick={() => { setEditingModel(m.id); setModelForm({
                          division_id: m.division_id ?? '', model_code: m.model_code ?? '',
                          model_name: m.model_name ?? '', drawing_no: m.drawing_no ?? '', drawing_rev: m.drawing_rev ?? '',
                        }); }}>แก้</Button>
                      <Button size="sm" variant="outline-danger"
                        onClick={() => onRemove('models', m.id, m.model_code)}>ลบ</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      </Col>

      {/* จุดตรวจ */}
      <Col lg={8}>
        <Card style={{ opacity: selectedModel ? 1 : 0.6 }}>
          <Card.Header>
            จุดตรวจ {selectedModel && `— ${models.find((m) => String(m.id) === selectedModel)?.model_code ?? ''}`}
          </Card.Header>
          <Card.Body>
            <Form onSubmit={submitCp}>
              <Row className="g-2 mb-2">
                <Col md={4}><Form.Control placeholder="ชื่อจุดตรวจ" {...cpField('name')} disabled={!selectedModel} /></Col>
                <Col md={3}>
                  <Form.Select {...cpField('char_type')} disabled={!selectedModel}>
                    {CHAR_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Form.Select>
                </Col>
                <Col md={2}><Form.Control placeholder="หน่วย" {...cpField('unit')} disabled={!selectedModel || isAttr} /></Col>
                <Col md={3}><Form.Control placeholder="เครื่องมือวัด" {...cpField('gauge')} disabled={!selectedModel} /></Col>
              </Row>
              <Row className="g-2 mb-2">
                <Col md={2}><Form.Control type="number" step="0.0001" placeholder="LSL" {...cpField('lsl')} disabled={!selectedModel || isAttr} /></Col>
                <Col md={2}><Form.Control type="number" step="0.0001" placeholder="Target" {...cpField('target')} disabled={!selectedModel || isAttr} /></Col>
                <Col md={2}><Form.Control type="number" step="0.0001" placeholder="USL" {...cpField('usl')} disabled={!selectedModel || isAttr} /></Col>
                <Col md={2}>
                  {/* n = 1 → กราฟ I-MR · n >= 2 → กราฟ X-bar R (ตาราง A2/D3/D4 มีถึง 10) */}
                  <Form.Control type="number" min="1" max="10" placeholder="ชิ้น/ครั้ง"
                    {...cpField('sample_size')} disabled={!selectedModel || isAttr} />
                </Col>
                <Col md="auto" className="d-flex align-items-center gap-3">
                  <Form.Check label="จุดวิกฤต" checked={cpForm.is_critical} disabled={!selectedModel}
                    onChange={(e) => setCpForm((f) => ({ ...f, is_critical: e.target.checked }))} />
                  <Form.Check label="ใช้งาน" checked={cpForm.is_active} disabled={!selectedModel}
                    onChange={(e) => setCpForm((f) => ({ ...f, is_active: e.target.checked }))} />
                </Col>
                <Col md="auto">
                  <Button type="submit" variant={editingCp ? 'warning' : 'success'} disabled={!selectedModel}>
                    {editingCp ? 'บันทึก' : 'เพิ่มจุดตรวจ'}
                  </Button>
                  {editingCp && <Button variant="link" onClick={resetCp}>ยกเลิก</Button>}
                </Col>
              </Row>
            </Form>

            <Table striped bordered hover responsive size="sm" className="mb-0">
              <thead className="table-dark">
                <tr>
                  <th style={{ width: 70 }}>ลำดับ</th><th>จุดตรวจ</th><th>ชนิด</th>
                  <th>LSL ~ USL</th><th>n</th><th>Control limit</th><th style={{ width: 200 }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.length === 0
                  ? <tr><td colSpan="7" className="text-center text-muted">ยังไม่มีจุดตรวจ</td></tr>
                  : checkpoints.map((cp, i) => (
                    <tr key={cp.id} className={!cp.is_active ? 'text-muted' : ''}>
                      <td>
                        {cp.seq_no}
                        <Button size="sm" variant="link" className="p-0 ms-1" disabled={i === 0}
                          onClick={() => onMove(cp.id, 'up')}>▲</Button>
                        <Button size="sm" variant="link" className="p-0" disabled={i === checkpoints.length - 1}
                          onClick={() => onMove(cp.id, 'down')}>▼</Button>
                      </td>
                      <td>{cp.is_critical && '🔴 '}{cp.name}</td>
                      <td className="small">{cp.char_type === 'attribute' ? 'ตรวจด้วยตา' : 'วัดค่า'}</td>
                      <td className="small">
                        {cp.char_type === 'attribute' ? '—' : `${cp.lsl ?? '-'} ~ ${cp.usl ?? '-'}`}
                      </td>
                      <td>{cp.char_type === 'attribute' ? '—' : cp.sample_size}</td>
                      <td className="small">
                        {cp.char_type === 'attribute' ? '—'
                          : cp.baseline_locked_at
                            ? <Badge bg="success">ล็อกแล้ว (n={cp.baseline_n}, {cp.baseline_subgroups} subgroup)</Badge>
                            : <Badge bg="secondary">provisional</Badge>}
                      </td>
                      <td>
                        <Button size="sm" variant="primary" className="me-1" onClick={() => startEditCp(cp)}>แก้</Button>
                        {cp.char_type !== 'attribute' && (
                          cp.baseline_locked_at
                            ? <Button size="sm" variant="outline-warning" className="me-1"
                                onClick={() => onClearBaseline(cp)}>ล้าง</Button>
                            : <Button size="sm" variant="outline-success" className="me-1"
                                onClick={() => onPreviewBaseline(cp)}>Baseline</Button>
                        )}
                        <Button size="sm" variant="danger" onClick={() => onRemove('checkpoints', cp.id, cp.name)}>ลบ</Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
};

// ── ยืนยันก่อน freeze control limit ────────────────────────────────────────
const BaselineModal = ({ info, onClose, onConfirm }) => (
  <Modal show={Boolean(info)} onHide={onClose}>
    <Modal.Header closeButton><Modal.Title>ล็อก Control Limit</Modal.Title></Modal.Header>
    {info && (
      <Modal.Body>
        <p className="mb-2">จุดตรวจ: <strong>{info.checkpoint.name}</strong></p>
        <Table size="sm" bordered>
          <tbody>
            <tr><td>ขนาด subgroup (n)</td><td>{info.n}</td></tr>
            <tr><td>จำนวน subgroup</td><td>{info.subgroupCount}</td></tr>
            <tr><td>X̿ (ค่ากลาง)</td><td>{info.xbarbar?.toFixed(4)}</td></tr>
            <tr><td>R̄</td><td>{info.rbar?.toFixed(4)}</td></tr>
            <tr>
              <td>UCL / LCL ที่จะได้</td>
              <td>{info.limits?.ucl?.toFixed(4)} / {info.limits?.lcl?.toFixed(4)}</td>
            </tr>
          </tbody>
        </Table>
        {!info.enoughSubgroups && (
          <Alert variant="warning" className="mb-0 small">
            มีแค่ {info.subgroupCount} subgroup — มาตรฐานแนะนำอย่างน้อย {info.minSubgroups} subgroup
            ที่กระบวนการนิ่งแล้ว ล็อกตอนนี้ได้แต่ลิมิตจะยังไม่น่าเชื่อถือ กด Re-baseline ใหม่ได้ทีหลัง
          </Alert>
        )}
      </Modal.Body>
    )}
    <Modal.Footer>
      <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
      <Button variant="primary" onClick={onConfirm}>ยืนยันล็อก</Button>
    </Modal.Footer>
  </Modal>
);

export default MasterSetup;
