import React, { useEffect, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { apiCall } from '../App';
import socket from '../utils/socket';
import { normalizeMeasures } from '../utils/normalize';
import { Badge } from 'react-bootstrap';

const SpcChart = ({ spec, dateFilter = {} }) => {
    const [data, setData] = useState([]);

    // backend กรองวันที่เมื่อส่งมาครบทั้งคู่เท่านั้น ฝั่งนี้จึงต้องใช้เงื่อนไขเดียวกัน
    // ไม่งั้นกรอกแค่วันเริ่ม = ไม่กรองด้วย ไม่รับ realtime ด้วย กราฟค้างเฉย ๆ
    const hasDateFilter = Boolean(dateFilter?.start && dateFilter?.end);

    useEffect(() => {
        const query = hasDateFilter
            ? `?start=${encodeURIComponent(dateFilter.start)}&end=${encodeURIComponent(dateFilter.end)}`
            : '';

        apiCall(`/spc/${spec.s_id}${query}`)
            .then(res => setData(normalizeMeasures(res)))
            .catch(err => console.error('Load spc data failed', err));

        const channel = `spc_data_${spec.s_id}`;
        const handler = (newData) => {
            // ถ้ากำลังกรองวันที่อยู่ ไม่ต้องทับข้อมูลที่กรองไว้
            if (!hasDateFilter) {
                setData(normalizeMeasures(newData));
            }
        };
        socket.on(channel, handler);

        return () => socket.off(channel, handler);
    }, [spec.s_id, hasDateFilter, dateFilter?.start, dateFilter?.end]);

    // ฟังก์ชันคำนวณ Cp/Cpk
    const stats = useMemo(() => {
        const empty = { cp: '-', cpk: '-', mean: '-', sigma: '-' };
        const values = (data || []).map(d => d.value).filter(v => typeof v === 'number');
        if (values.length < 2) return empty;

        // 1. หาค่าเฉลี่ย (Mean)
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;

        // 2. หา Standard Deviation (Sample SD)
        const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (values.length - 1);
        const sigma = Math.sqrt(variance);

        const base = { mean: mean.toFixed(4), sigma: sigma.toFixed(4), cp: '-', cpk: '-' };

        // ค่าวัดเท่ากันหมด → sigma = 0 → หารไม่ได้ (เดิมได้ Infinity)
        // และ ucl/lcl เป็น NULL ได้ตาม schema ต้องมีครบถึงจะคำนวณได้
        if (sigma === 0 || typeof spec.ucl !== 'number' || typeof spec.lcl !== 'number') return base;

        // 3. คำนวณ Cp
        // Cp = (USL - LSL) / (6 * Sigma)
        const cp = (spec.ucl - spec.lcl) / (6 * sigma);

        // 4. คำนวณ Cpk
        // Cpu = (USL - Mean) / (3 * Sigma)
        // Cpl = (Mean - LSL) / (3 * Sigma)
        const cpu = (spec.ucl - mean) / (3 * sigma);
        const cpl = (mean - spec.lcl) / (3 * sigma);
        const cpk = Math.min(cpu, cpl);

        return { ...base, cp: cp.toFixed(3), cpk: cpk.toFixed(3) };
    }, [data, spec.ucl, spec.lcl]);

    // Custom Tooltip
    const CustomTooltip = ({ active, payload }) => {
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

    const fmt = (v) => (typeof v === 'number' ? v : '-');

    return (
        <div className="card mb-3 shadow-sm">
            <div className="card-header bg-dark text-white">
                <div className="d-flex justify-content-between align-items-start">
                    <div>
                        <h6 className="mb-1">{spec.part_name} - {spec.spec_name}</h6>
                        <small className="text-white-50">Limit: {fmt(spec.lcl)} ~ {fmt(spec.ucl)} | Target: {fmt(spec.target)}</small>
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

                        {/* Control Limits — วาดเฉพาะเส้นที่มีค่าจริง (คอลัมน์เป็น NULL ได้) */}
                        {typeof spec.ucl === 'number' && (
                            <ReferenceLine y={spec.ucl} label={{value:'USL', fill:'red', fontSize:10}} stroke="red" strokeDasharray="3 3" />
                        )}
                        {typeof spec.target === 'number' && (
                            <ReferenceLine y={spec.target} label={{value:'Tg', fill:'green', fontSize:10}} stroke="green" strokeDasharray="5 5" />
                        )}
                        {typeof spec.lcl === 'number' && (
                            <ReferenceLine y={spec.lcl} label={{value:'LSL', fill:'red', fontSize:10}} stroke="red" strokeDasharray="3 3" />
                        )}

                        {/* เส้น Mean ที่คำนวณได้จริง (สีส้มจางๆ) */}
                        {stats.mean !== '-' && (
                            <ReferenceLine y={Number(stats.mean)} stroke="orange" strokeDasharray="3 3" />
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
