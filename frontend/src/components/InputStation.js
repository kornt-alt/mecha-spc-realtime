import React, { useState, useEffect, useCallback } from 'react';
import { Container, Form, Button, Row, Col, Card, Alert, Table, Badge } from 'react-bootstrap';
import { apiCall } from '../App';
import socket from '../utils/socket';
import { normalizeTree, normalizeMeasures } from '../utils/normalize';

// เทียบค่ากับลิมิต — ucl/lcl เป็น null ได้ ถ้าไม่มีลิมิตถือว่าไม่ NG
const isOutOfSpec = (value, ucl, lcl) => {
    if (typeof value !== 'number') return false;
    if (typeof ucl === 'number' && value > ucl) return true;
    if (typeof lcl === 'number' && value < lcl) return true;
    return false;
};

const InputStation = () => {
    const [tree, setTree] = useState([]);
    const [selectedPart, setSelectedPart] = useState(null);
    const [specs, setSpecs] = useState([]);
    const [inputs, setInputs] = useState({});
    const [samplingNo, setSamplingNo] = useState(1);
    const [lotNo, setLotNo] = useState('');
    const [msg, setMsg] = useState(null);

    // ✅ เพิ่ม State สำหรับเก็บประวัติ
    const [history, setHistory] = useState([]);

    const loadTree = useCallback(async () => {
        try {
            const data = await apiCall('/master/tree');
            setTree(normalizeTree(data));
        } catch (e) {
            console.error('Load master tree failed', e);
        }
    }, []);

    // ✅ ฟังก์ชันดึง History
    const loadHistory = useCallback(async (partId) => {
        // partId ต้องเป็นตัวเลขจริง ไม่งั้นจะยิง /history/NaN แล้ว backend พัง
        if (!Number.isInteger(partId)) {
            setHistory([]);
            return;
        }
        try {
            const data = await apiCall(`/history/${partId}`);
            setHistory(normalizeMeasures(data));
        } catch (e) {
            console.error("Load history failed", e);
        }
    }, []);

    useEffect(() => { loadTree(); }, [loadTree]);

    // master data เปลี่ยนที่เครื่องอื่น → โหลดใหม่
    useEffect(() => {
        socket.on('master_updated', loadTree);
        return () => socket.off('master_updated', loadTree);
    }, [loadTree]);

    const uniqueParts = [...new Map(tree.filter(i => i.p_id).map(item => [item.p_id, item])).values()];

    const handlePartChange = (e) => {
        const raw = e.target.value;

        // เลือก "-- Choose Part --" กลับ → ค่าเป็น '' ซึ่ง parseInt ได้ NaN
        if (!raw) {
            setSelectedPart(null);
            setSpecs([]);
            setInputs({});
            setHistory([]);
            return;
        }

        const pId = parseInt(raw, 10);
        setSelectedPart(pId);
        setSpecs(tree.filter(t => t.p_id === pId && t.s_id));
        setInputs({});
        // ✅ เปลี่ยน Part ปุ๊บ โหลด History ปั๊บ
        loadHistory(pId);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!lotNo) { alert("Please enter Lot No."); return; }

        if (!Number.isInteger(Number(samplingNo))) {
            alert("Please enter a valid Sampling Round.");
            return;
        }

        // เก็บเฉพาะช่องที่กรอกค่ามาจริง และค่านั้นต้องเป็นตัวเลข
        const entries = specs
            .map(spec => ({ spec, raw: inputs[spec.s_id] }))
            .filter(({ raw }) => raw !== undefined && raw !== null && String(raw).trim() !== '');

        if (entries.length === 0) {
            alert("Please enter at least one measurement value.");
            return;
        }

        const invalid = entries.find(({ raw }) => !Number.isFinite(Number(raw)));
        if (invalid) {
            alert(`Invalid value for ${invalid.spec.spec_name}`);
            return;
        }

        try {
            // ส่งข้อมูลทีละ Spec
            await Promise.all(entries.map(({ spec, raw }) => apiCall('/measure', {
                body: {
                    spec_id: spec.s_id,
                    value: Number(raw),
                    sampling_no: Number(samplingNo),
                    checker_name: 'Operator',
                    lot_no: lotNo
                },
                method: 'POST'
            })));

            setMsg(`Saved ${entries.length} value(s) successfully!`);
            setInputs({});

            // ✅ บันทึกเสร็จ โหลด History ใหม่ทันที Operator จะได้เห็นเลย
            loadHistory(selectedPart);

        } catch (err) {
            setMsg('Error: ' + err.message);
        }
    };

    // Helper เช็คสีสถานะ (OK/NG)
    const getStatusColor = (val, ucl, lcl) => (isOutOfSpec(val, ucl, lcl) ? 'text-danger fw-bold' : 'text-success');

    return (
        <Container className="mt-4">
            <h2>📝 Data Input Station</h2>
            {msg && <Alert variant="info" onClose={() => setMsg(null)} dismissible>{msg}</Alert>}

            <Form onSubmit={handleSubmit} className="mb-5">
                <Row className="mb-3">
                    <Col md={4}>
                        <Form.Group>
                            <Form.Label>Select Part</Form.Label>
                            <Form.Select onChange={handlePartChange}>
                                <option value="">-- Choose Part --</option>
                                {uniqueParts.map(p => (
                                    <option key={p.p_id} value={p.p_id}>
                                        {p.d_name} {'>'} {p.m_name} {'>'} {p.part_name}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>
                    </Col>
                    <Col md={4}>
                         <Form.Group>
                            <Form.Label>Lot No. / MO</Form.Label>
                            <Form.Control
                                type="text"
                                placeholder="Scan Lot No."
                                value={lotNo}
                                onChange={e=>setLotNo(e.target.value)}
                                required
                            />
                         </Form.Group>
                    </Col>
                    <Col md={4}>
                         <Form.Group>
                            <Form.Label>Sampling Round</Form.Label>
                            <Form.Control type="number" value={samplingNo} onChange={e=>setSamplingNo(e.target.value)} />
                         </Form.Group>
                    </Col>
                </Row>

                {selectedPart && specs.length > 0 && (
                    <Card className="p-3 bg-light shadow-sm">
                        <h5>Enter Measurement Values</h5>
                        {specs.map(s => (
                            <Form.Group as={Row} className="mb-2" key={s.s_id}>
                                <Form.Label column sm="4">
                                    {s.spec_name} <br/>
                                    <small className="text-muted">(Min: {s.lcl ?? '-'} | Max: {s.ucl ?? '-'})</small>
                                </Form.Label>
                                <Col sm="8">
                                    <Form.Control
                                        type="number" step="0.0001"
                                        value={inputs[s.s_id] || ''}
                                        onChange={(e) => setInputs({...inputs, [s.s_id]: e.target.value})}
                                        className={
                                            inputs[s.s_id] && isOutOfSpec(Number(inputs[s.s_id]), s.ucl, s.lcl)
                                            ? 'is-invalid' : ''
                                        }
                                    />
                                </Col>
                            </Form.Group>
                        ))}
                        <Button type="submit" variant="primary" className="mt-3">Save Data</Button>
                    </Card>
                )}
            </Form>

            {/* ✅ ส่วนแสดง History Log */}
            {selectedPart && (
                <div className="mt-4">
                    <h4>📋 Recent Activity Log (Selected Part)</h4>
                    <Card>
                        <Table striped bordered hover responsive size="sm" className="mb-0">
                            <thead className="bg-light">
                                <tr>
                                    <th>Time</th>
                                    <th>Lot No.</th>
                                    <th>Round</th>
                                    <th>Spec Name</th>
                                    <th>Value</th>
                                    <th>LCL / UCL</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.length === 0 ? (
                                    <tr><td colSpan="7" className="text-center">No data found yet.</td></tr>
                                ) : (
                                    history.map(row => (
                                        <tr key={row.id}>
                                            <td>{new Date(row.measured_at).toLocaleString('TH-th', { timeZone: 'Asia/Bangkok' })}</td>
                                            <td><Badge bg="secondary">{row.lot_no}</Badge></td>
                                            <td>{row.sampling_no}</td>
                                            <td>{row.spec_name}</td>
                                            <td className={getStatusColor(row.value, row.ucl, row.lcl)}>
                                                {row.value}
                                            </td>
                                            <td className="text-muted small">
                                                {row.lcl ?? '-'} - {row.ucl ?? '-'}
                                            </td>
                                            <td>
                                                { isOutOfSpec(row.value, row.ucl, row.lcl)
                                                    ? <Badge bg="danger">NG</Badge>
                                                    : <Badge bg="success">OK</Badge>
                                                }
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </Table>
                    </Card>
                </div>
            )}
        </Container>
    );
};

export default InputStation;
