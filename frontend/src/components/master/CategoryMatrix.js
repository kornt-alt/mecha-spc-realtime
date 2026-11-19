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
// การลาก (Korn สั่ง 2026-11-12):
//   • ลากระบายช่อง ✓ (เมาส์เท่านั้น — จอสัมผัสยังคลิกทีละช่อง เลื่อนตารางได้) — ในกลุ่มเดียวกับช่องที่เริ่ม
//     ทุกแถวจากแถวเริ่มถึงแถวที่เมาส์อยู่ = k ของคอลัมน์ที่เมาส์อยู่ · คิดจาก snapshot ตอนเริ่ม · Esc = คืนค่า
//   • ⠿ ลากย้ายลำดับ → PUT …/checkpoints/order ทันที (ส่งทุกจุดรวมที่ปิด — ตารางนี้โชว์แค่ที่เปิดอยู่)
//   • ⧉ ลากไปวางบนแถวอื่น = คัดลอกการตั้งหมวดทั้งแถว (ลง draft ยังไม่บันทึก)
//   • คลิกส่วนข้อมูลของแถว = กล่องแก้จุดตรวจ (onEditPoint(cp, draftRow) — draftRow = ค่าที่ยังไม่บันทึกของแถวนั้น)
//
// ⚠️ ตรวจตามรอบที่ปิด ยังเก็บ sample_size เดิมไว้ (คอลัมน์ NOT NULL และจุดนั้นอาจมีกราฟเก่า) — แค่ in_routine = 0
// ⚠️ จุดตรวจด้วยตา (attribute) ตรวจได้ 1 ชิ้นเสมอ (ผลเดียวต่อใบ) — ช่อง 2 ขึ้นไปปิด
// ⚠️ แสดงเฉพาะจุดที่เปิดใช้งาน · จุดที่ปิดไม่ถูกส่ง (server ไม่แตะ)
// ⚠️ โหลดจุดใหม่ (master_updated / ย้ายลำดับ / บันทึกในกล่องแก้) ต้องไม่ล้างค่าที่แก้ค้าง — ดู effect "merge" ข้างล่าง
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Form, Spinner } from 'react-bootstrap';
import { apiCall } from '../../utils/api';
import SpecValue from '../SpecValue';

const ROUTINE = 1;
const ROUTINE_KEY = 'routine';
const STAGES = [{ key: 'pd', label: 'Production Check' }, { key: 'qc', label: 'QC Confirm' }];
// ขั้นที่หมวดใช้ตาม flow (Master › หมวดการตรวจ) — ขั้นที่ไม่ใช้ไม่โชว์ (ค่าเดิมใน DB ไม่ถูกลบ ส่งกลับไปตามเดิม)
const FLOW_STAGES = { pd_qc: ['pd', 'qc'], pd: ['pd'], qc: ['qc'] };
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
// คัดลอกการตั้งทั้งแถวไปจุดอื่น — ตรวจด้วยตาตรวจได้ 1 ชิ้น (ตัดให้)
const copyRow = (src, cp) => {
  const max = maxFor(cp);
  const clamp = (v) => String(Math.min(Number(v) || 1, max));
  return {
    in_routine: src.in_routine,
    sample_size: clamp(src.sample_size),
    frequency: src.frequency,
    settings: Object.fromEntries(Object.entries(src.settings).map(([k, v]) => [k, clamp(v)])),
  };
};
const fmtLimit = (v) => (v === null || v === undefined ? '—' : v);
const bySeq = (a, b) => a.seq_no - b.seq_no;

const CategoryMatrix = ({
  modelId, checkpoints, categories, onSaved, onEditPoint, onReorder, onDownload, onAlert,
}) => {
  // ลำดับที่เพิ่งลากย้าย (โชว์ไปก่อนระหว่างรอโหลดใหม่) — ล้างเมื่อ checkpoints เปลี่ยน
  const [orderOverride, setOrderOverride] = useState(null);
  useEffect(() => { setOrderOverride(null); }, [checkpoints]);
  const points = useMemo(() => {
    const active = checkpoints.filter((c) => c.is_active).sort(bySeq);
    if (!orderOverride) return active;
    const byId = new Map(active.map((c) => [c.id, c]));
    return orderOverride.map((id) => byId.get(id)).filter(Boolean);
  }, [checkpoints, orderOverride]);
  const routineCat = categories.find((c) => Number(c.id) === ROUTINE);
  const flowCats = categories.filter((c) => Number(c.has_workflow) && Number(c.is_active ?? 1));

  const initial = useMemo(
    () => Object.fromEntries(checkpoints.filter((c) => c.is_active).map((cp) => [cp.id, draftOf(cp)])),
    [checkpoints]
  );
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  // merge: โหลดใหม่แล้วแถวที่แก้ค้าง (draft ≠ ค่าเดิม) และค่าใน DB ของแถวนั้นไม่เปลี่ยน = เก็บที่แก้ไว้
  //        แถวที่ DB เปลี่ยน (เพิ่งบันทึกในกล่องแก้ / บันทึกทั้งตาราง) = ใช้ค่า DB · เปลี่ยน item = เริ่มใหม่หมด
  const prevInitial = useRef(initial);
  const prevModel = useRef(modelId);
  useEffect(() => {
    const prev = prevInitial.current;
    prevInitial.current = initial;
    if (prevModel.current !== modelId) {
      prevModel.current = modelId;
      setDraft(initial);
      return;
    }
    setDraft((d) => {
      const next = {};
      for (const [id, row] of Object.entries(initial)) {
        const was = prev[id];
        const cur = d[id];
        next[id] = cur && was && !sameDraft(cur, was) && sameDraft(was, row) ? cur : row;
      }
      return next;
    });
  }, [initial, modelId]);

  const dirtyIds = points.filter((cp) => draft[cp.id] && initial[cp.id] && !sameDraft(draft[cp.id], initial[cp.id])).map((cp) => cp.id);
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

  // ── ลากระบายช่อง ✓ ───────────────────────────────────────────────────────
  const paintRef = useRef(null); // { g, row, k, snapshot, moved }
  const suppressClick = useRef(false);
  const [paintBox, setPaintBox] = useState(null); // { g, r0, r1, k } ไว้ไฮไลต์
  const startPaint = (e, g, row, k) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    paintRef.current = { g, row, k, snapshot: draft, moved: false };
  };
  const overPaint = (g, row, k) => {
    const p = paintRef.current;
    if (!p || p.g !== g) return;
    if (!p.moved && row === p.row && k === p.k) return;
    p.moved = true;
    const r0 = Math.min(p.row, row);
    const r1 = Math.max(p.row, row);
    const next = { ...p.snapshot };
    points.forEach((cp, i) => {
      if (i >= r0 && i <= r1) next[cp.id] = withQty(p.snapshot[cp.id], g, Math.min(k, maxFor(cp)));
    });
    setDraft(next);
    setPaintBox({ g, r0, r1, k });
  };
  useEffect(() => {
    const up = () => {
      const p = paintRef.current;
      if (!p) return;
      paintRef.current = null;
      setPaintBox(null);
      if (p.moved) {
        // ปล่อยบนปุ่มเดิมแล้ว click จะยิงตาม — ห้ามให้ toggle ซ้ำ
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
      }
    };
    const esc = (e) => {
      const p = paintRef.current;
      if (e.key !== 'Escape' || !p) return;
      paintRef.current = null;
      setPaintBox(null);
      setDraft(p.snapshot);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('keydown', esc); };
  }, []);

  // ── ⠿ ย้ายลำดับ / ⧉ คัดลอกทั้งแถว (HTML5 drag) ───────────────────────────
  const [drag, setDrag] = useState(null); // { kind: 'move'|'copy', id }
  const [dropAt, setDropAt] = useState(null); // { id, after }
  const startDrag = (kind, cp) => (e) => {
    e.dataTransfer.effectAllowed = kind === 'move' ? 'move' : 'copy';
    e.dataTransfer.setData('text/plain', `${kind}:${cp.id}`);
    const row = e.currentTarget.closest('tr');
    if (row) e.dataTransfer.setDragImage(row, 20, 16);
    setDrag({ kind, id: cp.id });
  };
  const endDrag = () => { setDrag(null); setDropAt(null); };
  const overRow = (cp) => (e) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = drag.kind === 'move' ? 'move' : 'copy';
    const r = e.currentTarget.getBoundingClientRect();
    const after = drag.kind === 'move' && e.clientY > r.top + r.height / 2;
    if (dropAt?.id !== cp.id || dropAt.after !== after) setDropAt({ id: cp.id, after });
  };
  const dropRow = (cp) => (e) => {
    if (!drag) return;
    e.preventDefault();
    const { kind, id: from } = drag;
    const after = dropAt?.id === cp.id ? dropAt.after : false;
    endDrag();
    if (from === cp.id) return;
    if (kind === 'copy') {
      setDraft((d) => ({ ...d, [cp.id]: copyRow(d[from], cp) }));
      return;
    }
    // ย้าย: จอเรียงเฉพาะจุดที่เปิดอยู่ · API ต้องได้ทุกจุดของ item (รวมที่ปิด) เรียงตาม seq แล้วย้าย id
    const shown = points.map((c) => c.id).filter((x) => x !== from);
    shown.splice(shown.indexOf(cp.id) + (after ? 1 : 0), 0, from);
    if (shown.every((x, i) => x === points[i].id)) return;
    const all = [...checkpoints].sort(bySeq).map((c) => c.id).filter((x) => x !== from);
    all.splice(all.indexOf(cp.id) + (after ? 1 : 0), 0, from);
    setOrderOverride(shown);
    onReorder?.(all);
  };

  const openEdit = (cp) => onEditPoint(cp, dirtyIds.includes(cp.id) ? draft[cp.id] : null);

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
          title: 'จำนวนชิ้น Regular time เปลี่ยน — ต้อง Re-baseline',
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
    ...(routineCat ? [{ key: ROUTINE_KEY, cat: 'Inspection Record', sub: 'Regular time' }] : []),
    ...flowCats.flatMap((c) => STAGES
      .filter((st) => (FLOW_STAGES[c.flow] ?? FLOW_STAGES.pd_qc).includes(st.key))
      .map((st) => ({ key: keyOf(c.id, st.key), cat: c.name, sub: st.label }))),
  ];
  const slotsOf = (g) => Math.max(MIN_SLOTS, ...points.map((cp) => qtyOf(draft[cp.id] ?? {}, g.key)));
  const widthOf = (g) => slotsOf(g) + (g.key === ROUTINE_KEY ? 1 : 0); // ตามรอบมีคอลัมน์ความถี่เพิ่ม
  const catSpans = [];
  for (const g of groups) {
    const last = catSpans[catSpans.length - 1];
    if (last && last.cat === g.cat) last.span += widthOf(g);
    else catSpans.push({ cat: g.cat, span: widthOf(g) });
  }
  // เซลล์ข้อมูลของแถว — คลิก = กล่องแก้จุด
  const info = (cp, extra = '') => ({ className: `cm-info ${extra}`.trim(), onClick: () => openEdit(cp) });

  return (
    <Card className={`mt-3 category-matrix${paintBox ? ' cm-painting' : ''}`}>
      <Card.Header className="d-flex flex-wrap align-items-center gap-2">
        <span>ตารางหมวดการตรวจ (แบบฟอร์ม SET UP &amp; LAST PIECE)</span>
        <span className="small text-muted fw-normal">
          คลิกช่อง = k ชิ้น · ลากในช่อง = หลายช่อง/หลายจุด · ⠿ ลากย้าย · ⧉ ลากไปวางบนแถวอื่น = คัดลอกการตั้ง · คลิกชื่อจุด = แก้จุด
        </span>
        {onDownload && (
          <Button size="sm" variant="outline-primary" className="ms-auto" onClick={onDownload}>ดาวน์โหลด Excel</Button>
        )}
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
              {points.map((cp, rowIdx) => {
                const p = draft[cp.id];
                if (!p) return null;
                const cls = [
                  dirtyIds.includes(cp.id) && 'cm-row--dirty',
                  drag?.id === cp.id && 'cp-row--dragging',
                  dropAt?.id === cp.id && drag?.kind === 'move' && (dropAt.after ? 'cp-row--drop-after' : 'cp-row--drop-before'),
                  dropAt?.id === cp.id && drag?.kind === 'copy' && drag.id !== cp.id && 'cm-row--copy-target',
                ].filter(Boolean).join(' ');
                return (
                  <tr key={cp.id} className={cls} onDragOver={overRow(cp)} onDrop={dropRow(cp)}>
                    <td {...info(cp, 'text-center num text-muted text-nowrap')}>
                      {onReorder && (
                        <span className="cp-drag" draggable title="ลากเพื่อย้ายลำดับ" aria-hidden="true"
                          onClick={(e) => e.stopPropagation()}
                          onDragStart={startDrag('move', cp)} onDragEnd={endDrag}>⠿</span>
                      )}
                      {cp.seq_no}
                    </td>
                    <th scope="row" className="mc-sticky-start fw-normal cm-name">
                      <span className="d-flex align-items-start gap-1">
                        <span className="cm-copy" draggable title="ลากไปวางบนแถวอื่น = คัดลอกการตั้งหมวดของแถวนี้" aria-hidden="true"
                          onDragStart={startDrag('copy', cp)} onDragEnd={endDrag}>⧉</span>
                        <button type="button" className="cm-name__btn" onClick={() => openEdit(cp)} title="แก้จุดนี้">
                          <b>{cp.name}</b>
                          {cp.characteristic && !String(cp.name).includes(cp.characteristic) && (
                            <span className="small text-muted ms-1">{cp.characteristic}</span>
                          )}
                        </button>
                      </span>
                    </th>
                    <td {...info(cp, 'text-center')}>{cp.is_critical ? <span className="badge bg-light text-dark">SC</span> : ''}</td>
                    <td {...info(cp)}><SpecValue checkpoint={cp} /></td>
                    <td {...info(cp, 'text-center num small cm-maxmin')}>
                      <div>{fmtLimit(cp.usl)}</div>
                      <div>{fmtLimit(cp.lsl)}</div>
                    </td>
                    <td {...info(cp, 'small')}>{cp.gauge || '—'}</td>
                    {groups.flatMap((g) => {
                      const q = qtyOf(p, g.key);
                      const inBox = paintBox && paintBox.g === g.key && rowIdx >= paintBox.r0 && rowIdx <= paintBox.r1;
                      const cells = Array.from({ length: slotsOf(g) }, (_, i) => {
                        const k = i + 1;
                        const on = k <= q;
                        const off = k > maxFor(cp);
                        const cls2 = ['cm-slot', on && 'cm-slot--on', off && 'cm-slot--off', i === 0 && 'cm-group',
                          inBox && k <= paintBox.k && 'cm-slot--painting']
                          .filter(Boolean).join(' ');
                        return (
                          <td key={`${g.key}-${k}`} className={cls2} onPointerEnter={() => overPaint(g.key, rowIdx, k)}>
                            {!off && (
                              <button type="button" className="cm-slot__btn" aria-pressed={on}
                                aria-label={`${cp.name} ${g.cat} ${g.sub} ชิ้นที่ ${k}`}
                                onPointerDown={(e) => startPaint(e, g.key, rowIdx, k)}
                                onClick={() => { if (!suppressClick.current) clickSlot(cp, g.key, k); }}>
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
