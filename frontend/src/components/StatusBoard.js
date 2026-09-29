// frontend/src/components/StatusBoard.js — ตารางสถานะของ Dashboard (1 แถว = 1 จุดตรวจ)
//
// Dashboard คือ "ภาพรวมทุกจุดพร้อมกัน" ส่วนหน้า SC Chart คือเจาะลึกทีละจุด — แถวนี้บอกแค่
// จุดไหนต้องดู แล้วกดไปดูรายละเอียดที่ /sc · ข้อมูลคือ charts[] ชุดเดียวกับที่ Dashboard โหลด
// (ไม่โหลดเอง) socket อัปเดต charts แล้วแถวเปลี่ยนตามทันที
//
// ⚠️ เรียงตาม seq_no เสมอ ห้ามเรียงตามสถานะ — เหตุผลเดียวกับการ์ดเดิม (แถวจะสลับที่ใต้ตาคนอ่าน)
// ⚠️ ไม่คำนวณสถิติเอง · สถานะ NG เทียบค่าชิ้นล่าสุดกับ USL/LSL เพื่อแสดงผลเท่านั้น
//    (หลักเดียวกับ judgeLocal — ผลที่บันทึกจริงมาจาก server)
import React from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, YAxis, ReferenceLine } from 'recharts';
import SpecValue from './SpecValue';
import { C, fmt, fmtCap, decimalsOf } from './XbarRCharts';
import { capTone } from '../utils/capability';
import { RULE_BY_ID } from '../utils/spcRules';
import { scHref } from '../utils/useModelParam';
import { fmtDateTime } from '../utils/dateFormat';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const SPARK_POINTS = 30;

const outOfSpec = (cp, v) => isNum(v) && ((isNum(cp.usl) && v > cp.usl) || (isNum(cp.lsl) && v < cp.lsl));

/**
 * สถานะของจุดตรวจหนึ่งจุด — ใช้ทั้งแถวในตารางและตัวนับที่หัว Dashboard (ต้องเป็นฟังก์ชันเดียวกัน)
 * ลำดับความสำคัญ: ng (แดง = สเปก) → ocs (เหลือง = คอนโทรล จุดล่าสุดผิดกฎ)
 *                → watch (เคยผิดกฎในช่วงนี้ จุดล่าสุดปกติ) → ok → nodata
 * @returns {{ key: 'ng'|'ocs'|'watch'|'ok'|'nodata', label: string, detail?: string }}
 */
export const statusOf = (chart) => {
  const cp = chart.checkpoint ?? {};
  if (chart.mode === 'attribute') {
    if (!chart.total) return { key: 'nodata', label: 'ไม่มีข้อมูล' };
    return chart.ngCount > 0 ? { key: 'ng', label: 'NG', detail: `${chart.ngCount}/${chart.total} ครั้ง` } : { key: 'ok', label: 'OK' };
  }
  const pts = chart.points ?? [];
  if (pts.length === 0) return { key: 'nodata', label: 'ไม่มีข้อมูล' };
  const last = pts[pts.length - 1];
  if ((last.values ?? [last.xbar]).some((v) => outOfSpec(cp, v))) {
    return { key: 'ng', label: 'NG', detail: 'ชิ้นล่าสุดหลุดสเปก' };
  }
  const rules = [...(last.rules ?? []), ...(last.rangeRules ?? [])];
  if (rules.length > 0) {
    const names = [...new Set(rules)].map((r) => RULE_BY_ID[r]?.short ?? r);
    return { key: 'ocs', label: 'OCS', detail: names.join(' · ') };
  }
  if ((chart.violations?.length ?? 0) > 0) {
    return { key: 'watch', label: 'ต้องดู', detail: `ผิดกฎ ${chart.violations.length} จุดในช่วงนี้` };
  }
  return { key: 'ok', label: 'OK' };
};

// จุดที่ผิดกฎเป็นจุดเหลือง ที่เหลือไม่วาดจุด — กราฟจิ๋วมีจุดทุกตัวแล้วอ่านไม่ออก
const sparkDot = (props) => {
  const { cx, cy, payload, index } = props;
  if (cx === null || cy === null || !(payload?.rules?.length > 0)) return <g key={`d-${index}`} />;
  return <circle key={`d-${index}`} cx={cx} cy={cy} r={2.5} fill={C.control} />;
};

const Sparkline = ({ chart }) => {
  const cp = chart.checkpoint;
  const L = chart.limits;
  const data = (chart.points ?? []).slice(-SPARK_POINTS);
  if (data.length < 2 || !L) return <span className="text-muted">—</span>;
  const lines = [L.ucl, L.lcl, cp.usl, cp.lsl].filter(isNum);
  const ys = [...data.map((p) => p.xbar), ...lines].filter(isNum);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = (hi - lo) * 0.08 || 1;
  return (
    // ⚠️ isAnimationActive={false} — socket โหลด charts ใหม่บ่อย ใส่ animation แล้วทั้งจอกะพริบ
    <LineChart width={150} height={36} data={data} margin={{ top: 3, right: 3, bottom: 3, left: 3 }}>
      <YAxis hide domain={[lo - pad, hi + pad]} />
      {isNum(cp.usl) && <ReferenceLine y={cp.usl} stroke={C.spec} strokeWidth={1} />}
      {isNum(cp.lsl) && <ReferenceLine y={cp.lsl} stroke={C.spec} strokeWidth={1} />}
      {isNum(L.ucl) && <ReferenceLine y={L.ucl} stroke={C.control} strokeDasharray="3 2" strokeWidth={1} />}
      {isNum(L.lcl) && <ReferenceLine y={L.lcl} stroke={C.control} strokeDasharray="3 2" strokeWidth={1} />}
      <Line type="linear" dataKey="xbar" stroke={C.data} strokeWidth={1.5} dot={sparkDot} isAnimationActive={false} />
    </LineChart>
  );
};

const fmtTime = (d) => fmtDateTime(d, '');

const CAP_STYLE = { below: 'status-board__warn', poor: 'status-board__bad' };

const StatusBoard = ({ charts, machineId = '' }) => (
  <div className="status-board-wrap">
    <table className="status-board">
      <thead>
        <tr>
          <th scope="col" className="text-end">#</th>
          <th scope="col">จุดตรวจ</th>
          <th scope="col" className="status-board__spec">Spec</th>
          <th scope="col">สถานะ</th>
          <th scope="col" className="text-end">Cpk</th>
          <th scope="col" className="text-end">ล่าสุด</th>
          <th scope="col" className="status-board__trend">แนวโน้ม ({SPARK_POINTS} จุดล่าสุด)</th>
          <th scope="col"><span className="visually-hidden">ลิงก์</span></th>
        </tr>
      </thead>
      <tbody>
        {charts.map((c) => {
          const cp = c.checkpoint;
          const st = statusOf(c);
          const isAttr = c.mode === 'attribute';
          const last = c.points?.[c.points.length - 1];
          const dp = decimalsOf(cp.usl, cp.lsl, cp.target);
          const cpk = c.capability?.cpk;
          return (
            <tr key={cp.id} className={`status-board__row--${st.key}`}>
              <td className="text-end num text-muted">{cp.seq_no}</td>
              <th scope="row" className="fw-normal">
                {cp.characteristic && <span className="status-board__sub">{cp.characteristic}</span>}
                <b>{cp.name}</b>
                {cp.is_critical && <span className="badge bg-light text-dark ms-1" title="จุดวิกฤต — SC point">SC point</span>}
                {cp.gauge && <span className="status-board__sub">{cp.gauge}</span>}
              </th>
              <td className="status-board__spec"><SpecValue checkpoint={cp} /></td>
              <td>
                <span className={`status-pill status-pill--${st.key}`}>{st.label}</span>
                {st.detail && <span className="status-board__sub">{st.detail}</span>}
              </td>
              <td className={`text-end num ${CAP_STYLE[capTone(cpk, c.capabilityTarget?.minCpk)] ?? ''}`}
                title={c.capabilityTarget ? `เกณฑ์ Cpk ≥ ${fmtCap(c.capabilityTarget.minCpk)}` : undefined}>
                {isAttr ? (c.ngRate !== null && c.ngRate !== undefined ? `NG ${(c.ngRate * 100).toFixed(1)}%` : '—') : fmtCap(cpk)}
              </td>
              <td className="text-end num">
                {last ? (
                  <>
                    <b className={outOfSpec(cp, last.xbar) ? 'status-board__bad' : ''}>{fmt(last.xbar, dp)}</b>
                    <span className="status-board__sub">{fmtTime(last.meta?.inspectedAt)}</span>
                  </>
                ) : '—'}
              </td>
              <td className="status-board__trend">{isAttr ? <span className="text-muted">—</span> : <Sparkline chart={c} />}</td>
              <td className="text-end">
                {!isAttr && (
                  <Link className="btn btn-sm btn-outline-primary text-nowrap"
                    to={scHref({ modelId: cp.model_id, checkpointId: cp.id, machineId })}>
                    SC →
                  </Link>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export default StatusBoard;
