import React, { useState, useEffect, useCallback } from 'react';
import { Container, Row, Col, Form, Card } from 'react-bootstrap';
import { apiCall } from '../App';
import socket from '../utils/socket';
import { normalizeTree } from '../utils/normalize';
import SpcChart from './SpcChart';

const Dashboard = () => {
    const [tree, setTree] = useState([]);

    // Filters
    const [filters, setFilters] = useState({
        division: '',
        machine: '',
        part: '',
        startDate: '',
        endDate: ''
    });

    const load = useCallback(async () => {
        try {
            const data = await apiCall('/master/tree');
            setTree(normalizeTree(data));
        } catch (e) {
            console.error('Load master tree failed', e);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // backend ยิง master_updated ทุกครั้งที่แก้ master data → โหลดใหม่ให้อัตโนมัติ
    useEffect(() => {
        socket.on('master_updated', load);
        return () => socket.off('master_updated', load);
    }, [load]);

    // Filter Logic — เก็บทั้ง id และ name ไว้ด้วยกัน
    // (เดิมเก็บแต่ชื่อแล้ว find ย้อนกลับด้วยชื่อ ถ้าชื่อซ้ำจะได้ id ผิด และถ้าหาไม่เจอจะ crash)
    const uniqueDivs = [...new Map(
        tree.filter(t => t.d_id).map(i => [i.d_id, { id: i.d_id, name: i.d_name }])
    ).values()];

    const filteredMachines = [...new Map(tree
        .filter(t => t.m_id && (!filters.division || String(t.d_id) === String(filters.division)))
        .map(i => [i.m_id, { id: i.m_id, name: i.m_name }])).values()];

    const filteredParts = [...new Map(tree
        .filter(t =>
            t.p_id &&
            (!filters.division || String(t.d_id) === String(filters.division)) &&
            (!filters.machine || String(t.m_id) === String(filters.machine))
        )
        .map(i => [i.p_id, { id: i.p_id, name: i.part_name }])).values()];

    // Final Specs to Show
    const displayedSpecs = tree.filter(t => {
        return t.s_id &&
               (!filters.division || String(t.d_id) === String(filters.division)) &&
               (!filters.machine || String(t.m_id) === String(filters.machine)) &&
               (!filters.part || String(t.p_id) === String(filters.part));
    });

    return (
        <Container fluid className="mt-3">
            {/* Filter Bar */}
            <Card className="mb-4 p-3 bg-light shadow-sm">
                <Row className="g-2">
                    <Col md={2}>
                        {/* เปลี่ยน Division ต้องล้าง Machine/Part ด้วย ไม่งั้นค้างค่าเก่าแล้วไม่มีกราฟขึ้นเลย */}
                        <Form.Select
                            value={filters.division}
                            onChange={e => setFilters({ ...filters, division: e.target.value, machine: '', part: '' })}
                        >
                            <option value="">All Divisions</option>
                            {uniqueDivs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </Form.Select>
                    </Col>
                    <Col md={2}>
                        <Form.Select
                            value={filters.machine}
                            onChange={e => setFilters({ ...filters, machine: e.target.value, part: '' })}
                        >
                            <option value="">All Machines</option>
                            {filteredMachines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </Form.Select>
                    </Col>
                    <Col md={3}>
                        <Form.Select
                            value={filters.part}
                            onChange={e => setFilters({ ...filters, part: e.target.value })}
                        >
                            <option value="">All Parts</option>
                            {filteredParts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Form.Select>
                    </Col>
                    <Col md={2}>
                         <Form.Control type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} />
                    </Col>
                    <Col md={2}>
                         <Form.Control type="date" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} />
                    </Col>
                </Row>
            </Card>

            {/* Charts Grid */}
            <Row>
                {displayedSpecs.length === 0 ? <p className="text-center text-muted">No specs match your filter.</p> :
                 displayedSpecs.map(spec => (
                    <Col md={6} xl={4} key={spec.s_id}>
                        {/* ส่ง Date Filter props ไปให้ Chart โหลดข้อมูลเอง */}
                        <SpcChart spec={spec} dateFilter={{start: filters.startDate, end: filters.endDate}} />
                    </Col>
                ))}
            </Row>
        </Container>
    );
};
export default Dashboard;
