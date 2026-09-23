// frontend/src/components/ControlChart.js — กราฟ control chart ของจุดตรวจหนึ่งจุด
//
// n >= 2 → X̄ บน / R ล่าง · n = 1 → Individual บน / Moving Range ล่าง
// กราฟสองตัวใช้ syncId เดียวกัน ชี้จุดไหนขึ้น tooltip ตรงกันทั้งคู่
//
// ⚠️ ไฟล์นี้ไม่คำนวณสถิติอะไรเลย ทุกตัวเลขมาจาก GET /api/charts/:id ที่ backend คิดมาให้แล้ว
//    (ตาราง A2/D3/D4 กับสูตร Cp/Cpk ต้องมีชุดเดียวในระบบ — อยู่ที่ backend/services/spcStats.js)
//
// ⚠️ สองชุดเส้นที่ห้ามปนกันเด็ดขาด:
//    เส้นเหลืองประ = control limit (UCL/LCL) คำนวณจากข้อมูลจริง บอกว่ากระบวนการเปลี่ยนไหม
//    เส้นแดงทึบ   = spec limit (USL/LSL) มาจากแบบ บอกว่าชิ้นงานผ่านไหม
//    ระบบเดิมวาดเส้นเดียวแล้วติดป้าย USL ทั้งที่เก็บในคอลัมน์ชื่อ ucl — นั่นคือบั๊กที่ rewrite นี้มาแก้
//    และของเดิมยังใช้ "แดง" ทั้งกับ spec limit และกับจุดที่ผิดกฎ Nelson ซึ่งคนละเรื่องกัน
//    ตอนนี้ผิดกฎ = เหลือง (process เปลี่ยน ของยังไม่เสีย) หลุดสเปก = แดง (ของเสีย)
import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { Card, Badge, Alert } from 'react-bootstrap';
import { RULE_TEXT } from '../utils/spcRules';

// ⚠️ ต้องตรงกับ token ใน src/styles/tokens.css — recharts รับเป็นสตริงสีเท่านั้น
//    ใส่ var(--x) ตรง ๆ ไม่ได้เพราะค่าถูกเขียนลง attribute ของ SVG
const C = {
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
const decimalsOf = (...values) => {
  let max = 0;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const s = String(v);
    const dot = s.indexOf('.');
    if (dot >= 0) max = Math.max(max, s.length - dot - 1);
  }
  return Math.min(Math.max(max, 2), 4);
};

const fmt = (v, d = 4) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
const fmtCap = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—');

// เกณฑ์ Cpk ที่ฟอร์มของลูกค้าเขียนไว้ตรง ๆ: "CTF, min Cpk > 1.33"
const CPK_TARGET = 1.33;
const cpkClass = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'text-muted';
  if (v >= CPK_TARGET) return '';           // ถึงเกณฑ์ = ปกติ ไม่ต้องมีสี
  if (v >= 1.0) return 'text-warning';      // ต่ำกว่าเกณฑ์แต่ยังไม่วิกฤต
  return 'text-danger';
};

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

// จุดที่ผิดกฎ Nelson วาดเป็นวงเหลืองใหญ่ ที่เหลือเป็นจุดเล็กสีข้อมูล
const dotFor = (payloadKey) => (props) => {
  const { cx, cy, payload, index } = props;
  if (cx === null || cy === null || payload?.[payloadKey] === null) return null;
  const bad = payload?.rules?.length > 0;
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

// หัวการ์ด — ใช้ร่วมกันทุกสาขา เพื่อให้การ์ดที่ไม่มีข้อมูลหน้าตาไม่หลุดจากพวก
const ChartHead = ({ cp, sub, right }) => (
  <Card.Header className="bg-dark text-white py-2">
    <div className="d-flex justify-content-between align-items-start gap-2">
      <div className="flex-grow-1">
        {/* ⚠️ seq_no กับ name ต้องอยู่ใน element เดียวกัน เทสจับด้วย textContent รวม */}
        <div className="fw-bold small">
          {cp.seq_no}. {cp.name}
          {cp.is_critical && (
            <span className="badge bg-light text-dark ms-2" title="จุดวิกฤต — CTF">CTF</span>
          )}
        </div>
        {sub && <div className="text-white-50" style={{ fontSize: '0.72rem' }}>{sub}</div>}
      </div>
      {right}
    </div>
  </Card.Header>
);

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

const ControlChart = ({ chart, height = 190 }) => {
  const cp = chart?.checkpoint;
  if (!cp) return null;

  // จุด attribute ไม่มีค่าตัวเลข วาด control chart ไม่ได้ — โชว์สรุป %NG แทน
  // (GET /api/charts/:id คืน mode:'attribute' พร้อม limits/capability เป็น null)
  if (chart.mode === 'attribute') {
    const ngCount = chart.ngCount ?? 0;
    return (
      <Card className="mb-3 h-100 chart-card">
        <ChartHead cp={cp} sub="ตรวจด้วยตา (attribute)" />
        <Card.Body className="text-center">
          {/* ⚠️ ต้องอยู่ใน element เดียว ห้ามแยก span ครอบตัวเลข เทสจับสตริง "2 / 10" */}
          <div className="display-6 num">{ngCount} / {chart.total ?? 0}</div>
          <div className="text-muted small">จำนวน NG จากที่ตรวจทั้งหมด</div>
          <div className="mt-2">
            <span className={`verdict ${ngCount > 0 ? 'verdict--ng' : 'verdict--ok'}`}>
              %NG {chart.ngRate !== null && chart.ngRate !== undefined ? (chart.ngRate * 100).toFixed(1) : '0.0'}%
            </span>
          </div>
        </Card.Body>
      </Card>
    );
  }

  if (chart.error) {
    return (
      <Card className="mb-3 chart-card">
        <ChartHead cp={cp} />
        <Card.Body><Alert variant="warning" className="mb-0 small">{chart.error}</Alert></Card.Body>
      </Card>
    );
  }

  const { points = [], limits, capability = {} } = chart;

  if (!limits || points.length === 0) {
    return (
      <Card className="mb-3 chart-card">
        <ChartHead cp={cp} />
        <Card.Body className="text-muted text-center small py-4">ยังไม่มีข้อมูลค่าวัดในช่วงที่เลือก</Card.Body>
      </Card>
    );
  }

  const syncId = `cp-${cp.id}`;
  const isImr = limits.mode === 'i-mr';
  const violations = chart.violations ?? [];
  const outOfControl = violations.length > 0;
  const limitDash = limits.provisional ? '6 4' : '4 2';

  // รวมกฎที่ผิดเป็นรายข้อ พร้อมบอกว่า subgroup ไหนบ้าง
  // ⚠️ ของเดิมข้อมูลนี้อยู่ใน tooltip อย่างเดียว ต้อง hover จุดถึงจะเห็น
  //    จอสัมผัสหน้าไลน์แตะไม่ติด และ ResponsiveContainer ใน jsdom สูง 0 เทสก็เข้าไม่ถึง
  //    จึงต้องอยู่นอกกราฟเป็นข้อความ
  const ruleHits = new Map();
  for (const v of violations) {
    for (const r of v.rules ?? []) {
      if (!ruleHits.has(r)) ruleHits.set(r, []);
      const sub = points[v.index]?.subgroupNo;
      if (sub !== undefined) ruleHits.get(r).push(sub);
    }
  }

  // แกน Y ของกราฟบนต้องครอบทั้ง control limit และ spec limit ไม่งั้นเส้นแดงหลุดออกนอกจอ
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

  const specText = `สเปก ${cp.lsl ?? '—'} ~ ${cp.usl ?? '—'}${cp.unit ? ` ${cp.unit}` : ''}`
    + (cp.target !== null && cp.target !== undefined ? ` · เป้า ${cp.target}` : '')
    + ` · ${isImr ? 'I-MR (n=1)' : `X̄-R (n=${limits.n})`}`;

  return (
    <Card className={`mb-3 chart-card${outOfControl ? ' chart-card--alert' : ''}`}>
      <ChartHead
        cp={cp}
        sub={specText}
        right={
          /* สองสถานะนี้แยกกัน: อยู่ในสเปก ≠ in control */
          <Badge bg={outOfControl ? 'warning' : 'secondary'}>
            {outOfControl ? 'Out of control' : 'In control'}
          </Badge>
        }
      />

      <Card.Body className="p-2">
        {limits.provisional && (
          <div className="small mb-1" style={{ color: 'var(--amber-text)' }}>
            ลิมิตยังเป็น provisional (มี {limits.subgroupCount} subgroup จากที่ควรมี {limits.minBaselineSubgroups})
            — ยังไม่ได้ล็อก baseline เส้นจะขยับตามข้อมูล
          </div>
        )}

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
              dot={{ r: 2.5, fill: C.data }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>

        <ChartLegend hasSpec={hasSpec} hasTarget={typeof cp.target === 'number'} provisional={limits.provisional} />

        {ruleHits.size > 0 && (
          <ul className="rule-list">
            {[...ruleHits.entries()].sort((a, b) => a[0] - b[0]).map(([rule, subs]) => (
              <li key={rule}>
                <b>กฎ {rule}</b> {RULE_TEXT[rule] ?? ''} — subgroup {subs.join(', ')}
              </li>
            ))}
          </ul>
        )}

        {/* สรุปความสามารถของกระบวนการ — ที่เดียว ไม่ซ้ำกับหัวการ์ดเหมือนของเดิม
            ⚠️ Cpk ต้องโชว์คู่กับ Ppk เสมอ ห่างกันมาก = process ไม่นิ่งระหว่าง subgroup
               ถ้าโชว์ตัวเดียวข้อมูลนั้นหายไปเลย */}
        <div className="d-flex justify-content-between flex-wrap text-muted mt-2 num" style={{ fontSize: '0.72rem' }}>
          <span>
            Cp {fmtCap(capability.cp)} · <span className={cpkClass(capability.cpk)}>Cpk {fmtCap(capability.cpk)}</span>
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
