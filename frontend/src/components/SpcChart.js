import React, { useEffect, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { io } from 'socket.io-client';
import { apiCall, BACKEND_URL } from '../App';
import { Badge } from 'react-bootstrap';

// Setup Socket (ต่อครั้งเดียวพอนอก component)
const socket = io(undefined, { 
    path: '/Mecha-Spc-Realtime/socket.io',
    reconnection: true
});

// const socket = io('http://localhost:5000', { 
//     path: '/Mecha-Spc-Realtime/socket.io',
//     transports: ['websocket', 'polling'] // แนะนำให้ใส่ เพื่อพยายามใช้ websocket ก่อน
// });

const SpcChart = ({ spec, dateFilter = {} }) => {
    const [data, setData] = useState([]);

    useEffect(() => {
        let query = '';
        if (dateFilter?.start && dateFilter?.end) {
            query = `?start=${dateFilter.start}&end=${dateFilter.end}`;
        }

        apiCall(`/spc/${spec.s_id}${query}`).then(res => setData(res));

        const channel = `spc_data_${spec.s_id}`;
        socket.on(channel, (newData) => {
            // ถ้ามีการ Filter วันที่ เราอาจจะเลือกไม่อัปเดต Realtime ก็ได้
            // แต่ถ้าไม่ได้ Filter ก็ให้ต่อท้ายข้อมูลไป
            if (!dateFilter.start) {
                setData(newData); 
            }
        });

        return () => socket.off(channel);
    }, [spec.s_id, dateFilter?.start, dateFilter?.end]);

    // ฟังก์ชันคำนวณ Cp/Cpk
    const stats = useMemo(() => {
        if (!data || data.length < 2) return { cp: '-', cpk: '-', mean: '-', sigma: '-' };

        // 1. หาค่าเฉลี่ย (Mean)
        const values = data.map(d => parseFloat(d.value));
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;

        // 2. หา Standard Deviation (Sample SD)
        const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (values.length - 1);
        const sigma = Math.sqrt(variance);

        // 3. คำนวณ Cp
        // Cp = (USL - LSL) / (6 * Sigma)
        const cp = (spec.ucl - spec.lcl) / (6 * sigma);

        // 4. คำนวณ Cpk
        // Cpu = (USL - Mean) / (3 * Sigma)
        // Cpl = (Mean - LSL) / (3 * Sigma)
        const cpu = (spec.ucl - mean) / (3 * sigma);
        const cpl = (mean - spec.lcl) / (3 * sigma);
        const cpk = Math.min(cpu, cpl);

        return {
            mean: mean.toFixed(4),
            sigma: sigma.toFixed(4),
            cp: cp.toFixed(3),
            cpk: cpk.toFixed(3)
        };
    }, [data, spec.ucl, spec.lcl]);

    // Custom Tooltip
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const dataPoint = payload[0].payload;
            return (
                <div className="custom-tooltip bg-white p-2 border shadow-sm" style={{fontSize: '0.85rem'}}>
                    <div><strong>Round:</strong> {dataPoint.sampling_no}</div>
                    <div><strong>Value:</strong> {dataPoint.value}</div>
                    <div className="text-primary"><strong>Lot:</strong> {dataPoint.lot_no || '-'}</div>
                    <div className="text-muted small">{new Date(dataPoint.measured_at).toLocaleString('TH-th', { timeZone: 'Asia/Bangkok' })}</div>
                </div>
            );
        }
        return null;
    };

    // Helper เลือกสี Badge ตามค่า Cpk (มาตรฐานทั่วไป > 1.33 คือดี)
    const getCpkColor = (val) => {
        if (val === '-') return 'secondary';
        const num = parseFloat(val);
        if (num >= 1.67) return 'success'; // ดีเยี่ยม
        if (num >= 1.33) return 'primary'; // ยอมรับได้
        if (num >= 1.00) return 'warning'; // พอใช้ (ต้องระวัง)
        return 'danger'; // แย่
    };

    return (
        <div className="card mb-3 shadow-sm">
            <div className="card-header bg-dark text-white">
                <div className="d-flex justify-content-between align-items-start">
                    <div>
                        <h6 className="mb-1">{spec.part_name} - {spec.spec_name}</h6>
                        <small className="text-white-50">Limit: {spec.lcl} ~ {spec.ucl} | Target: {spec.target}</small>
                    </div>
                    {/* ✅ ส่วนแสดงค่า Cp/Cpk */}
                    <div className="text-end">
                        <Badge bg="light" text="dark" className="me-1">Cp: {stats.cp}</Badge>
                        <Badge bg={getCpkColor(stats.cpk)}>Cpk: {stats.cpk}</Badge>
                    </div>
                </div>
            </div>
            
            <div className="card-body position-relative" style={{ height: 350 }}>
                {/* แสดงค่า Mean/Sigma เล็กๆ มุมกราฟ */}
                <div className="position-absolute top-0 end-0 p-2 me-3 mt-1" style={{zIndex: 10, fontSize: '0.75rem', opacity: 0.7}}>
                    <div>μ: {stats.mean}</div>
                    <div>σ: {stats.sigma}</div>
                    <div>N: {data.length}</div>
                </div>

                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="sampling_no" tick={{fontSize: 12}} />
                        <YAxis domain={['auto', 'auto']} tick={{fontSize: 12}} />
                        <Tooltip content={<CustomTooltip />} />
                        
                        {/* Control Limits */}
                        <ReferenceLine y={spec.ucl} label={{value:'USL', fill:'red', fontSize:10}} stroke="red" strokeDasharray="3 3" />
                        <ReferenceLine y={spec.target} label={{value:'Tg', fill:'green', fontSize:10}} stroke="green" strokeDasharray="5 5" />
                        <ReferenceLine y={spec.lcl} label={{value:'LSL', fill:'red', fontSize:10}} stroke="red" strokeDasharray="3 3" />
                        
                        {/* เส้น Mean ที่คำนวณได้จริง (สีส้มจางๆ) */}
                        {stats.mean !== '-' && (
                            <ReferenceLine y={stats.mean} stroke="orange" strokeDasharray="3 3" />
                        )}

                        <Line 
                            type="monotone" 
                            dataKey="value" 
                            stroke="#007bff" 
                            strokeWidth={2} 
                            dot={{r: 3}} 
                            activeDot={{r: 6}}
                            isAnimationActive={false} 
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default SpcChart;