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
//    และของเดิมยังใช้ "แดง" ทั้งกับ spec limit และกับจุดที่ผิดกฎ OCS ซึ่งคนละเรื่องกัน
//    ตอนนี้ผิดกฎ = เหลือง (process เปลี่ยน ของยังไม่เสีย) หลุดสเปก = แดง (ของเสีย)
import React from 'react';
import { Link } from 'react-router-dom';
import { Card, Badge, Alert } from 'react-bootstrap';
import { scHref } from '../utils/useModelParam';
import { OCS_RULES, chartLabel } from '../utils/spcRules';
import { targetLabel } from '../utils/capability';
import XbarRCharts, { fmt, fmtCap, capClass } from './XbarRCharts';

// หัวการ์ด — ใช้ร่วมกันทุกสาขา เพื่อให้การ์ดที่ไม่มีข้อมูลหน้าตาไม่หลุดจากพวก
const ChartHead = ({ cp, sub, right }) => (
  <Card.Header className="bg-dark text-white py-2">
    <div className="d-flex justify-content-between align-items-start gap-2">
      <div className="flex-grow-1">
        {/* ⚠️ seq_no กับ name ต้องอยู่ใน element เดียวกัน เทสจับด้วย textContent รวม */}
        <div className="fw-bold small">
          {cp.seq_no}. {cp.name}
          {cp.is_critical && (
            <span className="badge bg-light text-dark ms-2" title="จุดวิกฤต — SC point">SC point</span>
          )}
        </div>
        {sub && <div className="text-white-50" style={{ fontSize: '0.72rem' }}>{sub}</div>}
      </div>
      {right}
    </div>
  </Card.Header>
);


// machineId = ตัวกรองเครื่องของหน้าที่เรียก (ถ้ามี) — พาไปหน้า SC Chart ด้วยเครื่องเดียวกัน
const ControlChart = ({ chart, height = 190, machineId = '' }) => {
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
  const target = chart.capabilityTarget ?? null;

  if (!limits || points.length === 0) {
    return (
      <Card className="mb-3 chart-card">
        <ChartHead cp={cp} />
        <Card.Body className="text-muted text-center small py-4">ยังไม่มีข้อมูลค่าวัดในช่วงที่เลือก</Card.Body>
      </Card>
    );
  }

  const isImr = limits.mode === 'i-mr';
  const violations = chart.violations ?? [];
  const outOfControl = violations.length > 0;

  // รวมกฎที่ผิดเป็นรายข้อ พร้อมบอกว่า subgroup ไหนบ้าง
  // ⚠️ ของเดิมข้อมูลนี้อยู่ใน tooltip อย่างเดียว ต้อง hover จุดถึงจะเห็น
  //    จอสัมผัสหน้าไลน์แตะไม่ติด และ ResponsiveContainer ใน jsdom สูง 0 เทสก็เข้าไม่ถึง
  //    จึงต้องอยู่นอกกราฟเป็นข้อความ
  // key = "<กราฟ>:<กฎ>" — กฎเดียวกันผิดได้ทั้งบนกราฟ X̄ และกราฟ R ต้องแยกบรรทัด
  const ruleHits = new Map();
  for (const v of violations) {
    for (const r of v.rules ?? []) {
      const key = `${v.chart ?? 'xbar'}:${r}`;
      if (!ruleHits.has(key)) ruleHits.set(key, []);
      const sub = points[v.index]?.subgroupNo;
      if (sub !== undefined) ruleHits.get(key).push(sub);
    }
  }
  const ruleOrder = (key) => {
    const [ch, id] = key.split(':');
    return (ch === 'range' ? 100 : 0) + OCS_RULES.findIndex((r) => r.id === id);
  };

  // แกน Y ของกราฟบนต้องครอบทั้ง control limit และ spec limit ไม่งั้นเส้นแดงหลุดออกนอกจอ

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

        <XbarRCharts chart={chart} height={height} />

        {ruleHits.size > 0 && (
          <ul className="rule-list">
            {[...ruleHits.entries()].sort((a, b) => ruleOrder(a[0]) - ruleOrder(b[0])).map(([key, subs]) => {
              const [ch, id] = key.split(':');
              const rule = OCS_RULES.find((r) => r.id === id);
              return (
                <li key={key}>
                  <b>{chartLabel(ch, isImr)} · {rule?.label ?? id}</b> {rule?.short ?? ''} — subgroup {subs.join(', ')}
                </li>
              );
            })}
          </ul>
        )}

        {/* สรุปความสามารถของกระบวนการ — ที่เดียว ไม่ซ้ำกับหัวการ์ดเหมือนของเดิม
            ⚠️ Cpk ต้องโชว์คู่กับ Ppk เสมอ ห่างกันมาก = process ไม่นิ่งระหว่าง subgroup
               ถ้าโชว์ตัวเดียวข้อมูลนั้นหายไปเลย */}
        <div className="d-flex justify-content-between flex-wrap text-muted mt-2 num" style={{ fontSize: '0.72rem' }}>
          <span>
            <span className={capClass(capability.cp, target?.minCp)}>Cp {fmtCap(capability.cp)}</span>
            {' · '}<span className={capClass(capability.cpk, target?.minCpk)}>Cpk {fmtCap(capability.cpk)}</span>
            {' | '}Pp {fmtCap(capability.pp)} · Ppk {fmtCap(capability.ppk)}
          </span>
          <span>
            σ(within) {fmt(capability.sigmaWithin, 4)} · σ(overall) {fmt(capability.sigmaOverall, 4)}
            {' · '}{points.length} subgroup
          </span>
        </div>
        <div className="d-flex justify-content-between align-items-center gap-2 mt-1" style={{ fontSize: '0.72rem' }}>
          <span className="text-muted num">{target ? targetLabel(target) : ''}</span>
          <Link to={scHref({ modelId: cp.model_id, checkpointId: cp.id, machineId })}>
            ฟอร์ม SC / Event Log →
          </Link>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ControlChart;
