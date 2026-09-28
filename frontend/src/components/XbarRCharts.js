// frontend/src/components/XbarRCharts.js — กราฟคู่ X̄ (หรือ I) บน / R (หรือ MR) ล่าง ของจุดตรวจหนึ่งจุด
//
// แยกออกมาจาก ControlChart.js เพื่อให้หน้า Dashboard (การ์ดเล็ก) กับหน้า SC Chart (ฟอร์ม SP-QC-214C)
// วาดกราฟชุดเดียวกัน — สี / ทศนิยม / การวาดจุดที่ผิดกฎ ต้องมีที่เดียว
//
// ⚠️ ไฟล์นี้ไม่คำนวณสถิติอะไรเลย ทุกตัวเลขมาจาก GET /api/charts/:id ที่ backend คิดมาให้แล้ว
import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { capTone } from '../utils/capability';

// ⚠️ ต้องตรงกับ token ใน src/styles/tokens.css — recharts รับเป็นสตริงสีเท่านั้น
//    ใส่ var(--x) ตรง ๆ ไม่ได้เพราะค่าถูกเขียนลง attribute ของ SVG
export const C = {
  data: '#1B4FA0',        // --blue      ค่าที่วัดได้
  spec: '#C42032',        // --red       spec limit (USL/LSL)
  control: '#C87F00',     // --amber-line control limit (UCL/LCL) + จุดที่ผิดกฎ
  center: '#5A6779',      // --muted     เส้นกลาง (เดิมเป็นเขียว ย้ายมาเป็นกลาง ๆ)
  target: '#0B1F3A',      // --ink       เป้า
  grid: '#D3D9E3',        // --line
};

// ⚠️ สองค่านี้ต้องเท่ากันทั้งกราฟบนและล่างเสมอ ไม่งั้นพื้นที่วาดสองอันเหลื่อมกันในแนวนอน
//    แล้วจุด subgroup เดียวกันจะไม่อยู่ตรงคอลัมน์เดียวกัน — ห้ามเปลี่ยนเป็น width="auto"
//    (ตัวเลขบนแกน X̄ กับบนแกน R ยาวไม่เท่ากัน auto จะให้ความกว้างคนละค่า)
const Y_AXIS_WIDTH = 58;
const CHART_MARGIN = { top: 4, right: 44, bottom: 0, left: 0 };

// ⚠️ ต้องมี tickFormatter เสมอ — yDomain คิดจาก min/max บวกลบ padding ที่เป็นทศนิยม
//    ผลลัพธ์ออกมาเป็นค่าอย่าง 10.050000000000002 แล้ว recharts พิมพ์เต็มความยาว
//    ป้ายจะล้นออกนอกแกนจนอ่านไม่ออก (เห็นเป็น "0000002" ค้างอยู่ริมซ้าย)
export const decimalsOf = (...values) => {
  let max = 0;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const s = String(v);
    const dot = s.indexOf('.');
    if (dot >= 0) max = Math.max(max, s.length - dot - 1);
  }
  return Math.min(Math.max(max, 2), 4);
};

export const fmt = (v, d = 4) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
export const fmtCap = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—');

// เกณฑ์มาจาก chart.capabilityTarget (ลูกค้า / override ของ item / ค่าระบบ) — ไม่ hardcode ที่นี่
// ถึงเกณฑ์ = ปกติ ไม่ต้องมีสี · ต่ำกว่าเกณฑ์ = เหลือง · ต่ำกว่า 1.0 = แดง
const CAP_CLASS = { none: 'text-muted', ok: '', below: 'text-warning', poor: 'text-danger' };
export const capClass = (v, min) => CAP_CLASS[capTone(v, min)];

const ChartTooltip = ({ active, payload, unit }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const m = p.meta ?? {};

  return (
    <div className="bg-white border p-2" style={{ fontSize: '0.8rem', maxWidth: 260 }}>
      <div className="fw-bold mb-1">Subgroup #{p.subgroupNo}</div>
      <div className="num">X̄: <strong>{fmt(p.xbar)}</strong>{unit ? ` ${unit}` : ''}</div>
      {p.range !== null && p.range !== undefined && <div className="num">R: {fmt(p.range)}</div>}
      {p.values?.length > 1 && (
        <div className="text-muted num">ค่าทุกชิ้น: {p.values.map((v) => fmt(v, 3)).join(', ')}</div>
      )}
      <hr className="my-1" />
      <div>MO: <strong>{m.moNo ?? '—'}</strong></div>
      <div>Lot: {m.lotNo ?? '—'} · กะ {m.shift ?? '—'}</div>
      <div>ผู้ตรวจ: {m.inspector ?? '—'}</div>
      <div>เครื่อง: {m.machine ?? '—'}</div>
      <div className="text-muted">
        {m.inspectedAt ? new Date(m.inspectedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '—'}
      </div>
    </div>
  );
};

// จุดที่ผิดกฎ OCS วาดเป็นวงเหลืองใหญ่ ที่เหลือเป็นจุดเล็กสีข้อมูล
// rulesKey: 'rules' = กฎของกราฟบน (X̄/I) · 'rangeRules' = กฎของกราฟล่าง (R/MR) — backend ตัดสินแยกกัน
export const dotFor = (payloadKey, rulesKey = 'rules') => (props) => {
  const { cx, cy, payload, index } = props;
  if (cx === null || cy === null || payload?.[payloadKey] === null) return null;
  const bad = payload?.[rulesKey]?.length > 0;
  return (
    <circle
      key={`dot-${index}`}
      cx={cx} cy={cy}
      r={bad ? 5.5 : 3}
      fill={bad ? C.control : C.data}
      stroke={bad ? '#fff' : 'none'}
      strokeWidth={bad ? 1.5 : 0}
    />
  );
};

// แถบอธิบายเส้น — เขียนเป็น HTML/SVG เอง ไม่ใช้ <Legend> ของ recharts
// เหตุผล: <Legend> รับ payload จาก Line/Bar/Area เท่านั้น ReferenceLine ไม่ส่งอะไรเข้าไปเลย
// สิ่งที่ต้องอธิบายจริง ๆ คือ "แดงทึบ = spec · เหลืองประ = control" ซึ่งเป็น ReferenceLine ล้วน
// อีกอย่าง <Legend> กินความสูงในพื้นที่วาด ทำให้กราฟบนกับล่างสูงไม่เท่ากัน
const ChartLegend = ({ hasSpec, hasTarget, provisional }) => (
  <div className="chart-legend">
    <span className="chart-legend__key">
      <span className="chart-legend__swatch" style={{ borderTopColor: C.data }} />
      ค่าที่วัดได้
    </span>
    {hasSpec && (
      <span className="chart-legend__key">
        <span className="chart-legend__swatch" style={{ borderTopColor: C.spec }} />
        spec limit (USL/LSL)
      </span>
    )}
    <span className="chart-legend__key">
      <span
        className="chart-legend__swatch"
        style={{ borderTopColor: C.control, borderTopStyle: 'dashed' }}
      />
      {/* ⚠️ อย่าเขียนคำว่า provisional ซ้ำตรงนี้ — ข้อความเตือนด้านบนใช้คำนั้นอยู่
          getByText(/provisional/) ในเทสจะเจอสองที่แล้ว throw */}
      control limit (UCL/LCL){provisional ? ' — ยังไม่ล็อก' : ''}
    </span>
    {hasTarget && (
      <span className="chart-legend__key">
        <span
          className="chart-legend__swatch"
          style={{ borderTopColor: C.target, borderTopStyle: 'dotted' }}
        />
        เป้า
      </span>
    )}
  </div>
);

// chart = ผลของ GET /api/charts/:id (variable ที่มี limits และ points แล้ว — ผู้เรียกเช็คก่อน)
// syncId ผูก tooltip ของกราฟบน-ล่างเข้าด้วยกัน · showLegend ปิดได้เมื่อหน้าที่ใช้มีคำอธิบายเส้นของตัวเอง
const XbarRCharts = ({ chart, height = 190, showLegend = true }) => {
  const cp = chart.checkpoint;
  const { points = [], limits } = chart;
  const syncId = `cp-${cp.id}`;
  const isImr = limits.mode === 'i-mr';
  const limitDash = limits.provisional ? '6 4' : '4 2';

  const yValues = [
    ...points.map((p) => p.xbar),
    limits.ucl, limits.lcl, cp.usl, cp.lsl, cp.target,
  ].filter((v) => typeof v === 'number' && Number.isFinite(v));
  const pad = (Math.max(...yValues) - Math.min(...yValues)) * 0.08 || 0.01;
  const yDomain = [Math.min(...yValues) - pad, Math.max(...yValues) + pad];

  const hasSpec = typeof cp.usl === 'number' || typeof cp.lsl === 'number';

  // ทศนิยมบนแกน — อิงจากสเปกกับค่าจริง ไม่ใช่ตัวเลขที่ padding ทำให้ยาวเฟ้อ
  const yDp = decimalsOf(cp.usl, cp.lsl, cp.target, limits.ucl, limits.lcl);
  const rDp = decimalsOf(limits.rangeUcl, limits.rangeCenter);
  const tickFmt = (dp) => (v) => (typeof v === 'number' ? v.toFixed(dp) : v);

  return (
    <>
        {/* ── กราฟบน: X̄ หรือ Individual ──
            ⚠️ ซ่อนแกน X ของกราฟบน ให้วาดครั้งเดียวที่กราฟล่าง (ของเดิมวาดสองรอบ)
               ใช้ hide ไม่ใช่ลบ <XAxis> ทิ้ง — ถ้าลบ recharts จะ fallback ไป implicit axis
               ที่ไม่มี dataKey แล้ว tooltip หา category ไม่เจอ
               การซ่อนกระทบแค่ offset แนวตั้ง ไม่ขยับขอบซ้าย/ขวา จึงยังตรงกับกราฟล่าง */}
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={points} syncId={syncId} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
            <XAxis dataKey="subgroupNo" hide />
            <YAxis domain={yDomain} tick={{ fontSize: 10 }} width={Y_AXIS_WIDTH} tickFormatter={tickFmt(yDp)} />
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
              <ReferenceLine y={cp.target} stroke={C.target} strokeDasharray="2 3" strokeOpacity={0.55}
                label={{ value: 'Tg', position: 'right', fill: C.target, fontSize: 10 }} />
            )}

            {/* control limit — เหลืองประ (ประห่างกว่าเมื่อยัง provisional) */}
            <ReferenceLine y={limits.ucl} stroke={C.control} strokeDasharray={limitDash}
              label={{ value: 'UCL', position: 'right', fill: C.control, fontSize: 10 }} />
            <ReferenceLine y={limits.lcl} stroke={C.control} strokeDasharray={limitDash}
              label={{ value: 'LCL', position: 'right', fill: C.control, fontSize: 10 }} />
            <ReferenceLine y={limits.center} stroke={C.center}
              label={{ value: isImr ? 'x̄' : 'X̿', position: 'right', fill: C.center, fontSize: 10 }} />

            <Line type="linear" dataKey="xbar" stroke={C.data} strokeWidth={2}
              dot={dotFor('xbar')} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>

        {/* ── กราฟล่าง: R หรือ Moving Range ── แกน X ตัวจริงอยู่ที่นี่ ── */}
        <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
          {isImr ? 'Moving Range' : 'Range'}
        </div>
        <ResponsiveContainer width="100%" height={Math.round(height * 0.62)}>
          <LineChart data={points} syncId={syncId} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
            <XAxis dataKey="subgroupNo" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={Y_AXIS_WIDTH} tickFormatter={tickFmt(rDp)} />
            <Tooltip content={<ChartTooltip unit={cp.unit} />} />

            <ReferenceLine y={limits.rangeUcl} stroke={C.control} strokeDasharray={limitDash}
              label={{ value: 'UCL', position: 'right', fill: C.control, fontSize: 10 }} />
            <ReferenceLine y={limits.rangeCenter} stroke={C.center}
              label={{ value: isImr ? 'M̄R' : 'R̄', position: 'right', fill: C.center, fontSize: 10 }} />
            {limits.rangeLcl > 0 && (
              <ReferenceLine y={limits.rangeLcl} stroke={C.control} strokeDasharray={limitDash}
                label={{ value: 'LCL', position: 'right', fill: C.control, fontSize: 10 }} />
            )}

            <Line type="linear" dataKey="range" stroke={C.data} strokeWidth={1.6} strokeOpacity={0.65}
              dot={dotFor('range', 'rangeRules')} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>

        {showLegend && <ChartLegend hasSpec={hasSpec} hasTarget={typeof cp.target === 'number'} provisional={limits.provisional} />}
    </>
  );
};

export default XbarRCharts;
