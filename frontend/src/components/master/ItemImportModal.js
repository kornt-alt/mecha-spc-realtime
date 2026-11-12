// components/master/ItemImportModal.js — นำเข้า item หลายตัว (+ จุดตรวจ) จากไฟล์ Excel
//
// file → POST /master/items/import/parse (ตารางข้อความ) → utils/itemBulk.js แมป/merge/ตรวจ → ตรวจดูในกล่อง → POST /master/items/bulk
// ⚠️ โหลด lookups/models แบบ all=1 เอง — item/ลูกค้าที่ปิดใช้งานต้องจับคู่ได้ (ไฟล์ที่ export ออกไปมีของที่ปิดด้วย)
// ⚠️ animation={false} + backdrop="static" ตามกฎกล่องของทั้งแอป · ข้อความใช้ .form-note ไม่ใช่ <Alert>
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Spinner } from 'react-bootstrap';
import { apiCall, apiUpload } from '../../utils/api';
import { categoryColumns } from '../../utils/checkpointBulk';
import { parseItemTables, modelIdsNeedingPoints, buildItemPlan, planPayload } from '../../utils/itemBulk';

const CHUNK = 300;

const ItemImportModal = ({ file, onHide, onDone }) => {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [plan, setPlan] = useState(null);
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    setPlan(null); setErr(''); setOpen(new Set()); setLoading(true);
    (async () => {
      try {
        const [tables, lookups, models] = await Promise.all([
          apiUpload('/master/items/import/parse', file),
          apiCall('/master/lookups?all=1'),
          apiCall('/master/models?all=1'),
        ]);
        const categories = lookups.categories ?? [];
        const parsed = parseItemTables(tables, { divisions: lookups.divisions, customers: lookups.customers, models, categories });
        const ids = modelIdsNeedingPoints(parsed);
        const existingPoints = new Map();
        for (let i = 0; i < ids.length; i += CHUNK) {
          const pts = await apiCall(`/master/checkpoints?model_ids=${ids.slice(i, i + CHUNK).join(',')}`);
          for (const p of pts) {
            if (!existingPoints.has(p.model_id)) existingPoints.set(p.model_id, []);
            existingPoints.get(p.model_id).push(p);
          }
        }
        const catLabels = Object.fromEntries(categoryColumns(categories).map((c) => [c.settingKey, c.label]));
        if (!cancelled) setPlan(buildItemPlan(parsed, { existingPoints, catLabels, customers: lookups.customers }));
      } catch (e) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  const s = plan?.summary;
  const payload = useMemo(() => (plan ? planPayload(plan) : { items: [] }), [plan]);
  const blocked = !plan || s.errors > 0 || payload.items.length === 0;

  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const res = await apiCall('/master/items/bulk', { method: 'POST', body: payload });
      onDone(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const tagOf = (e) => (!e.match ? 'new' : e.changes.length ? 'upd' : 'same');

  return (
    <Modal show={Boolean(file)} onHide={busy ? undefined : onHide} animation={false} backdrop="static" size="xl"
      dialogClassName="bulk-modal">
      <Modal.Header closeButton={!busy}>
        <Modal.Title>นำเข้า item จาก Excel{file ? ` — ${file.name}` : ''}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && <div className="text-muted"><Spinner size="sm" className="me-2" />กำลังอ่านไฟล์…</div>}
        {plan && (
          <>
            <div className="form-note form-note--info mb-2">
              item: เพิ่ม {s.itemsAdd} · แก้ {s.itemsUpdate} · ไม่เปลี่ยน {s.itemsSame}
              {' — '}จุดตรวจ: เพิ่ม {s.pointsAdd} · แก้ {s.pointsUpdate} · ไม่เปลี่ยน {s.pointsSame}
              <div className="small mt-1">ชีต ITEMS ช่องว่าง = ไม่แตะค่าเดิม · ชีตจุดตรวจ ช่องว่าง = ล้างค่า (เหมือนนำเข้าจุดตรวจ) · item / จุดตรวจที่ไม่อยู่ในไฟล์ = ไม่แตะ · คลิกแถวเพื่อดูจุดตรวจ</div>
            </div>
            {plan.fileErrors.map((m) => <div key={m} className="form-note form-note--danger mb-2">{m}</div>)}
            {plan.unknownHeaders.length > 0 && (
              <div className="form-note form-note--warning mb-2">ไม่รู้จักคอลัมน์ (ไม่นำเข้า): {plan.unknownHeaders.join(', ')}</div>
            )}
            {plan.entries.length === 0 && plan.fileErrors.length === 0 && (
              <div className="form-note form-note--warning mb-2">ไม่มี item ในไฟล์</div>
            )}
            <div className="mc-freeze bulk-grid-wrap">
              <table className="table table-sm table-bordered mb-0 bulk-grid item-import">
                <thead>
                  <tr>
                    <th className="mc-sticky-start" style={{ width: 70 }}>แถว</th>
                    <th>Division</th>
                    <th>Item No</th>
                    <th>ชื่อ item</th>
                    <th className="text-nowrap">จุดตรวจ</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.entries.map((e) => {
                    const tag = tagOf(e);
                    const isOpen = open.has(e.key);
                    return (
                      <React.Fragment key={e.key}>
                        <tr
                          className={`${e.hasError ? 'bulk-grid__bad' : tag === 'same' && !e.willSend ? 'bulk-grid__same' : ''} item-import__row`}
                          onClick={() => e.points.length && toggle(e.key)}
                        >
                          <td className="mc-sticky-start text-muted num text-nowrap">
                            {e.sheetRow ?? '—'}
                            {tag === 'new' && <span className="bulk-tag bulk-tag--upd" title="item ใหม่">ใหม่</span>}
                            {tag === 'upd' && <span className="bulk-tag bulk-tag--upd" title="อัปเดต item เดิม">แก้</span>}
                            {tag === 'same' && <span className="bulk-tag" title="ข้อมูล item ไม่เปลี่ยน">=</span>}
                          </td>
                          <td className="text-nowrap">{e.division?.name ?? '—'}</td>
                          <td className="text-nowrap">{e.item_no}</td>
                          <td>{e.view.item_name}</td>
                          <td className="text-nowrap num">
                            {e.points.length === 0 ? <span className="text-muted">—</span> : (
                              <>
                                {isOpen ? '▾ ' : '▸ '}
                                {e.counts.add > 0 && <span className="me-2">+{e.counts.add}</span>}
                                {e.counts.update > 0 && <span className="me-2 bulk-grid__diff">แก้ {e.counts.update}</span>}
                                {e.counts.same > 0 && <span className="me-2 text-muted">={e.counts.same}</span>}
                                {e.counts.error > 0 && <span className="text-danger">✕ {e.counts.error}</span>}
                              </>
                            )}
                          </td>
                        </tr>
                        {(e.errors.length > 0 || (e.changes?.length ?? 0) > 0 || !e.fromItems) && (
                          <tr className="bulk-grid__msg">
                            <td className="mc-sticky-start" />
                            <td colSpan={4}>
                              {!e.fromItems && <span className="text-muted me-3">ไม่อยู่ในชีต ITEMS — แก้เฉพาะจุดตรวจ</span>}
                              {e.changes?.length > 0 && (
                                <span className="bulk-grid__diff me-3">
                                  {e.changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(' · ')}
                                </span>
                              )}
                              {e.errors.map((m) => <span key={m} className="text-danger me-3">✕ {m}</span>)}
                            </td>
                          </tr>
                        )}
                        {isOpen && e.points.map((p) => {
                          const ptag = !p.match ? 'new' : p.changes.length ? 'upd' : 'same';
                          return (
                            <tr key={p.draft.key} className={`bulk-grid__msg${p.errors.length ? ' bulk-grid__bad' : ''}`}>
                              <td className="mc-sticky-start text-muted num">↳ {p.draft.sheetRow}</td>
                              <td colSpan={4}>
                                <span className="me-2">{p.view.name}</span>
                                {ptag === 'new' && <span className="bulk-tag bulk-tag--upd me-2">ใหม่</span>}
                                {ptag === 'upd' && (
                                  <span className="bulk-grid__diff me-3">
                                    แก้: {p.changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(' · ')}
                                  </span>
                                )}
                                {ptag === 'same' && <span className="text-muted me-3">ไม่เปลี่ยน</span>}
                                {p.errors.map((m) => <span key={m} className="text-danger me-3">✕ {m}</span>)}
                                {p.warnings.map((m) => <span key={m} className="bulk-grid__warn me-3">! {m}</span>)}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {err && <div className="form-note form-note--danger mt-2" role="status">{err}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={busy} autoFocus>ยกเลิก</Button>
        <Button onClick={save} disabled={busy || loading || blocked}>
          {busy && <Spinner size="sm" className="me-1" />}
          {!plan ? 'บันทึก' : s.errors > 0 ? `แก้ไฟล์ก่อน (ผิด ${s.errors})`
            : payload.items.length === 0 ? 'ไม่มีอะไรเปลี่ยน'
              : `บันทึก · item เพิ่ม ${s.itemsAdd} · อัปเดต ${payload.items.length - s.itemsAdd} · จุดตรวจ +${s.pointsAdd} แก้ ${s.pointsUpdate}`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ItemImportModal;
