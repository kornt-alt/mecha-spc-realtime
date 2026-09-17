// frontend/src/components/InspectionSheet.js — ใบตรวจอิเล็กทรอนิกส์ (แทน InputStation เดิม)
//
// รูปแบบตั้งใจให้เหมือนใบเช็คชีตกระดาษที่หน้างานใช้อยู่: หัวใบ (รุ่น/MO/เครื่อง/กะ/ผู้ตรวจ)
// แล้วไล่จุดตรวจตามลำดับในแบบ (seq_no) กรอกทีละจุด เห็น OK/NG ทันที แล้วบันทึกทั้งใบครั้งเดียว
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Container, Row, Col, Card, Form, Button, Table, Badge, Alert, Spinner } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { on } from '../utils/socket';
import { normalizeRows, normalizeCheckpoints, judgeLocal, toNum } from '../utils/normalize';
import { SHIFTS, currentShift } from '../utils/config';

const emptyHeader = () => ({
  model_id: '',
  machine_id: '',
  inspector_id: '',
  mo_no: '',
  lot_no: '',
  shift: currentShift(),
  remark: '',
});

// แสดงสเปกแบบที่ช่างอ่านรู้เรื่อง — มีทั้งสองข้าง / ข้างเดียว / ไม่มีเลย
const specText = (cp) => {
  if (cp.char_type === 'attribute') return 'ตรวจด้วยตา';
  const { usl, lsl, target, unit } = cp;
  const u = unit ? ` ${unit}` : '';
  if (usl !== null && lsl !== null) return `${lsl} ~ ${usl}${u}${target !== null ? ` (เป้า ${target})` : ''}`;
  if (usl !== null) return `≤ ${usl}${u}`;
  if (lsl !== null) return `≥ ${lsl}${u}`;
  return 'ไม่ได้ตั้งสเปก';
};

const InspectionSheet = () => {
  const [lookups, setLookups] = useState({ divisions: [], machines: [], inspectors: [] });
  const [models, setModels] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [header, setHeader] = useState(emptyHeader);
  // inputs[checkpointId] = { pieces: ['9.98', ...] } หรือ { judgment: 'OK'|'NG' }
  const [inputs, setInputs] = useState({});
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // ── โหลด master ───────────────────────────────────────────────────────
  const loadMaster = useCallback(async () => {
    try {
      const [lk, ms] = await Promise.all([apiCall('/master/lookups'), apiCall('/master/models')]);
      setLookups(lk);
      setModels(normalizeRows(ms));
    } catch (e) {
      setMsg({ variant: 'danger', text: `โหลดข้อมูลตั้งต้นไม่สำเร็จ: ${e.message}` });
    }
  }, []);

  useEffect(() => { loadMaster(); }, [loadMaster]);
  useEffect(() => on('master_updated', loadMaster), [loadMaster]);

  // ── เลือกรุ่น → โหลดจุดตรวจ + ประวัติ ─────────────────────────────────
  const loadHistory = useCallback(async (modelId) => {
    if (!modelId) return setHistory([]);
    try {
      setHistory(normalizeRows(await apiCall(`/inspections?model_id=${modelId}&limit=20`)));
    } catch (e) {
      console.error('โหลดประวัติไม่สำเร็จ', e);
    }
  }, []);

  const selectModel = async (modelId) => {
    setHeader((h) => ({ ...h, model_id: modelId }));
    setInputs({});
    setMsg(null);

    if (!modelId) {
      setCheckpoints([]);
      setHistory([]);
      return;
    }
    try {
      const { checkpoints: cps } = await apiCall(`/master/models/${modelId}`);
      const list = normalizeCheckpoints(cps);
      setCheckpoints(list);
      // ตั้งช่องว่างให้ครบตาม sample_size ของแต่ละจุด
      setInputs(Object.fromEntries(list.map((c) => [
        c.id,
        c.char_type === 'attribute'
          ? { judgment: 'OK' }
          : { pieces: Array(c.sample_size || 1).fill('') },
      ])));
      loadHistory(modelId);
    } catch (e) {
      setMsg({ variant: 'danger', text: e.message });
    }
  };

  // ── ตัดสิน OK/NG สด ๆ ตอนพิมพ์ (advisory — server เป็นตัวตัดสินจริงตอนบันทึก) ──
  const verdicts = useMemo(() => {
    const out = {};
    for (const cp of checkpoints) {
      const inp = inputs[cp.id];
      if (cp.char_type === 'attribute') {
        out[cp.id] = { judgment: inp?.judgment ?? null, pieces: [] };
        continue;
      }
      const pieces = (inp?.pieces ?? []).map((raw) =>
        String(raw).trim() === '' ? null : judgeLocal(raw, cp.usl, cp.lsl)
      );
      out[cp.id] = {
        pieces,
        judgment: pieces.includes('NG') ? 'NG' : pieces.every((p) => p === 'OK') ? 'OK' : null,
      };
    }
    return out;
  }, [checkpoints, inputs]);

  const filledAll = checkpoints.length > 0 && checkpoints.every((c) => verdicts[c.id]?.judgment !== null);
  const overall = checkpoints.some((c) => verdicts[c.id]?.judgment === 'NG') ? 'NG' : 'OK';
  const ngCount = checkpoints.filter((c) => verdicts[c.id]?.judgment === 'NG').length;

  const setPiece = (cpId, idx, value) =>
    setInputs((prev) => {
      const pieces = [...(prev[cpId]?.pieces ?? [])];
      pieces[idx] = value;
      return { ...prev, [cpId]: { ...prev[cpId], pieces } };
    });

  // ── บันทึก — ทั้งใบใน request เดียว ───────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const res = await apiCall('/inspections', {
        method: 'POST',
        body: {
          ...header,
          results: checkpoints.map((cp) =>
            cp.char_type === 'attribute'
              ? { checkpoint_id: cp.id, judgment: inputs[cp.id]?.judgment ?? 'OK' }
              : {
                  checkpoint_id: cp.id,
                  pieces: (inputs[cp.id]?.pieces ?? []).map((v, i) => ({ piece_no: i + 1, value: v })),
                }
          ),
        },
      });

      setMsg({
        variant: res.overall_result === 'NG' ? 'danger' : 'success',
        text: `บันทึกแล้ว — subgroup #${res.subgroup_no} · ผลรวม ${res.overall_result}`,
      });
      // ล้างเฉพาะค่าวัด เก็บหัวใบไว้ให้ตรวจรอบถัดไปต่อได้เลย (MO/เครื่อง/กะ/ผู้ตรวจ มักเป็นชุดเดิม)
      setInputs(Object.fromEntries(checkpoints.map((c) => [
        c.id,
        c.char_type === 'attribute' ? { judgment: 'OK' } : { pieces: Array(c.sample_size || 1).fill('') },
      ])));
      loadHistory(header.model_id);
    } catch (err) {
      setMsg({ variant: 'danger', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const field = (key) => ({
    value: header[key],
    onChange: (e) => setHeader((h) => ({ ...h, [key]: e.target.value })),
  });

  return (
    <Container fluid className="mt-3 pb-5">
      <h4 className="mb-3">📝 ใบตรวจสอบคุณภาพ</h4>
      {msg && <Alert variant={msg.variant} dismissible onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <Form onSubmit={handleSubmit}>
        {/* ── หัวใบตรวจ ── */}
        <Card className="mb-3 bg-light">
          <Card.Body className="pb-2">
            <Row className="g-2">
              <Col md={3}>
                <Form.Label className="small mb-1">รุ่น (Model)</Form.Label>
                <Form.Select value={header.model_id} onChange={(e) => selectModel(e.target.value)} required>
                  <option value="">-- เลือกรุ่น --</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.model_code} — {m.model_name}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label className="small mb-1">MO No.</Form.Label>
                <Form.Control {...field('mo_no')} placeholder="สแกน/พิมพ์ MO" required />
              </Col>
              <Col md={2}>
                <Form.Label className="small mb-1">Lot No.</Form.Label>
                <Form.Control {...field('lot_no')} placeholder="(ไม่บังคับ)" />
              </Col>
              <Col md={2}>
                <Form.Label className="small mb-1">เครื่อง</Form.Label>
                <Form.Select {...field('machine_id')} required>
                  <option value="">-- เลือกเครื่อง --</option>
                  {lookups.machines.map((m) => (
                    <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={1}>
                <Form.Label className="small mb-1">กะ</Form.Label>
                <Form.Select {...field('shift')}>
                  {SHIFTS.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label className="small mb-1">ผู้ตรวจ</Form.Label>
                <Form.Select {...field('inspector_id')} required>
                  <option value="">-- เลือกผู้ตรวจ --</option>
                  {lookups.inspectors.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} ({i.emp_code})</option>
                  ))}
                </Form.Select>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {/* ── จุดตรวจ เรียงตาม seq_no ── */}
        {header.model_id && checkpoints.length === 0 && (
          <Alert variant="warning">รุ่นนี้ยังไม่ได้ตั้งจุดตรวจไว้ — ไปตั้งที่หน้า Master Setup ก่อน</Alert>
        )}

        {checkpoints.length > 0 && (
          <Card className="mb-3">
            <Table responsive bordered hover size="sm" className="mb-0 align-middle">
              <thead className="table-dark">
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>จุดตรวจ</th>
                  <th style={{ width: 200 }}>สเปก</th>
                  <th>ค่าที่วัดได้</th>
                  <th style={{ width: 90 }} className="text-center">ผล</th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.map((cp) => {
                  const v = verdicts[cp.id] ?? {};
                  return (
                    <tr key={cp.id} className={v.judgment === 'NG' ? 'table-danger' : ''}>
                      <td className="text-muted">{cp.seq_no}</td>
                      <td>
                        {cp.is_critical && <span title="จุดวิกฤต" className="me-1">🔴</span>}
                        {cp.name}
                        {cp.gauge && <div className="text-muted small">เครื่องมือ: {cp.gauge}</div>}
                      </td>
                      <td className="small text-muted">{specText(cp)}</td>
                      <td>
                        {cp.char_type === 'attribute' ? (
                          <div>
                            {['OK', 'NG'].map((j) => (
                              <Form.Check
                                inline key={j} type="radio" label={j} id={`cp${cp.id}-${j}`}
                                name={`cp${cp.id}`} checked={inputs[cp.id]?.judgment === j}
                                onChange={() => setInputs((p) => ({ ...p, [cp.id]: { judgment: j } }))}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="d-flex flex-wrap gap-1">
                            {(inputs[cp.id]?.pieces ?? []).map((val, i) => (
                              <Form.Control
                                key={i} type="number" step="0.0001" size="sm"
                                style={{ width: 96 }}
                                placeholder={`#${i + 1}`}
                                value={val}
                                onChange={(e) => setPiece(cp.id, i, e.target.value)}
                                // ช่องที่ค่าหลุดสเปกขึ้นกรอบแดงทันทีที่พิมพ์ ไม่ต้องรอกดบันทึก
                                className={v.pieces?.[i] === 'NG' ? 'is-invalid' : ''}
                              />
                            ))}
                            {cp.sample_size > 1 && (
                              <span className="small text-muted align-self-center ms-1">
                                {cp.sample_size} ชิ้น
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="text-center">
                        {v.judgment
                          ? <Badge bg={v.judgment === 'NG' ? 'danger' : 'success'}>{v.judgment}</Badge>
                          : <span className="text-muted small">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>

            <Card.Footer className="d-flex justify-content-between align-items-center">
              <div>
                <span className="me-2">สรุปทั้งใบ:</span>
                {filledAll
                  ? <Badge bg={overall === 'NG' ? 'danger' : 'success'} className="fs-6">
                      {overall}{overall === 'NG' && ` (${ngCount} จุดไม่ผ่าน)`}
                    </Badge>
                  : <span className="text-muted">ยังกรอกไม่ครบ</span>}
              </div>
              <div className="d-flex align-items-center gap-2">
                <Form.Control
                  size="sm" style={{ width: 240 }} placeholder="หมายเหตุ (ไม่บังคับ)" {...field('remark')}
                />
                <Button type="submit" variant="primary" disabled={!filledAll || saving}>
                  {saving ? <><Spinner size="sm" animation="border" className="me-1" />กำลังบันทึก</> : 'บันทึกใบตรวจ'}
                </Button>
              </div>
            </Card.Footer>
          </Card>
        )}
      </Form>

      {/* ── ประวัติใบตรวจล่าสุดของรุ่นนี้ ── */}
      {header.model_id && (
        <>
          <h6 className="mt-4">📋 ใบตรวจล่าสุดของรุ่นนี้</h6>
          <Card>
            <Table striped bordered hover responsive size="sm" className="mb-0">
              <thead className="table-light">
                <tr>
                  <th>เวลา</th><th>MO</th><th>Lot</th><th>Subgroup</th>
                  <th>กะ</th><th>เครื่อง</th><th>ผู้ตรวจ</th><th>จุด NG</th><th>ผล</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr><td colSpan="9" className="text-center text-muted">ยังไม่มีใบตรวจ</td></tr>
                ) : history.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.inspected_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td>
                    <td>{h.mo_no}</td>
                    <td>{h.lot_no || '-'}</td>
                    <td>#{h.subgroup_no}</td>
                    <td>{h.shift}</td>
                    <td>{h.machine_name}</td>
                    <td>{h.inspector_name}</td>
                    <td>{toNum(h.ng_count) || 0}</td>
                    <td>
                      <Badge bg={h.overall_result === 'NG' ? 'danger' : 'success'}>{h.overall_result}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </Container>
  );
};

export default InspectionSheet;
