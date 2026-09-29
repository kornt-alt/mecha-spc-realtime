// frontend/src/components/InputGrid.js — ตารางแบบชีต Input ของ Excel ที่ QC ใช้
//
// จุดตรวจเป็นคอลัมน์ ชิ้นเป็นแถว ใบตรวจหนึ่งใบกาง n แถว เรียงเก่า→ใหม่ลงล่าง
// หัวตารางหลายแถวตามชีต Input: Equipment · Sample size/ความถี่ · Spec · Unit · Max/Average/Min
// แล้วจบที่แถวชื่อจุดตรวจ (Characteristic + ชื่อ) ซึ่งเป็นแถวเดียวที่มีหัวคอลัมน์ฝั่งซ้าย
//
// `GridHead` ใช้ร่วมกับใบตรวจ (InspectionSheet) — หน้ากรอกกับตารางประวัติต้องหน้าตาเดียวกัน
// คนกรอกจะได้เห็นว่ากำลังพิมพ์ "บรรทัดถัดไป" ของตารางข้างล่าง
//
// ⚠️ ไม่คำนวณสถิติเอง Max/Average/Min มาจาก GET /reports/model/:id/grid (ตัดใบที่ยกเลิกออกแล้ว)
import React, { useEffect, useState } from 'react';
import { Spinner } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { normalizeCheckpoints } from '../utils/normalize';
import SpecValue, { decimalsOf } from './SpecValue';
import { fmtDate, fmtTime } from '../utils/dateFormat';

// "2 pcs / shift" — หัวชีต Input เขียนแบบนี้
export const freqLabel = (cp) =>
  `${cp.char_type === 'attribute' ? 1 : cp.sample_size || 1} pcs / ${cp.frequency === 'day' ? 'day' : 'shift'}`;

export const cpDecimals = (cp) => decimalsOf(cp.usl, cp.lsl, cp.target);

const fmtNum = (v, dp) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '');

// คอลัมน์ฝั่งซ้ายตรึงไว้ตอนเลื่อนแนวนอน — offset สะสมจากความกว้างที่กำหนดตายตัว
// ⚠️ ความกว้างต้อง fix (ไม่ใช่ auto) ไม่งั้น left ของคอลัมน์ถัดไปคำนวณไม่ได้
const withOffsets = (cols) => {
  let left = 0;
  return cols.map((c) => {
    const out = { ...c, left };
    left += c.width;
    return out;
  });
};

const leftStyle = (c) => ({ left: `${c.left}rem`, width: `${c.width}rem`, minWidth: `${c.width}rem` });

/**
 * หัวตารางแบบชีต Input
 * @param leftCols  [{ key, label, width(rem) }] — คอลัมน์ข้อมูลฝั่งซ้าย
 * @param stats     { [cpId]: { max, min, avg } } | null — null = ไม่แสดงแถว Max/Average/Min
 * @param colClass  (cp) => className เพิ่มของทั้งคอลัมน์ (เช่นจุดที่ทำแล้วรอบนี้)
 * @param badge     (cp) => node ต่อท้ายชื่อจุดตรวจ
 */
export const GridHead = ({ checkpoints, leftCols, stats = null, colClass = () => '', badge = () => null }) => {
  const cols = withOffsets(leftCols);
  const totalWidth = cols.reduce((s, c) => s + c.width, 0);

  const labelRow = (label, render, key = label) => (
    <tr key={key}>
      <th scope="row" colSpan={cols.length} className="igrid__left igrid__rowlabel"
        style={{ left: 0, width: `${totalWidth}rem`, minWidth: `${totalWidth}rem` }}>
        {label}
      </th>
      {checkpoints.map((cp) => (
        <td key={cp.id} className={`igrid__head ${colClass(cp)}`}>{render(cp)}</td>
      ))}
    </tr>
  );

  return (
    <thead>
      {labelRow('Equipment', (cp) => cp.gauge || '—')}
      {labelRow('Sample size', (cp) => freqLabel(cp))}
      {labelRow('Spec', (cp) => <SpecValue checkpoint={cp} />)}
      {labelRow('Unit', (cp) => cp.unit || '—')}
      {stats && labelRow('Max', (cp) => fmtNum(stats[cp.id]?.max, cpDecimals(cp)))}
      {stats && labelRow('Average', (cp) => fmtNum(stats[cp.id]?.avg, cpDecimals(cp) + 1))}
      {stats && labelRow('Min', (cp) => fmtNum(stats[cp.id]?.min, cpDecimals(cp)))}
      <tr>
        {cols.map((c) => (
          <th key={c.key} scope="col" className="igrid__left igrid__colhead" style={leftStyle(c)}>{c.label}</th>
        ))}
        {checkpoints.map((cp) => (
          <th key={cp.id} scope="col" className={`igrid__cp ${colClass(cp)}`}>
            {cp.characteristic && <span className="igrid__char">{cp.characteristic}</span>}
            <span className="igrid__name">
              <span className="igrid__seq">{cp.seq_no}</span> {cp.name}
              {cp.is_critical && <span className="igrid__ctf" title="จุดวิกฤต — SC point">SC point</span>}
            </span>
            {badge(cp)}
          </th>
        ))}
      </tr>
    </thead>
  );
};

const LEFT_COLS = [
  { key: 'date', label: 'Date', width: 6 },
  { key: 'time', label: 'Time', width: 3.4 },
  { key: 'mo', label: 'WOS (MO)', width: 7.5 },
  { key: 'mc', label: 'M/C', width: 4.5 },
  { key: 'shift', label: 'Shift', width: 2.8 },
  { key: 'qc', label: 'QC', width: 7 },
  { key: 'piece', label: 'No.', width: 2.6 },
];


const cellText = (cp, cell) => {
  if (!cell) return '';
  if (cp.char_type === 'attribute' || cell.value === null) return cell.judgment ?? '';
  // ⚠️ ทศนิยมอย่างน้อยเท่าสเปก แต่ห้ามน้อยกว่าที่ค่าวัดมีจริง — ปัดค่าวัดทิ้งคือโกหกผลตรวจ
  return fmtNum(cell.value, Math.max(cpDecimals(cp), decimalsOf(cell.value)));
};

// cell.original = ค่าแรกสุดก่อนถูกแก้ในใบเดิม (ตัวเลข หรือ 'OK'/'NG' ของจุด attribute)
const originalText = (cp, original) => (typeof original === 'number'
  ? cellText(cp, { value: original, judgment: null })
  : cellText(cp, { value: null, judgment: original }));

/**
 * ตารางประวัติแบบชีต Input (อ่านอย่างเดียว) — โหลดข้อมูลเอง
 * @param query      query string ตัวกรองชุดเดียวกับหน้ารายงาน เช่น '?from=…&to=…'
 * @param limit      เอาแค่ N ใบล่าสุด (ใต้ใบตรวจ) · ไม่ส่ง = ตามตัวกรองทั้งหมด (สูงสุด 1000 ใบ)
 * @param reloadKey  เปลี่ยนค่าเมื่อไหร่โหลดใหม่ (หลังบันทึก/ยกเลิกใบ)
 * @param showStats  แถว Max/Average/Min หัวตาราง
 */
const InputGrid = ({ modelId, query = '', limit, reloadKey = 0, showStats = true, emptyText = 'ยังไม่มีข้อมูล' }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!modelId) { setData(null); return undefined; }
    let cancelled = false;
    const q = new URLSearchParams(query.replace(/^\?/, ''));
    if (limit) q.set('limit', String(limit));
    const s = q.toString();
    setLoading(true);
    apiCall(`/reports/model/${modelId}/grid${s ? `?${s}` : ''}`)
      .then((res) => {
        if (cancelled) return;
        setData({ ...res, checkpoints: normalizeCheckpoints(res.checkpoints) });
        setError(null);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [modelId, query, limit, reloadKey]);

  if (error) return <div className="empty">โหลดตารางไม่สำเร็จ: {error}</div>;
  if (!data) {
    return loading
      ? <div className="empty"><Spinner animation="border" size="sm" className="me-2" />กำลังโหลดตาราง</div>
      : null;
  }

  const { checkpoints, rows, stats, truncated } = data;
  const cols = withOffsets(LEFT_COLS);

  // สลับพื้นทีละใบตรวจ ไม่ใช่ทีละแถว — ใบหนึ่งมีหลายแถว (ชิ้นที่ 1..n)
  let band = -1;
  let lastId = null;

  return (
    <>
      {truncated && (
        <div className="small mb-2" style={{ color: 'var(--amber-text)' }}>
          แสดง {limit ? limit : 1000} ใบล่าสุดเท่านั้น — กรองช่วงวันให้แคบลงเพื่อดูส่วนที่เหลือ
        </div>
      )}
      <div className="igrid-wrap">
        <table className="igrid">
          <GridHead checkpoints={checkpoints} leftCols={LEFT_COLS} stats={showStats ? stats : null} />
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + checkpoints.length} className="text-muted text-center py-3">{emptyText}</td>
              </tr>
            )}
            {rows.map((r) => {
              const first = r.inspection_id !== lastId;
              if (first) { band += 1; lastId = r.inspection_id; }
              const cls = [
                band % 2 ? 'igrid__band' : '',
                first ? 'igrid__first' : '',
                r.voided_at ? 'row--voided' : '',
              ].join(' ');
              const span = { rowSpan: r.pieces };
              const leftVals = {
                date: fmtDate(r.inspected_at),
                time: fmtTime(r.inspected_at),
                mo: r.mo_no,
                mc: r.machine_code,
                shift: r.shift,
                qc: r.inspector_name,
              };
              return (
                <tr key={`${r.inspection_id}-${r.piece_no}`} className={cls}
                  title={r.voided_at ? 'ใบนี้ถูกยกเลิกแล้ว — ไม่นับใน Max/Average/Min และกราฟ' : undefined}>
                  {first && cols.slice(0, -1).map((c) => (
                    <td key={c.key} {...span} className="igrid__left igrid__meta" style={leftStyle(c)}>
                      {leftVals[c.key]}
                    </td>
                  ))}
                  <td className="igrid__left igrid__meta text-end" style={leftStyle(cols[cols.length - 1])}>
                    {r.piece_no}
                  </td>
                  {checkpoints.map((cp) => {
                    const cell = r.cells[cp.id];
                    const edited = cell && cell.original !== undefined;
                    return (
                      <td key={cp.id}
                        className={`igrid__val${cell?.judgment === 'NG' ? ' igrid__ng' : ''}${edited ? ' igrid__edited' : ''}`}
                        title={edited ? `แก้ไขหลังบันทึก — ค่าเดิม ${originalText(cp, cell.original)}` : undefined}>
                        {cellText(cp, cell)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default InputGrid;
