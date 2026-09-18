// frontend/src/components/MoLookupBar.js — ช่องสแกน MO + ผลค้นหาจาก IPBASS
//
// ทำไมต้องอยู่บนสุดและอยู่นอกฟอร์มใบตรวจ:
// ของเดิมช่อง MO อยู่ในฟอร์มที่เรนเดอร์ก็ต่อเมื่อเลือก item แล้ว = สแกน MO ก่อนไม่ได้เลย
// ซึ่งกลับหัวกลับหางกับหน้างาน — สิ่งที่ operator มีในมือคือใบงานที่มีบาร์โค้ด MO
// ไม่ใช่ชื่อ item · IPBASS รู้อยู่แล้วว่า MO นี้ผลิตอะไร ให้มันเลือก item ให้แทนคน
//
// ⚠️ ทุกอย่างในนี้เป็น advisory — IPBASS ล่ม / token หมดอายุ / ไม่พบ MO ต้องไม่ทำให้
//    บันทึกใบตรวจไม่ได้ ผู้ใช้เลือก item เองที่ StationBar ได้เสมอ
//
// ⚠️ ห้ามสลับ item ให้เองเมื่อผู้ใช้เลือกไว้แล้ว — การเปลี่ยน modelId ทำให้ InspectionSheet
//    ล้างค่าที่กรอกไว้ทั้งใบ (blankInputs) และ StationBar ล้างเครื่อง/ผู้ตรวจเมื่อข้าม division
//    เจอไม่ตรงให้ถามก่อนเสมอ
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Form, Button, Spinner, Alert } from 'react-bootstrap';
import { fetchMoPlan, moRowToItem, IpbassError } from '../utils/ipbass';
import { deptsFromDivisions, resolveMoItem, drawMatches, divisionIdByDept } from '../utils/moLookup';
import { masterHref } from '../utils/useModelParam';

// สถานะผลค้นหา — แยกกันชัด ๆ เพราะแต่ละอันผู้ใช้ต้องทำคนละอย่าง
// โดยเฉพาะ 'not-found' (ไม่มี MO นี้จริง) กับ 'unreachable' (เช็คไม่ได้) ห้ามยุบรวมกัน
// ⚠️ สถานะที่มีปุ่มให้กด (mismatch / no-model) ต้องเป็น warning — กล่องเทาจาง ๆ
//    ที่มีปุ่มอยู่ข้างในถูกกวาดสายตาข้ามง่ายมาก แล้วการใส่ปุ่มก็เสียเปล่า
const variantOf = (kind) =>
  kind === 'matched' ? 'success'
    : kind === 'auto-selected' ? 'info'
      : kind === 'mismatch' || kind === 'no-model' ? 'warning'
        : 'secondary';

const MoLookupBar = ({ moNo, onMoNoChange, divisions, models, currentModelId, onPickModel, onInfoChange }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);   // { kind, text, model?, item? }
  const lastLookedUp = useRef('');
  // ⚠️ ต้องเป็น ref ไม่ใช่ state — กดปุ่ม "ค้นหา" ทำให้ช่อง blur ก่อน 1 จังหวะ
  //    closure ของ onClick ยังเห็น loading === false อยู่ จะยิงซ้ำใบที่สอง
  const inFlight = useRef(false);

  // ผลค้นหาผูกกับ MO ตัวที่ค้นไป — MO เปลี่ยนเมื่อไหร่ต้องทิ้งทันที
  // ไม่งั้น item ของ MO เก่าจะติดไปกับใบถัดไปแล้วกลายเป็นหลักฐานที่ผิด
  useEffect(() => {
    if (moNo.trim().toUpperCase() !== lastLookedUp.current) {
      setResult(null);
      onInfoChange(null);
    }
  }, [moNo, onInfoChange]);

  const lookup = useCallback(async (force = false) => {
    const mo = moNo.trim();
    if (!mo || inFlight.current) return;
    // blur ยิงทุกครั้งที่ออกจากช่อง แม้ไม่ได้แก้อะไร — ค้น MO เดิมซ้ำไม่มีประโยชน์
    if (!force && mo.toUpperCase() === lastLookedUp.current) return;
    lastLookedUp.current = mo.toUpperCase();

    // ⚠️ ต้องดักก่อนยิง — depts ว่างแล้วปล่อยให้ยิง จะได้ผลว่างซึ่งหน้าตาเหมือน
    //    "ยิงแล้วไม่เจอ" เป๊ะ แล้วเราจะไปบอกผู้ใช้ว่า "ไม่พบ MO" ทั้งที่ยังไม่ได้ยิงอะไรเลย
    const depts = deptsFromDivisions(divisions);
    if (depts.length === 0) {
      setResult({ kind: 'no-dept', text: 'ยังไม่ได้ตั้ง IPBASS dept ของ Division ไหนเลย — ตั้งที่ Master Setup › Division ก่อน แล้วค่อยสแกนใหม่ (ระหว่างนี้เลือก item เองได้ตามปกติ)' });
      return;
    }

    inFlight.current = true;
    setLoading(true);
    try {
      const { rows, errors } = await fetchMoPlan(mo, depts);

      if (rows.length === 0) {
        // ⚠️ ว่างเพราะยิงไม่ผ่าน ≠ ว่างเพราะไม่มี MO นี้ — คนละข้อความ
        if (errors.length > 0) {
          setResult({ kind: 'unreachable', text: `ตรวจสอบ MO กับ IPBASS ไม่ได้ (${errors.map((e) => e.dept).join(', ')}) — เลือก item เองแล้วกรอกต่อได้ตามปกติ` });
        } else {
          setResult({ kind: 'not-found', text: `ไม่พบ MO ${mo} ใน IPBASS — ตรวจเลขอีกครั้ง หรือเลือก item เองแล้วกรอกต่อได้` });
        }
        onInfoChange(null);
        return;
      }

      const item = moRowToItem(rows[0]);
      onInfoChange(item);

      const { model, status } = resolveMoItem(models, divisions, { itemNo: item.itemNo, dept: item.dept });
      const drawWarn = model && !drawMatches(model, item.draw)
        ? ` · ⚠️ เลขแบบไม่ตรง (ระบบ ${model.drawing_no} / IPBASS ${item.draw})`
        : '';

      if (status === 'ambiguous') {
        setResult({ kind: 'ambiguous', item, text: `${item.itemNo} มีอยู่หลาย Division และ IPBASS ไม่ได้บอกว่าเป็นของที่ไหน — เลือก item เองด้านล่าง` });
        return;
      }
      if (status === 'no-model') {
        // IPBASS บอกครบแล้วว่าเป็น item อะไร แบบเลขอะไร division ไหน — พาไปตั้ง master
        // โดยหิ้วของไปให้ด้วย ไม่ปล่อยให้พิมพ์ใหม่เอง (พิมพ์ผิดตรงนี้ = จับคู่ MO ไม่เจอตลอดไป)
        // divisionIdByDept คืน null ได้ กรณีนั้นไม่ส่ง param ปล่อยให้เลือก division เอง
        setResult({
          kind: 'no-model',
          item,
          href: masterHref({ item, divisionId: divisionIdByDept(divisions, item.dept) }),
          text: `ยังไม่มี item ${item.itemNo} ในระบบ — ต้องการตั้งค่า master ไหมจ๊ะ?`,
        });
        return;
      }

      if (String(currentModelId) === String(model.id)) {
        setResult({ kind: 'matched', item, model, text: `ตรงกับ item ที่เลือกไว้${drawWarn}` });
        return;
      }
      if (!currentModelId) {
        onPickModel(model);
        setResult({ kind: 'auto-selected', item, model, text: `ตั้งเป็น ${model.item_no} (${model.division_name ?? '-'}) ให้จาก MO แล้ว${drawWarn}` });
        return;
      }
      // เลือกไว้แล้วแต่ไม่ตรง — ถามก่อน ห้ามสลับเอง ค่าที่กรอกไว้จะหายทั้งใบ
      setResult({ kind: 'mismatch', item, model, text: `MO นี้ผลิต ${model.item_no} (${model.division_name ?? '-'}) ซึ่งไม่ตรงกับ item ที่เลือกไว้${drawWarn}` });
    } catch (err) {
      // IpbassError.urlPath มี token-adjacent info ไว้ debug เท่านั้น ห้ามขึ้นหน้าจอ
      console.error('[MoLookupBar]', err?.urlPath ?? '', err);
      const text = err instanceof IpbassError && err.kind === 'missing-token'
        ? err.message
        : 'ตรวจสอบ MO กับ IPBASS ไม่ได้ — เลือก item เองแล้วกรอกต่อได้ตามปกติ';
      setResult({ kind: 'unreachable', text });
      onInfoChange(null);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [moNo, divisions, models, currentModelId, onPickModel, onInfoChange]);

  // เครื่องสแกนบาร์โค้ดส่ง Enter ต่อท้ายให้อยู่แล้ว สแกนแล้วค้นเลยไม่ต้องกดปุ่ม
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); lookup(true); }
  };

  const item = result?.item;

  return (
    <div className="mo-lookup mb-2">
      <div className="d-flex align-items-end gap-2">
        <div style={{ maxWidth: 260, flex: '1 1 auto' }}>
          <Form.Label className="small mb-1 text-muted">MO No.</Form.Label>
          <Form.Control
            value={moNo}
            onChange={(e) => onMoNoChange(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => lookup(false)}
            placeholder="สแกน/พิมพ์ MO แล้วกด Enter"
            autoFocus
          />
        </div>
        <Button variant="outline-primary" onClick={() => lookup(true)} disabled={!moNo.trim() || loading}>
          {loading ? <Spinner animation="border" size="sm" /> : 'ค้นหา'}
        </Button>
      </div>

      {item && (
        <div className="small text-muted mt-1">
          <b>{item.itemNo}</b>
          {item.itemName && <> · {item.itemName}</>}
          {item.draw && <> · แบบ {item.draw}</>}
          {item.modelGroup && <> · กลุ่ม {item.modelGroup}</>}
        </div>
      )}

      {result && (
        <Alert variant={variantOf(result.kind)} className="py-2 px-3 mt-2 mb-0 small">
          {result.text}
          {result.kind === 'no-model' && (
            <Link to={result.href} className="btn btn-sm btn-warning ms-2">
              ไปตั้งค่า master
            </Link>
          )}
          {result.kind === 'mismatch' && (
            <Button
              size="sm" variant="warning" className="ms-2"
              onClick={() => { onPickModel(result.model); setResult({ ...result, kind: 'auto-selected', text: `เปลี่ยนเป็น ${result.model.item_no} แล้ว` }); }}
            >
              เปลี่ยนเป็น {result.model.item_no}
            </Button>
          )}
        </Alert>
      )}
    </div>
  );
};

export default MoLookupBar;
