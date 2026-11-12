// components/master/CopyFromItemModal.js — คัดลอกจุดตรวจจาก item อื่น (หน้า Master)
//
// เลือก item ต้นทาง → ติ๊กจุดที่จะเอา → ส่งเป็นแถวร่างเข้า "ตารางเพิ่มหลายจุด" (ยังไม่บันทึก แก้ต่อได้)
// ติดมาด้วย: สเปก · วิธีวัด · ตามรอบ · จำนวนชิ้นรายหมวด · ไม่ติด: baseline (เป็นของจุดเดิม คนละ process)
// ⚠️ item เลขเดียวกันมีได้ทั้งสอง division — ตัวเลือกต้องโชว์ division (hint) เสมอ
import React, { useEffect, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import { apiCall } from '../../utils/api';
import { normalizeCheckpoints } from '../../utils/normalize';
import { draftFromCheckpoint } from '../../utils/checkpointBulk';
import SearchSelect from '../SearchSelect';
import SpecValue from '../SpecValue';

const CopyFromItemModal = ({ show, onHide, models, currentModelId, onPick }) => {
  const [sourceId, setSourceId] = useState('');
  const [points, setPoints] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!show) return;
    setSourceId(''); setPoints([]); setPicked(new Set()); setErr(null); setShowInactive(false);
  }, [show]);

  useEffect(() => {
    if (!sourceId) return undefined;
    let alive = true;
    setLoading(true); setErr(null); setPoints([]);
    apiCall(`/master/models/${sourceId}?all=1`)
      .then(({ checkpoints }) => {
        if (!alive) return;
        const cps = normalizeCheckpoints(checkpoints);
        setPoints(cps);
        setPicked(new Set(cps.filter((c) => c.is_active).map((c) => c.id)));
      })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [sourceId]);

  const visible = points.filter((c) => showInactive || c.is_active);
  const allOn = visible.length > 0 && visible.every((c) => picked.has(c.id));
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(visible.map((c) => c.id)));
  const chosen = visible.filter((c) => picked.has(c.id));

  const options = models
    .filter((m) => String(m.id) !== String(currentModelId))
    .map((m) => ({ value: String(m.id), label: m.item_no, hint: `${m.item_name ?? ''} · ${m.division_name ?? ''}` }));
  const source = models.find((m) => String(m.id) === sourceId);

  return (
    <Modal show={show} onHide={onHide} animation={false} backdrop="static" size="lg">
      <Modal.Header closeButton>
        <Modal.Title>คัดลอกจุดตรวจจาก item อื่น</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="mb-2">
          <SearchSelect id="copy-source" aria-label="item ต้นทาง" value={sourceId} onChange={setSourceId}
            placeholder="-- เลือก item ต้นทาง (พิมพ์ค้นหาได้) --" options={options} />
        </div>
        {loading && <div className="text-muted small"><Spinner size="sm" className="me-1" />กำลังโหลดจุดตรวจ…</div>}
        {err && <div className="form-note form-note--danger mb-2">{err}</div>}
        {sourceId && !loading && points.length === 0 && !err && (
          <div className="form-note form-note--info">item นี้ยังไม่มีจุดตรวจ</div>
        )}
        {visible.length > 0 && (
          <>
            <div className="d-flex align-items-center gap-3 mb-1 small">
              <Form.Check id="copy-all" label={`เลือกทั้งหมด (${visible.length})`} checked={allOn} onChange={toggleAll} />
              {points.some((c) => !c.is_active) && (
                <Form.Check id="copy-inactive" label="แสดงจุดที่ปิดใช้งาน" checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)} />
              )}
            </div>
            <div className="mc-freeze" style={{ maxHeight: '50vh' }}>
              <table className="table table-sm table-hover mb-0">
                <thead>
                  <tr><th style={{ width: 36 }} /><th>ลำดับ</th><th>จุดตรวจ</th><th>สเปก</th><th>เครื่องมือวัด</th></tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.id} className={c.is_active ? '' : 'text-muted'} role="button" onClick={() => toggle(c.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Form.Check aria-label={`เลือก ${c.name}`} checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                      </td>
                      <td className="num">{c.seq_no}</td>
                      <td>{c.name}{c.characteristic && <span className="text-muted small ms-1">{c.characteristic}</span>}</td>
                      <td className="small">{c.char_type === 'attribute' ? 'ตรวจด้วยตา' : <SpecValue checkpoint={c} />}</td>
                      <td className="small">{c.gauge ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>ยกเลิก</Button>
        <Button disabled={chosen.length === 0}
          onClick={() => onPick({
            drafts: chosen.map(draftFromCheckpoint),
            notes: [`คัดลอกจาก ${source?.item_no ?? ''} (${source?.division_name ?? ''}) ${chosen.length} จุด — ตรวจดูแล้วแก้ได้ก่อนบันทึก`],
          })}>
          ใช้ {chosen.length} จุด
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default CopyFromItemModal;
