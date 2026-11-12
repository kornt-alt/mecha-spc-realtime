// components/master/CheckpointBulkModal.js — "ตารางเพิ่มหลายจุด" ของหน้า Master
//
// ทุกทางเข้ามาจบที่กล่องนี้: วางจาก Excel (Ctrl+V ในช่องไหนก็ได้) · ไฟล์ Excel (ใบ SET UP / แม่แบบ) · คัดลอกจาก item อื่น
// ไม่มีอะไรลง DB จนกด "บันทึก" → POST /master/models/:id/checkpoints/bulk (transaction เดียว)
//
// ⚠️ แถวที่ผิด = แดง + ข้อความใต้แถว · ปุ่มบันทึกกดไม่ได้จนไม่มีแถวผิด (สเปกผิดแก้ย้อนหลังไม่ได้)
// ⚠️ กฎแปลง/ตรวจอยู่ที่ utils/checkpointBulk.js ที่เดียว — กล่องนี้แค่วาดและเก็บสเตต
// โหมด (Korn สั่ง 2026-11): อัปเดตจุดเดิม+เพิ่มใหม่ (ค่าเริ่ม · จับคู่ด้วยชื่อ) · เพิ่มใหม่อย่างเดียว · แทนทั้งชุด
// ⚠️ แถวที่ชื่อตรงจุดเดิม: ตารางโชว์ "ค่าที่จะบันทึก" (results[i].view = จุดเดิม + ช่องที่วาง/แก้) ไม่ใช่แถวร่างดิบ
// ⚠️ animation={false} + backdrop="static" ตามกฎกล่องของทั้งแอป (AppDialog) · ข้อความในกล่องใช้ .form-note ไม่ใช่ <Alert>
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import { apiCall, apiUpload } from '../../utils/api';
import {
  BASE_COLUMNS, blankDraft, draftToPayload, draftFromParsed, gridColumns, isBlankDraft, pasteIntoDrafts,
  setCell, tableToDrafts, validateAll,
} from '../../utils/checkpointBulk';

// ไฟล์ Excel → { drafts, notes } (ไม่เขียน DB) — ใช้ทั้งปุ่ม/ลากไฟล์บนการ์ดจุดตรวจ และปุ่ม "เพิ่มจากไฟล์" ในกล่องนี้
export const importCheckpointFile = async (modelId, file, categories) => {
  if (!/\.xlsx$/i.test(file?.name ?? '')) {
    throw new Error(`"${file?.name ?? 'ไฟล์'}" ไม่ใช่ไฟล์ .xlsx — ไฟล์ .xls รุ่นเก่าให้เปิดใน Excel แล้ว Save As เป็น .xlsx ก่อน`);
  }
  const res = await apiUpload(`/master/models/${modelId}/import/parse`, file);
  if (res.format === 'setup') {
    const drafts = res.points.map((p) => draftFromParsed(p, (res.errors ?? []).filter((e) => e.row === p.row)));
    return {
      drafts,
      notes: [`อ่านจากใบ SET UP${res.itemNo ? ` (${res.itemNo})` : ''} ได้ ${drafts.length} จุด — Set up PD/QC ตั้งจำนวนชิ้นตามใบให้แล้ว`, ...(res.warnings ?? [])],
    };
  }
  const t = tableToDrafts(res.rows ?? [], gridColumns(categories));
  if (!t) throw new Error('ไม่รู้จักหัวคอลัมน์ในไฟล์ — ใช้ไฟล์จากปุ่ม "ดาวน์โหลดแม่แบบ" หรือให้แถวแรกเป็นหัวคอลัมน์ (ชื่อจุดตรวจ / LSL / USL …)');
  if (t.drafts.length === 0) throw new Error('ไฟล์มีแต่หัวคอลัมน์ ยังไม่มีจุดตรวจ');
  return {
    drafts: t.drafts,
    notes: [
      `อ่านจากไฟล์ได้ ${t.drafts.length} จุด`,
      ...(t.unknownHeaders.length ? [`ข้ามคอลัมน์ที่ไม่รู้จัก: ${t.unknownHeaders.join(', ')}`] : []),
    ],
  };
};

const TYPE_OPTIONS = [{ value: 'variable', label: 'วัด' }, { value: 'attribute', label: 'ตา' }];
const FREQ_OPTIONS = [{ value: 'shift', label: 'กะ' }, { value: 'day', label: 'วัน' }];
const MODES = [
  { value: 'upsert', label: 'อัปเดตจุดเดิม + เพิ่มจุดใหม่', hint: 'ชื่อตรงกับจุดที่มีอยู่ = แก้จุดนั้น (ทับเฉพาะช่องที่วาง/แก้) · ชื่อใหม่ = เพิ่ม · จุดที่ไม่อยู่ในตาราง = ไม่แตะ · ผลตรวจเก่าไม่เปลี่ยนตาม (ตัดสินไว้แล้วตอนตรวจ)' },
  { value: 'add', label: 'เพิ่มใหม่อย่างเดียว', hint: 'ชื่อซ้ำกับจุดที่มีอยู่ = แถวแดง' },
  { value: 'replace', label: 'แทนทั้งชุด', hint: 'ปิดใช้งานจุดเดิมทั้งหมดแล้วเพิ่มชุดนี้ — ไม่ลบ ของเก่ายังอยู่เป็นหลักฐาน' },
];
const ALL_PROVIDED = [...BASE_COLUMNS.map((c) => c.key), 'settings:*'];

const CheckpointBulkModal = ({
  show, onHide, modelId, itemLabel, categories, existingPoints, initial, defaults, onSaved,
}) => {
  const columns = useMemo(() => gridColumns(categories), [categories]);
  const catLabels = useMemo(
    () => Object.fromEntries(columns.filter((c) => c.settingKey).map((c) => [c.settingKey, c.label])),
    [columns]
  );
  const [drafts, setDrafts] = useState([]);
  const [notes, setNotes] = useState([]);
  const [mode, setMode] = useState('upsert');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);
  const tableRef = useRef(null);

  // เปิดกล่อง = เริ่มจากของที่ส่งมา (ว่าง = แถวว่าง 3 แถวให้วาง)
  useEffect(() => {
    if (!show) return;
    const start = initial?.drafts?.length ? initial.drafts : [blankDraft(defaults), blankDraft(defaults), blankDraft(defaults)];
    setDrafts(start);
    setNotes(initial?.notes ?? []);
    setMode('upsert');
    setErr(null);
    setBusy(false);
  }, [show, initial, defaults]);

  const results = useMemo(
    () => validateAll(drafts, { existing: existingPoints ?? [], mode, catLabels }),
    [drafts, existingPoints, mode, catLabels]
  );
  const filledIdx = drafts.map((d, i) => (isBlankDraft(d) ? -1 : i)).filter((i) => i >= 0);
  const badCount = filledIdx.filter((i) => results[i].errors.length).length;
  const updIdx = filledIdx.filter((i) => results[i].match && results[i].changes.length);
  const sameIdx = filledIdx.filter((i) => results[i].match && !results[i].changes.length);
  const addIdx = filledIdx.filter((i) => !results[i].match);
  const sendCount = addIdx.length + updIdx.length;

  const update = (idx, colKey, value) => setDrafts((list) => list.map((d, i) => {
    if (i !== idx) return d;
    let next = setCell(d, colKey, value);
    if (colKey === 'char_type' && next.char_type === 'attribute') next = { ...next, sample_size: '1' };
    return { ...next, note: '' };
  }));

  // Ctrl+V: หลายช่อง (มี tab/ขึ้นบรรทัด) = เติมเป็นตาราง · ข้อความเดียว = ให้ช่องจัดการเองตามปกติ
  const onPaste = (idx, colKey) => (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return;
    e.preventDefault();
    const r = pasteIntoDrafts(drafts, text, { rowIndex: idx, colKey, columns, defaults });
    setDrafts(r.drafts);
    if (r.mode === 'header') {
      setNotes((n) => [...n, `วางมา ${r.added} จุด (อ่านจากหัวคอลัมน์)`,
        ...(r.unknownHeaders?.length ? [`ข้ามคอลัมน์ที่ไม่รู้จัก: ${r.unknownHeaders.join(', ')}`] : [])]);
    }
  };

  // Enter = ช่องเดียวกันของแถวถัดไป (แบบ Excel) · แถวสุดท้ายเพิ่มแถวให้
  const onKeyDown = (idx, colIdx) => (e) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const go = () => tableRef.current
      ?.querySelector(`[data-row="${idx + 1}"][data-col="${colIdx}"]`)?.focus();
    if (idx === drafts.length - 1) { setDrafts((l) => [...l, blankDraft(defaults)]); setTimeout(go, 0); } else go();
  };

  const addRows = (n = 1) => setDrafts((l) => [...l, ...Array.from({ length: n }, () => blankDraft(defaults))]);
  const removeRow = (idx) => setDrafts((l) => (l.length === 1 ? [blankDraft(defaults)] : l.filter((_, i) => i !== idx)));
  // ทำซ้ำจากค่าที่เห็นบนจอ (แถวที่ตรงจุดเดิม = ค่าที่ merge แล้ว) → แถวใหม่ส่งครบทุกช่อง
  const duplicateRow = (idx) => setDrafts((l) => {
    const src = results[idx]?.view ?? l[idx];
    const copy = { ...src, key: blankDraft().key, provided: ALL_PROVIDED, name: src.name ? `${src.name} (สำเนา)` : '' };
    return [...l.slice(0, idx + 1), copy, ...l.slice(idx + 1)];
  });

  const addFromFile = async (file) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await importCheckpointFile(modelId, file, categories);
      setDrafts((l) => [...l.filter((d) => !isBlankDraft(d)), ...r.drafts]);
      setNotes((n) => [...n, ...r.notes]);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await apiCall(`/master/models/${modelId}/checkpoints/bulk`, {
        method: 'POST',
        body: { points: [...addIdx, ...updIdx].sort((a, b) => a - b).map((i) => draftToPayload(results[i].view)), mode },
      });
      onSaved(res);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const cell = (raw, idx, col, colIdx) => {
    const d = results[idx]?.view ?? raw;
    const common = {
      size: 'sm', 'data-row': idx, 'data-col': colIdx, 'aria-label': `${col.label} แถว ${idx + 1}`,
      onPaste: onPaste(idx, col.key), onKeyDown: onKeyDown(idx, colIdx),
    };
    const isAttr = d.char_type === 'attribute';
    if (col.key.startsWith('cat:')) {
      return <Form.Control {...common} className="num text-center" inputMode="numeric" placeholder="—"
        value={d.settings?.[col.settingKey] ?? ''} onChange={(e) => update(idx, col.key, e.target.value)} />;
    }
    if (col.kind === 'bool') {
      return <Form.Check className="text-center" aria-label={common['aria-label']} data-row={idx} data-col={colIdx}
        checked={Boolean(d[col.key])} onChange={(e) => update(idx, col.key, e.target.checked)} />;
    }
    if (col.kind === 'type' || col.kind === 'freq') {
      const opts = col.kind === 'type' ? TYPE_OPTIONS : FREQ_OPTIONS;
      const value = d[col.key];
      return (
        <Form.Select {...common} value={value} onChange={(e) => update(idx, col.key, e.target.value)}>
          {/* ค่าที่วางมาแล้วไม่รู้จัก ต้องโชว์ตามจริง (แถวแดง) ไม่ใช่โชว์ตัวเลือกแรกทั้งที่ค่าไม่ใช่ */}
          {!opts.some((o) => o.value === value) && <option value={value}>{value}</option>}
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Form.Select>
      );
    }
    const disabled = isAttr && ['unit', 'lsl', 'target', 'usl', 'sample_size'].includes(col.key);
    return (
      <Form.Control {...common}
        className={col.kind === 'num' || col.kind === 'qty' ? 'num text-end' : undefined}
        inputMode={col.kind === 'num' ? 'decimal' : col.kind === 'qty' ? 'numeric' : undefined}
        disabled={disabled}
        value={disabled ? '' : (d[col.key] ?? '')}
        onChange={(e) => update(idx, col.key, e.target.value)} />
    );
  };

  return (
    <Modal show={show} onHide={busy ? undefined : onHide} animation={false} backdrop="static" size="xl"
      fullscreen="lg-down" dialogClassName="bulk-modal">
      <Modal.Header closeButton={!busy}>
        <Modal.Title>เพิ่มหลายจุด — {itemLabel}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="form-note form-note--info mb-2">
          ก๊อปหลายแถวจาก Excel แล้ว <b>คลิกช่องในตาราง กด Ctrl+V</b> — มีหัวคอลัมน์ (ชื่อจุดตรวจ / LSL / USL / ค่ากลาง / พิกัดบน …)
          ระบบจับคอลัมน์ให้เอง · ไม่มีหัว = เติมจากช่องที่คลิกไปทางขวา · ยังไม่บันทึกจนกด "บันทึก"
        </div>
        {notes.map((n, i) => <div key={`${i}-${n}`} className="form-note form-note--info mb-2">{n}</div>)}

        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <Button size="sm" variant="outline-primary" onClick={() => addRows(1)} disabled={busy}>+ เพิ่มแถว</Button>
          <Button size="sm" variant="outline-primary" onClick={() => fileRef.current?.click()} disabled={busy}>เพิ่มจากไฟล์ Excel</Button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden
            onChange={(e) => { addFromFile(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="ms-auto small">
            เพิ่ม {addIdx.length}
            {mode === 'upsert' && <> · อัปเดต {updIdx.length} · ไม่เปลี่ยน {sameIdx.length}</>}
            {badCount > 0 && <span className="text-danger ms-2">ต้องแก้ {badCount} แถว</span>}
          </span>
        </div>
        <div className="mb-2" role="radiogroup" aria-label="วิธีบันทึก">
          {MODES.map((m) => (
            <Form.Check key={m.value} inline type="radio" id={`bulk-mode-${m.value}`} name="bulk-mode" disabled={busy}
              label={m.label} checked={mode === m.value} onChange={() => setMode(m.value)} />
          ))}
          <div className="small text-muted">{MODES.find((m) => m.value === mode)?.hint}</div>
        </div>

        <div className="mc-freeze bulk-grid-wrap" ref={tableRef}>
          <table className="table table-sm table-bordered mb-0 bulk-grid">
            <thead>
              <tr>
                <th className="mc-sticky-start" style={{ width: 40 }}>#</th>
                {columns.map((c) => <th key={c.key} style={{ minWidth: c.width }} className="text-nowrap">{c.label}</th>)}
                <th className="mc-sticky-end" style={{ width: 96 }} />
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, idx) => {
                const blank = isBlankDraft(d);
                const { errors, warnings, match, changes } = results[idx];
                const bad = !blank && errors.length > 0;
                const tag = blank || mode !== 'upsert' ? null : !match ? 'new' : changes.length ? 'upd' : 'same';
                return (
                  <React.Fragment key={d.key}>
                    <tr className={bad ? 'bulk-grid__bad' : tag === 'same' ? 'bulk-grid__same' : undefined}>
                      <td className="mc-sticky-start text-muted num">
                        {idx + 1}
                        {tag === 'upd' && <span className="bulk-tag bulk-tag--upd" title="อัปเดตจุดเดิม">แก้</span>}
                        {tag === 'same' && <span className="bulk-tag" title="ค่าเท่าจุดเดิม ไม่บันทึก">=</span>}
                      </td>
                      {columns.map((c, ci) => <td key={c.key}>{cell(d, idx, c, ci)}</td>)}
                      <td className="mc-sticky-end text-nowrap">
                        <Button size="sm" variant="link" className="p-0 me-2" onClick={() => duplicateRow(idx)} disabled={busy}>ทำซ้ำ</Button>
                        <Button size="sm" variant="link" className="p-0 text-danger" onClick={() => removeRow(idx)} disabled={busy}>ลบ</Button>
                      </td>
                    </tr>
                    {!blank && (errors.length > 0 || warnings.length > 0 || tag === 'upd' || tag === 'same') && (
                      <tr className="bulk-grid__msg">
                        <td className="mc-sticky-start" />
                        <td colSpan={columns.length + 1}>
                          {tag === 'upd' && (
                            <span className="bulk-grid__diff me-3">
                              อัปเดตจุดเดิม: {changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(' · ')}
                            </span>
                          )}
                          {tag === 'same' && <span className="text-muted me-3">ตรงกับจุดเดิมทุกช่อง — ไม่บันทึก</span>}
                          {errors.map((m) => <span key={m} className="text-danger me-3">✕ {m}</span>)}
                          {warnings.map((m) => <span key={m} className="bulk-grid__warn me-3">! {m}</span>)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {err && <div className="form-note form-note--danger mt-2" role="status">{err}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={busy}>ยกเลิก</Button>
        <Button onClick={save} disabled={busy || sendCount === 0 || badCount > 0}>
          {busy && <Spinner size="sm" className="me-1" />}
          บันทึก{addIdx.length ? ` · เพิ่ม ${addIdx.length}` : ''}{updIdx.length ? ` · อัปเดต ${updIdx.length}` : ''}
          {sendCount === 0 && ' 0 จุด'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default CheckpointBulkModal;
