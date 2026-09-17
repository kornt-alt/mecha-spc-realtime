// frontend/src/components/ControlChart.js — กราฟ control chart ของจุดตรวจหนึ่งจุด
//
// n >= 2 → X̄ บน / R ล่าง · n = 1 → Individual บน / Moving Range ล่าง
// กราฟสองตัวใช้ syncId เดียวกัน ชี้จุดไหนขึ้น tooltip ตรงกันทั้งคู่
//
// ⚠️ ไฟล์นี้ไม่คำนวณสถิติอะไรเลย ทุกตัวเลขมาจาก GET /api/charts/:id ที่ backend คิดมาให้แล้ว
//    (ตาราง A2/D3/D4 กับสูตร Cp/Cpk ต้องมีชุดเดียวในระบบ — อยู่ที่ backend/services/spcStats.js)
//
// ⚠️ สองชุดเส้นที่ห้ามปนกันเด็ดขาด:
//    เส้นส้มประ = control limit (UCL/LCL) คำนวณจากข้อมูลจริง บอกว่ากระบวนการเปลี่ยนไหม
//    เส้นแดงทึบ = spec limit (USL/LSL) มาจากแบบ บอกว่าชิ้นงานผ่านไหม
//    ระบบเดิมวาดเส้นเดียวแล้วติดป้าย USL ทั้งที่เก็บในคอลัมน์ชื่อ ucl — นั่นคือบั๊กที่ rewrite นี้มาแก้
import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { Card, Badge, Alert } from 'react-bootstrap';

const C = {
  data: '#0d6efd',
  center: '#198754',
  control: '#fd7e14',   // control limit — ส้ม
  spec: '#dc3545',      // spec limit — แดง
  target: '#20c997',
  violation: '#dc3545',
};

const fmt = (v, d = 4) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
const fmtCap = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—');

// สี badge ตามเกณฑ์ Cpk ที่ใช้กันทั่วไป
const cpkVariant = (v) => {
  if (typeof v !== 'number') return 'secondary';
  if (v >= 1.67) return 'success';
  if (v >= 1.33) return 'primary';
  if (v >= 1.0) return 'warning';
  return 'danger';
};

// คำอธิบายกฎ Nelson แบบสั้น ไว้โชว์ใน tooltip — ตัวเลขเปล่า ๆ ไม่มีใครจำได้ว่าข้อไหนคืออะไร
const RULE_TEXT = {
  1: 'หลุด 3σ',
  2: '9 จุดอยู่ข้างเดียว',
  3: '6 จุดไต่ทางเดียว',
  4: '14 จุดสลับขึ้นลง',
  5: '2 ใน 3 จุดเกิน 2σ',
  6: '4 ใน 5 จุดเกิน 1σ',
  7: '15 จุดชิดเส้นกลาง',
  8: '8 จุดห่างเส้นกลาง',
};

const ChartTooltip = ({ active, payload, unit }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const m = p.meta ?? {};

  return (
    <div className="bg-white border shadow-sm p-2" style={{ fontSize: '0.8rem', maxWidth: 260 }}>
      <div className="fw-bold mb-1">Subgroup #{p.subgroupNo}</div>
      <div>X̄: <strong>{fmt(p.xbar)}</strong>{unit ? ` ${unit}` : ''}</div>
      {p.range !== null && p.range !== undefined && <div>R: {fmt(p.range)}</div>}
      {p.values?.length > 1 && (
        <div className="text-muted">ค่าทุกชิ้น: {p.values.map((v) => fmt(v, 3)).join(', ')}</div>
      )}
      <hr className="my-1" />
      <div>MO: <strong>{m.moNo ?? '—'}</strong></div>
      <div>Lot: {m.lotNo ?? '—'} · กะ {m.shift ?? '—'}</div>
      <div>ผู้ตรวจ: {m.inspector ?? '—'}</div>
      <div>เครื่อง: {m.machine ?? '—'}</div>
      <div className="text-muted">
        {m.inspectedAt ? new Date(m.inspectedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '—'}
      </div>
      {p.rules?.length > 0 && (
        <div className="text-danger mt-1">
          ⚠ ผิดกฎ: {p.rules.map((r) => `${r} (${RULE_TEXT[r] ?? ''})`).join(', ')}
        </div>
      )}
    </div>
  );
};

// จุดที่ผิดกฎ Nelson วาดเป็นวงแดงใหญ่ ที่เหลือเป็นจุดเล็กปกติ
const dotFor = (payloadKey) => (props) => {
  const { cx, cy, payload, index } = props;
  if (cx === null || cy === null || payload?.[payloadKey] === null) return null;
  const bad = payload?.rules?.length > 0;
  return (
    <circle
      key={`dot-${index}`}
      cx={cx} cy={cy}
      r={bad ? 5 : 3}
      fill={bad ? C.violation : C.data}
      stroke={bad ? '#fff' : 'none'}
      strokeWidth={bad ? 1.5 : 0}
    />
  );
};

const ControlChart = ({ chart, height = 190 }) => {
  const cp = chart?.checkpoint;
  if (!cp) return null;

  // จุด attribute ไม่มีค่าตัวเลข วาด control chart ไม่ได้ — โชว์สรุป %NG แทน
  if (chart.mode === 'attribute') {
    return (
      <Card className="mb-3 h-100">
        <Card.Header className="bg-dark text-white py-2">
          <div className="fw-bold small">{cp.seq_no}. {cp.name}</div>
          <div className="text-white-50" style={{ fontSize: '0.75rem' }}>ตรวจด้วยตา (attribute)</div>
        </Card.Header>
        <Card.Body className="text-center">
          <div className="display-6">{chart.ngCount ?? 0} / {chart.total ?? 0}</div>
          <div className="text-muted small">จำนวน NG จากที่ตรวจทั้งหมด</div>
          <Badge bg={chart.ngCount > 0 ? 'danger' : 'success'} className="mt-2">
            %NG {chart.ngRate !== null && chart.ngRate !== undefined ? (chart.ngRate * 100).toFixed(1) : '0.0'}%
          </Badge>
        </Card.Body>
      </Card>
    );
  }

  if (chart.error) {
    return (
      <Card className="mb-3">
        <Card.Header className="bg-dark text-white py-2">
          <div className="fw-bold small">{cp.seq_no}. {cp.name}</div>
        </Card.Header>
        <Card.Body><Alert variant="warning" className="mb-0 small">{chart.error}</Alert></Card.Body>
      </Card>
    );
  }

  const { points = [], limits, capability = {} } = chart;

  if (!limits || points.length === 0) {
    return (
      <Card className="mb-3">
        <Card.Header className="bg-dark text-white py-2">
          <div className="fw-bold small">{cp.seq_no}. {cp.name}</div>
        </Card.Header>
        <Card.Body className="text-muted text-center small py-4">ยังไม่มีข้อมูลค่าวัดในช่วงที่เลือก</Card.Body>
      </Card>
    );
  }

  const syncId = `cp-${cp.id}`;
  const isImr = limits.mode === 'i-mr';
  const outOfControl = (chart.violations ?? []).length > 0;
  const limitDash = limits.provisional ? '6 4' : undefined;

  // แกน Y ของกราฟบนต้องครอบทั้ง control limit และ spec limit ไม่งั้นเส้นแดงหลุดออกนอกจอ
  const yValues = [
    ...points.map((p) => p.xbar),
    limits.ucl, limits.lcl, cp.usl, cp.lsl, cp.target,
  ].filter((v) => typeof v === 'number' && Number.isFinite(v));
  const pad = (Math.max(...yValues) - Math.min(...yValues)) * 0.08 || 0.01;
  const yDomain = [Math.min(...yValues) - pad, Math.max(...yValues) + pad];

  return (
    <Card className="mb-3">
      <Card.Header className="bg-dark text-white py-2">
        <div className="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div className="fw-bold small">
              {cp.is_critical && '🔴 '}{cp.seq_no}. {cp.name}
            </div>
            <div className="text-white-50" style={{ fontSize: '0.72rem' }}>
              สเปก {cp.lsl ?? '—'} ~ {cp.usl ?? '—'}{cp.unit ? ` ${cp.unit}` : ''}
              {cp.target !== null && ` · เป้า ${cp.target}`}
              {' · '}{isImr ? 'I-MR (n=1)' : `X̄-R (n=${limits.n})`}
            </div>
          </div>
          <div className="text-end" style={{ fontSize: '0.72rem' }}>
            {/* สองสถานะนี้แยกกัน: ในสเปก ≠ in control */}
            <Badge bg={outOfControl ? 'danger' : 'success'} className="mb-1">
              {outOfControl ? 'Out of control' : 'In control'}
            </Badge>
            <div>
              <Badge bg={cpkVariant(capability.cpk)} className="me-1">Cpk {fmtCap(capability.cpk)}</Badge>
              <Badge bg="light" text="dark">Ppk {fmtCap(capability.ppk)}</Badge>
            </div>
          </div>
        </div>
      </Card.Header>

      <Card.Body className="p-2">
        {limits.provisional && (
          <div className="text-warning small mb-1">
            ⚠ ลิมิตยังเป็น provisional (มี {limits.subgroupCount} subgroup จากที่ควรมี {limits.minBaselineSubgroups})
            — ยังไม่ได้ล็อก baseline เส้นจะขยับตามข้อมูล
          </div>
        )}

        {/* ── กราฟบน: X̄ หรือ Individual ── */}
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={points} syncId={syncId} margin={{ top: 4, right: 44, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="subgroupNo" tick={{ fontSize: 10 }} />
            <YAxis domain={yDomain} tick={{ fontSize: 10 }} width={54} />
            <Tooltip content={<ChartTooltip unit={cp.unit} />} />

            {/* spec limit — แดงทึบ */}
            {typeof cp.usl === 'number' && (
              <ReferenceLine y={cp.usl} stroke={C.spec} strokeWidth={1.5}
                label={{ value: 'USL', position: 'right', fill: C.spec, fontSize: 10 }} />
            )}
            {typeof cp.lsl === 'number' && (
              <ReferenceLine y={cp.lsl} stroke={C.spec} strokeWidth={1.5}
                label={{ value: 'LSL', position: 'right', fill: C.spec, fontSize: 10 }} />
            )}
            {typeof cp.target === 'number' && (
              <ReferenceLine y={cp.target} stroke={C.target} strokeDasharray="5 5"
                label={{ value: 'Tg', position: 'right', fill: C.target, fontSize: 10 }} />
            )}

            {/* control limit — ส้มประ (ประถี่กว่าเมื่อยัง provisional) */}
            <ReferenceLine y={limits.ucl} stroke={C.control} strokeDasharray={limitDash ?? '4 2'}
              label={{ value: 'UCL', position: 'right', fill: C.control, fontSize: 10 }} />
            <ReferenceLine y={limits.lcl} stroke={C.control} strokeDasharray={limitDash ?? '4 2'}
              label={{ value: 'LCL', position: 'right', fill: C.control, fontSize: 10 }} />
            <ReferenceLine y={limits.center} stroke={C.center}
              label={{ value: isImr ? 'x̄' : 'X̿', position: 'right', fill: C.center, fontSize: 10 }} />

            <Line type="linear" dataKey="xbar" stroke={C.data} strokeWidth={2}
              dot={dotFor('xbar')} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>

        {/* ── กราฟล่าง: R หรือ Moving Range ── */}
        <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
          {isImr ? 'Moving Range' : 'Range'}
        </div>
        <ResponsiveContainer width="100%" height={Math.round(height * 0.62)}>
          <LineChart data={points} syncId={syncId} margin={{ top: 2, right: 44, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="subgroupNo" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={54} />
            <Tooltip content={<ChartTooltip unit={cp.unit} />} />

            <ReferenceLine y={limits.rangeUcl} stroke={C.control} strokeDasharray={limitDash ?? '4 2'}
              label={{ value: 'UCL', position: 'right', fill: C.control, fontSize: 10 }} />
            <ReferenceLine y={limits.rangeCenter} stroke={C.center}
              label={{ value: isImr ? 'M̄R' : 'R̄', position: 'right', fill: C.center, fontSize: 10 }} />
            {limits.rangeLcl > 0 && (
              <ReferenceLine y={limits.rangeLcl} stroke={C.control} strokeDasharray={limitDash ?? '4 2'}
                label={{ value: 'LCL', position: 'right', fill: C.control, fontSize: 10 }} />
            )}

            <Line type="linear" dataKey="range" stroke="#6f42c1" strokeWidth={1.8}
              dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>

        <div className="d-flex justify-content-between text-muted mt-1" style={{ fontSize: '0.7rem' }}>
          <span>
            Cp {fmtCap(capability.cp)} · Cpk {fmtCap(capability.cpk)}
            {' | '}Pp {fmtCap(capability.pp)} · Ppk {fmtCap(capability.ppk)}
          </span>
          <span>
            σ(within) {fmt(capability.sigmaWithin, 4)} · σ(overall) {fmt(capability.sigmaOverall, 4)}
            {' · '}{points.length} subgroup
          </span>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ControlChart;
