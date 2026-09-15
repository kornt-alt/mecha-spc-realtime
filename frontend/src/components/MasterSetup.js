import React, { useState, useEffect } from 'react';
import { Container, Form, Button, Card, Row, Col, Alert, Table } from 'react-bootstrap';
import { apiCall } from '../App';

const MasterSetup = () => {
    const [tree, setTree] = useState([]);
    const [msg, setMsg] = useState('');
    
    // Selection States (สำหรับการเลือก Hierarchy)
    const [selectedDiv, setSelectedDiv] = useState('');
    const [selectedMachine, setSelectedMachine] = useState('');
    const [selectedPart, setSelectedPart] = useState('');
    
    // Input States (สำหรับกรอกข้อมูลใหม่)
    const [newItemName, setNewItemName] = useState(''); // ใช้ร่วมกันสำหรับ Div, Machine, Part
    const [specData, setSpecData] = useState({ name: '', ucl: '', lcl: '', target: '' });

    // ✅ EDIT MODE STATES
    const [editingId, setEditingId] = useState(null); // ID ที่กำลังแก้
    const [editLevel, setEditLevel] = useState('');   // ระดับที่กำลังแก้ (spec, part, etc.)

    const refreshTree = async () => {
        const data = await apiCall('/master/tree');
        if (Array.isArray(data)) setTree(data);
    };

    useEffect(() => { refreshTree(); }, []);

    // Filter Logic
    const getDivs = () => [...new Map(tree.map(i => [i.d_id, {id: i.d_id, name: i.d_name}])).values()].filter(i=>i.id);
    const getMachines = () => [...new Map(tree.filter(i => i.d_id == selectedDiv).map(i => [i.m_id, {id: i.m_id, name: i.m_name}])).values()].filter(i=>i.id);
    const getParts = () => [...new Map(tree.filter(i => i.m_id == selectedMachine).map(i => [i.p_id, {id: i.p_id, name: i.part_name}])).values()].filter(i=>i.id);
    const getSpecs = () => tree.filter(i => i.p_id == selectedPart && i.s_id).map(i => ({...i}));

    // ✅ ฟังก์ชัน Save รองรับทั้ง ADD และ UPDATE
    const handleSave = async (level) => {
        let body = {};
        let table = '';
        
        // เช็คว่ากำลัง Update หรือ Add ใหม่
        const isUpdate = (editingId !== null && editLevel === level);

        // Map Data ตาม Level
        if (level === 'division') {
            table = 'divisions';
            body = { name: newItemName };
            if(!newItemName) return alert("Please enter name");
        } else if (level === 'machine') {
            table = 'machines';
            body = { division_id: selectedDiv, name: newItemName };
            if(!selectedDiv) return alert("Select Division first");
        } else if (level === 'part') {
            table = 'parts';
            body = { machine_id: selectedMachine, part_name: newItemName, part_no: 'N/A' };
            if(!selectedMachine) return alert("Select Machine first");
        } else if (level === 'spec') {
            table = 'specs';
            body = { 
                part_id: selectedPart, 
                spec_name: specData.name, 
                ucl: specData.ucl, 
                lcl: specData.lcl, 
                target: specData.target 
            };
            if(!selectedPart) return alert("Select Part first");
        }

        try {
            if (isUpdate) {
                // กรณี Update
                await apiCall('/master/update', { 
                    method: 'PUT', 
                    body: { table, id: editingId, data: body } 
                });
                setMsg(`Updated ${level} successfully!`);
            } else {
                // กรณี Add New
                await apiCall('/master/add', { 
                    method: 'POST', 
                    body: { table, data: body } 
                });
                setMsg(`Added ${level} successfully!`);
            }
            
            // Reset Form หลังบันทึกเสร็จ
            handleCancel(); 
            refreshTree();
        } catch (e) { setMsg('Error: ' + e.message); }
    };

    // ✅ ฟังก์ชัน Delete
    const handleDelete = async (table, id) => {
        if(!window.confirm("Are you sure? This will delete all related data!")) return;
        try {
            await apiCall('/master/delete', {
                method: 'DELETE',
                body: { table, id }
            });
            setMsg('Deleted successfully');
            refreshTree();
        } catch (e) { setMsg('Error: ' + e.message); }
    };

    // ✅ เริ่มโหมดแก้ไข Spec
    const startEditSpec = (s) => {
        setEditLevel('spec');
        setEditingId(s.s_id);
        setSpecData({
            name: s.spec_name,
            ucl: s.ucl,
            lcl: s.lcl,
            target: s.target
        });
    };

    // ✅ ยกเลิกโหมดแก้ไข ล้างค่ากลับเป็นค่าว่าง
    const handleCancel = () => {
        setEditingId(null);
        setEditLevel('');
        setNewItemName('');
        setSpecData({ name: '', ucl: '', lcl: '', target: '' });
    };

    return (
        <Container className="mt-4 pb-5">
            <h2>⚙️ Master Configuration</h2>
            {msg && <Alert variant="success" onClose={()=>setMsg('')} dismissible>{msg}</Alert>}
            
            <Row>
                <Col md={4}>
                    {/* 1. DIVISION */}
                    <Card className="p-3 mb-3 bg-light">
                        <h5>1. Division</h5>
                        {/* ถ้าเลือก Edit Division อยู่ค่อยแสดง UI แก้ไข (ในที่นี้ทำแบบ Simple เน้น Add) */}
                        <Form.Control 
                            placeholder="New Division Name" 
                            value={editLevel === 'division' ? '' : newItemName} 
                            onChange={e=>setNewItemName(e.target.value)} 
                        />
                        <Button className="mt-2 w-100" onClick={() => handleSave('division')}>Add Division</Button>
                        
                        <hr/>
                        <Form.Label className="fw-bold">Select Division:</Form.Label>
                        <Form.Select value={selectedDiv} onChange={e => { setSelectedDiv(e.target.value); setSelectedMachine(''); setSelectedPart(''); }}>
                            <option value="">-- Select Division --</option>
                            {getDivs().map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </Form.Select>
                    </Card>

                    {/* 2. MACHINE */}
                    <Card className="p-3 mb-3" style={{opacity: selectedDiv ? 1 : 0.6}}>
                        <h5>2. Machine</h5>
                        <Form.Control 
                            placeholder="New Machine Name" 
                            value={editLevel === 'machine' ? '' : newItemName} 
                            onChange={e=>setNewItemName(e.target.value)} 
                            disabled={!selectedDiv}
                        />
                        <Button className="mt-2 w-100" variant="info" onClick={() => handleSave('machine')} disabled={!selectedDiv}>Add Machine</Button>
                        
                        <hr/>
                        <Form.Label className="fw-bold">Select Machine:</Form.Label>
                        <Form.Select value={selectedMachine} disabled={!selectedDiv} onChange={e => { setSelectedMachine(e.target.value); setSelectedPart(''); }}>
                            <option value="">-- Select Machine --</option>
                            {getMachines().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </Form.Select>
                    </Card>

                    {/* 3. PART */}
                    <Card className="p-3 mb-3" style={{opacity: selectedMachine ? 1 : 0.6}}>
                        <h5>3. Part</h5>
                        <Form.Control 
                            placeholder="New Part Name" 
                            value={editLevel === 'part' ? '' : newItemName} 
                            onChange={e=>setNewItemName(e.target.value)} 
                            disabled={!selectedMachine}
                        />
                        <Button className="mt-2 w-100" variant="warning" onClick={() => handleSave('part')} disabled={!selectedMachine}>Add Part</Button>
                        
                        <hr/>
                        <Form.Label className="fw-bold">Select Part:</Form.Label>
                        <Form.Select value={selectedPart} disabled={!selectedMachine} onChange={e => setSelectedPart(e.target.value)}>
                            <option value="">-- Select Part --</option>
                            {getParts().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Form.Select>
                    </Card>
                </Col>

                {/* 4. SPEC TABLE & FORM */}
                <Col md={8}>
                    <Card className={`p-3 border-${editingId ? 'warning' : 'secondary'} shadow-sm`} style={{opacity: selectedPart ? 1 : 0.6}}>
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h4 className={editingId ? "text-warning" : "text-dark"}>
                                {editingId ? '✏️ Updating Spec' : '4. Add / Manage Specs'}
                            </h4>
                            {editingId && <Button variant="secondary" size="sm" onClick={handleCancel}>Cancel Edit</Button>}
                        </div>

                        {/* Form สำหรับ Add/Edit Spec */}
                        <Row className="g-2 mb-3">
                            <Col md={3}><Form.Control placeholder="Spec Name" value={specData.name} onChange={e=>setSpecData({...specData, name:e.target.value})} /></Col>
                            <Col md={2}><Form.Control placeholder="Target" type="number" value={specData.target} onChange={e=>setSpecData({...specData, target:e.target.value})} /></Col>
                            <Col md={2}><Form.Control placeholder="USL" type="number" value={specData.ucl} onChange={e=>setSpecData({...specData, ucl:e.target.value})} /></Col>
                            <Col md={2}><Form.Control placeholder="LSL" type="number" value={specData.lcl} onChange={e=>setSpecData({...specData, lcl:e.target.value})} /></Col>
                            <Col md={3}>
                                <Button 
                                    className="w-100" 
                                    variant={editingId ? "warning" : "success"} 
                                    onClick={() => handleSave('spec')}
                                    disabled={!selectedPart}
                                >
                                    {editingId ? "Update Spec" : "Add Spec"}
                                </Button>
                            </Col>
                        </Row>

                        {/* ตารางแสดงรายการ Spec */}
                        <Table striped bordered hover responsive>
                            <thead className="table-dark">
                                <tr>
                                    <th>Spec Name</th>
                                    <th>Target</th>
                                    <th>Range (LSL-USL)</th>
                                    <th style={{width: '140px'}}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {getSpecs().length === 0 ? <tr><td colSpan="4" className="text-center">No Specs found for this part</td></tr> : 
                                    getSpecs().map(s => (
                                        <tr key={s.s_id} className={editingId === s.s_id ? "table-warning" : ""}>
                                            <td>{s.spec_name}</td>
                                            <td>{s.target}</td>
                                            <td>{s.lcl} - {s.ucl}</td>
                                            <td>
                                                <Button 
                                                    variant="primary" size="sm" className="me-2"
                                                    onClick={() => startEditSpec(s)}
                                                >
                                                    Edit
                                                </Button>
                                                <Button 
                                                    variant="danger" size="sm"
                                                    onClick={() => handleDelete('specs', s.s_id)}
                                                >
                                                    Del
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                }
                            </tbody>
                        </Table>
                    </Card>
                </Col>
            </Row>
        </Container>
    );
};
export default MasterSetup;