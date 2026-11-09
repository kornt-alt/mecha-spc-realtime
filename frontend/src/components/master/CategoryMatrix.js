// components/master/CategoryMatrix.js — ตารางจุดตรวจ × หมวดการตรวจ ของ item ที่เลือก (หน้า Master)
//
// Korn เลือก (2026-11): หน้าตาตามฟอร์ม "SET UP & LAST PIECE INSPECTION RECORD"
//   แถว = จุดตรวจ (No / Critical Point / Specification / Max-Min / Instrument)
//   กลุ่มคอลัมน์ = หมวด × ขั้น (Production Check / QC Confirm) แต่ละกลุ่มมีช่อง 1–6
//   ช่องที่ติด ✓ ไล่จากช่อง 1 = จำนวนชิ้นที่ตรวจ · บันทึกทีเดียวทั้งตาราง (PUT /master/models/:id/category-matrix)
//
//   Inspection Record (ตรวจตามรอบ, id 1) → checkpoints.in_routine + sample_size (+ ความถี่)
//   หมวดที่ has_workflow (Set up / Last Piece / …) → checkpoint_category_settings.sample_qty ราย PD / QC
//   หมวดใหม่ใน check_categories ได้กลุ่มคอลัมน์เองโดยไม่ต้องแก้โค้ด
//
// ⚠️ ตรวจตามรอบที่ปิด ยังเก็บ sample_size เดิมไว้ (คอลัมน์ NOT NULL และจุดนั้นอาจมีกราฟเก่า) — แค่ in_routine = 0
// ⚠️ จุดตรวจด้วยตา (attribute) ตรวจได้ 1 ชิ้นเสมอ (ผลเดียวต่อใบ) — ช่อง 2 ขึ้นไปปิด
// ⚠️ แสดงเฉพาะจุดที่เปิดใช้งาน · จุดที่ปิดไม่ถูกส่ง (server ไม่แตะ)
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Spinner } from 'react-bootstrap';
import { apiCall } from '../../utils/api';
import SpecValue from '../SpecValue';

const ROUTINE = 1;
const ROUTINE_KEY = 'routine';
const STAGES = [{ key: 'pd', label: 'Production Check' }, { key: 'qc', label: 'QC Confirm' }];
const MIN_SLOTS = 6; // ช่อง 1–6 ตามฟอร์ม (ขยายเองถ้ามีจุดที่ตั้งเกิน 6)
const keyOf = (catId, stage) => `${catId}:${stage}`;

// ค่าตั้งต้นของ 1 จุด จากข้อมูลใน DB — ไม่มีคีย์ = ไม่ตรวจ
const draftOf = (cp) => {
  const settings = {};
  for (const s of cp.category_settings ?? []) settings[keyOf(s.category_id, s.stage)] = String(s.sample_qty);
  return {
    in_routine: cp.in_routine === undefined || cp.in_routine === null ? true : Number(cp.in_routine) === 1,
    sample_size: String(cp.sample_size ?? 1),
    frequency: cp.frequency === 'day' ? 'day' : 'shift',
    settings,
  };
};

const sameDraft = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// จำนวนชิ้นของกลุ่ม g ('routine' | '<cat>:<stage>') — 0 = ไม่ตรวจ
const qtyOf = (p, g) => (g === ROUTINE_KEY
  ? (p.in_routine ? Number(p.sample_size) || 1 : 0)
  : Number(p.settings?.[g] ?? 0));
const maxFor = (cp) => (cp.char_type === 'attribute' ? 1 : 10);
const withQty = (p, g, q) => {
  if (g === ROUTINE_KEY) return q > 0 ? { ...p, in_routine: true, sample_size: String(q) } : { ...p, in_routine: false };
  const settings = { ...p.settings };
  if (q > 0) settings[g] = String(q); else delete settings[g];
  return { ...p, settings };
};
const fmtLimit = (v) => (v === null || v === undefined ? '—' : v);

const CategoryMatrix = ({ modelId, checkpoints, categories, onSaved, onEditPoint, onAlert }) => {
  const points = useMemo(() => checkpoints.filter((c) => c.is_active), [checkpoints]);
  const routineCat = categories.find((c) => Number(c.id) === ROUTINE);
  const flowCats = categories.filter((c) => Number(c.has_workflow) && Number(c.is_active ?? 1));

  const initial = useMemo(() => Object.fromEntries(points.map((cp) => [cp.id, draftOf(cp)])), [points]);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  // โหลดจุดใหม่ (เปลี่ยน item / บันทึกแล้วโหลดซ้ำ / master_updated) = เริ่มจากค่าใน DB
  useEffect(() => { setDraft(initial); }, [initial]);

  const dirtyIds = points.filter((cp) => draft[cp.id] && !sameDraft(draft[cp.id], initial[cp.id])).map((cp) => cp.id);
  const dirty = dirtyIds.length > 0;

  // ปิดแท็บ/รีเฟรชทั้งที่ยังไม่บันทึก → เบราว์เซอร์ถามก่อน
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = (id, fn) => setDraft((d) => ({ ...d, [id]: fn(d[id]) }));

  // คลิกช่องที่ k = ตรวจ k ชิ้น · คลิกช่องสุดท้ายที่ติดอยู่ซ้ำ = ลดลง 1 (ช่อง 1 ซ้ำ = ไม่ตรวจ)
  const clickSlot = (cp, g, k) => patch(cp.id, (p) => {
    const q = qtyOf(p, g);
    return withQty(p, g, q === k ? k - 1 : Math.min(k, maxFor(cp)));
  });
  // คลิกเลขหัวคอลัมน์ = ทุกจุดในกลุ่ม k ชิ้น (ตรวจด้วยตา = 1) · ทุกจุดเป็นค่านั้นอยู่แล้ว = ปิดทั้งกลุ่ม
  const setGroup = (g, k) => setDraft((d) => {
    const all = points.every((cp) => qtyOf(d[cp.id], g) === Math.min(k, maxFor(cp)));
    const next = { ...d };
    for (const cp of points) next[cp.id] = withQty(d[cp.id], g, all ? 0 : Math.min(k, maxFor(cp)));
    return next;
  });

  const save = async () => {
    const body = {
      points: points.map((cp) => {
        const p = draft[cp.id];
        return {
          id: cp.id,
          in_routine: p.in_routine,
          sample_size: Number(p.sample_size),
          frequency: p.frequency,
          settings: Object.entries(p.settings).map(([k, v]) => {
            const [categoryId, stage] = k.split(':');
            return { category_id: Number(categoryId), stage, sample_qty: Number(v) };
          }),
        };
      }),
    };
    setSaving(true);
    try {
      const res = await apiCall(`/master/models/${modelId}/category-matrix`, { method: 'PUT', body });
      if (res.sampleSizeChangedWithData?.length) {
        onAlert({
          title: 'จำนวนชิ้นตรวจตามรอบเปลี่ยน — ต้อง Re-baseline',
          body: `จุดที่มีผลตรวจอยู่แล้วและเปลี่ยน n: ${res.sampleSizeChangedWithData.join(', ')}\n\n`
            + 'กราฟของจุดเหล่านี้จะผสม n เดิมกับ n ใหม่ไม่ได้ ให้กด Re-baseline (และดูช่วงข้อมูล) ที่ตารางจุดตรวจ',
        });
      }
      await onSaved?.(`บันทึกตารางหมวดการตรวจแล้ว (${res.points} จุด)`);
    } catch (e) {
      onAlert({ title: 'บันทึกไม่สำเร็จ', body: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (points.length === 0) return null;

  // กลุ่มคอลัมน์ตามฟอร์ม: Inspection Record · <หมวด> Production Check / QC Confirm
  const groups = [
    ...(routineCat ? [{ key: ROUTINE_KEY, cat: 'Inspection Record', sub: 'ตรวจตามรอบ' }] : []),
    ...flowCats.flatMap((c) => STAGES.map((st) => ({ key: keyOf(c.id, st.key), cat: c.name, sub: st.label }))),
  ];
  const slotsOf = (g) => Math.max(MIN_SLOTS, ...points.map((cp) => qtyOf(draft[cp.id] ?? {}, g.key)));
  const widthOf = (g) => slotsOf(g) + (g.key === ROUTINE_KEY ? 1 : 0); // ตามรอบมีคอลัมน์ความถี่เพิ่ม
  const catSpans = [];
  for (const g of groups) {
    const last = catSpans[catSpans.length - 1];
    if (last && last.cat === g.cat) last.span += widthOf(g);
    else catSpans.push({ cat: g.cat, span: widthOf(g) });
  }

  return (
    <Card className="mt-3 category-matrix">
      <Card.Header className="d-flex flex-wrap align-items-center gap-2">
        <span>ตารางหมวดการตรวจ (แบบฟอร์ม SET UP &amp; LAST PIECE)</span>
        <span className="small text-muted fw-normal">
          คลิกช่องที่ k = ตรวจ k ชิ้น · คลิกช่องสุดท้ายซ้ำ = ลดลง · คลิกเลขหัวคอลัมน์ = ทั้งกลุ่ม
        </span>
      </Card.Header>
      <Card.Body className="p-2">
        <div className="mc-freeze">
          <table className="sheet cm-table">
            <thead>
              <tr>
                <th rowSpan={3} className="text-center">No</th>
                <th rowSpan={3} className="mc-sticky-start">จุดตรวจ</th>
                <th rowSpan={3} className="text-center">Critical<br />Point</th>
                <th rowSpan={3} className="text-center">Specification</th>
                <th rowSpan={3} className="text-center">Max<br />Min</th>
                <th rowSpan={3} className="text-center">Instrument</th>
                {catSpans.map((c) => <th key={c.cat} colSpan={c.span} className="text-center cm-group">{c.cat}</th>)}
              </tr>
              <tr>
                {groups.map((g) => (
                  <th key={g.key} colSpan={widthOf(g)} className="text-center cm-group">{g.sub}</th>
                ))}
              </tr>
              <tr>
                {groups.flatMap((g) => [
                  ...Array.from({ length: slotsOf(g) }, (_, i) => (
                    <th key={`${g.key}-${i}`} className={`text-center cm-slot-head${i === 0 ? ' cm-group' : ''}`}>
                      <button type="button" className="cm-slot-head__btn" title={`ทุกจุดในกลุ่มนี้ ${i + 1} ชิ้น`}
                        onClick={() => setGroup(g.key, i + 1)}>{i + 1}</button>
                    </th>
                  )),
                  ...(g.key === ROUTINE_KEY ? [<th key={`${g.key}-freq`} className="text-center">ความถี่</th>] : []),
                ])}
              </tr>
            </thead>
            <tbody>
              {points.map((cp) => {
                const p = draft[cp.id];
                if (!p) return null;
                const changed = dirtyIds.includes(cp.id);
                return (
                  <tr key={cp.id} className={changed ? 'cm-row--dirty' : ''}>
                    <td className="text-center num text-muted">{cp.seq_no}</td>
                    <th scope="row" className="mc-sticky-start fw-normal cm-name">
                      <b>{cp.name}</b>
                      {cp.characteristic && !String(cp.name).includes(cp.characteristic) && (
                        <span className="small text-muted ms-1">{cp.characteristic}</span>
                      )}
                      <br />
                      <Button size="sm" variant="link" className="p-0 small" onClick={() => onEditPoint(cp)}>แก้จุดนี้</Button>
                    </th>
                    <td className="text-center">{cp.is_critical ? <span className="badge bg-light text-dark">SC</span> : ''}</td>
                    <td><SpecValue checkpoint={cp} /></td>
                    <td className="text-center num small cm-maxmin">
                      <div>{fmtLimit(cp.usl)}</div>
                      <div>{fmtLimit(cp.lsl)}</div>
                    </td>
                    <td className="small">{cp.gauge || '—'}</td>
                    {groups.flatMap((g) => {
                      const q = qtyOf(p, g.key);
                      const cells = Array.from({ length: slotsOf(g) }, (_, i) => {
                        const k = i + 1;
                        const on = k <= q;
                        const off = k > maxFor(cp);
                        const cls = ['cm-slot', on && 'cm-slot--on', off && 'cm-slot--off', i === 0 && 'cm-group']
                          .filter(Boolean).join(' ');
                        return (
                          <td key={`${g.key}-${k}`} className={cls}>
                            {!off && (
                              <button type="button" className="cm-slot__btn" aria-pressed={on}
                                aria-label={`${cp.name} ${g.cat} ${g.sub} ชิ้นที่ ${k}`}
                                onClick={() => clickSlot(cp, g.key, k)}>
                                {on ? '✓' : ''}
                              </button>
                            )}
                          </td>
                        );
                      });
                      if (g.key === ROUTINE_KEY) {
                        cells.push(
                          <td key={`${g.key}-freq`} className="cm-freq-cell">
                            <Form.Select size="sm" className="cm-freq" value={p.frequency} disabled={!p.in_routine}
                              aria-label={`${cp.name} ความถี่`}
                              onChange={(e) => patch(cp.id, (x) => ({ ...x, frequency: e.target.value }))}>
                              <option value="shift">/กะ</option>
                              <option value="day">/วัน</option>
                            </Form.Select>
                          </td>
                        );
                      }
                      return cells;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="savebar">
          <span className="savebar__count">
            {dirty ? <b style={{ color: 'var(--red)' }}>ยังไม่บันทึก {dirtyIds.length} จุด</b> : `${points.length} จุดตรวจ · ยังไม่มีการแก้`}
          </span>
          <span className="savebar__spacer" />
          <Button variant="outline-secondary" disabled={!dirty || saving} onClick={() => setDraft(initial)}>คืนค่าเดิม</Button>
          <Button disabled={!dirty || saving} onClick={save}>
            {saving && <Spinner size="sm" animation="border" className="me-1" />}บันทึกทั้งหมด
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default CategoryMatrix;
