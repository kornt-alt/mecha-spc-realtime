import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Form, Card } from 'react-bootstrap';
import { apiCall } from '../App';
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

    useEffect(() => {
        const load = async () => {
            const data = await apiCall('/master/tree');
            if(Array.isArray(data)) setTree(data);
        };
        load();
    }, []);

    // Filter Logic
    const uniqueDivs = [...new Map(tree.map(i => [i.d_id, i.d_name])).values()];
    
    const filteredMachines = [...new Map(tree
        .filter(t => !filters.division || t.d_id == filters.division)
        .map(i => [i.m_id, i.m_name])).values()].filter(x => x);

    const filteredParts = [...new Map(tree
        .filter(t => 
            (!filters.division || t.d_id == filters.division) &&
            (!filters.machine || t.m_id == filters.machine)
        )
        .map(i => [i.p_id, i.part_name])).values()].filter(x => x);

    // Final Specs to Show
    const displayedSpecs = tree.filter(t => {
        return t.s_id && 
               (!filters.division || t.d_id == filters.division) &&
               (!filters.machine || t.m_id == filters.machine) &&
               (!filters.part || t.p_id == filters.part);
    });

    return (
        <Container fluid className="mt-3">
            {/* Filter Bar */}
            <Card className="mb-4 p-3 bg-light shadow-sm">
                <Row className="g-2">
                    <Col md={2}>
                        <Form.Select onChange={e => setFilters({...filters, division: e.target.value})}>
                            <option value="">All Divisions</option>
                            {uniqueDivs.map(d => <option key={d} value={tree.find(x=>x.d_name===d).d_id}>{d}</option>)}
                        </Form.Select>
                    </Col>
                    <Col md={2}>
                        <Form.Select onChange={e => setFilters({...filters, machine: e.target.value})}>
                            <option value="">All Machines</option>
                            {filteredMachines.map(m => <option key={m} value={tree.find(x=>x.m_name===m).m_id}>{m}</option>)}
                        </Form.Select>
                    </Col>
                    <Col md={3}>
                        <Form.Select onChange={e => setFilters({...filters, part: e.target.value})}>
                            <option value="">All Parts</option>
                            {filteredParts.map(p => <option key={p} value={tree.find(x=>x.part_name===p).p_id}>{p}</option>)}
                        </Form.Select>
                    </Col>
                    <Col md={2}>
                         <Form.Control type="date" onChange={e => setFilters({...filters, startDate: e.target.value})} />
                    </Col>
                    <Col md={2}>
                         <Form.Control type="date" onChange={e => setFilters({...filters, endDate: e.target.value})} />
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