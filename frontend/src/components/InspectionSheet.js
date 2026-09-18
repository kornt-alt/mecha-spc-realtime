// frontend/src/components/InspectionSheet.js — ใบตรวจอิเล็กทรอนิกส์
//
// เลย์เอาต์ตามฟอร์มจริงที่หน้างานใช้ (132205300022D.xlsx ชีต "inspection record"):
// แถว = จุดตรวจ · คอลัมน์ = ชิ้นที่ 1..n · ขวาสุดเป็น X̄/R และผลตัดสิน
// คนกรอกจำ layout นี้ได้อยู่แล้ว ไม่ต้องเรียนรู้ใหม่
//
// สามอย่างที่ตั้งใจให้ลดขั้นตอนการทำงาน:
//   1. สถานี (รุ่น/เครื่อง/กะ/ผู้ตรวจ) จำไว้ใน localStorage — เปิดมากรอกค่าได้เลย
//   2. กรอกทั้งใบด้วยคีย์บอร์ดอย่างเดียว Enter/ลูกศรเลื่อนช่อง จบแถวขึ้นแถวใหม่เอง
//   3. บันทึกแล้วกราฟของรุ่นนี้เปิดใต้ใบตรวจทันที ไม่ต้องข้ามไป Dashboard แล้วเลือกรุ่นซ้ำ
//
// ⚠️ ค่าที่ลง DB คือค่าที่ backend ตัดสิน judgeLocal ที่นี่เป็น advisory ล้วน ๆ
//    มีไว้ให้เห็นแดงทันทีตอนพิมพ์เท่านั้น ถ้าสองฝั่งไม่ตรงกันให้ยึด server
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Container, Row, Col, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { on } from '../utils/socket';
import { normalizeRows, normalizeCheckpoints, normalizeChart, judgeLocal, toNum } from '../utils/normalize';
import { currentShift } from '../utils/config';
import { readStation, writeStation, reconcileStation, isStationReady } from '../utils/station';
import { masterHref } from '../utils/useModelParam';
import MoLookupBar from './MoLookupBar';
import SpecValue from './SpecValue';
import StationBar from './StationBar';
import ControlChart from './ControlChart';

const blankInputs = (list) =>
  Object.fromEntries(list.map((c) => [
    c.id,
    c.char_type === 'attribute'
      ? { judgment: 'OK' }
      : { pieces: Array(c.sample_size || 1).fill('') },
  ]));

const mean = (nums) => nums.reduce((a, b) => a + b, 0) / nums.length;

const InspectionSheet = () => {
  const [lookups, setLookups] = useState({ divisions: [], machines: [], inspectors: [] });
  const [models, setModels] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [station, setStation] = useState(() => {
    const s = readStation();
    return { ...s, shift: s.shift || currentShift() };
  });
  const [entry, setEntry] = useState({ mo_no: '', lot_no: '', remark: '' });
  // สิ่งที่ IPBASS ตอบมาสำหรับ MO ปัจจุบัน (null = ยังไม่ได้ค้น / ค้นแล้วไม่เจอ / ค้นไม่ได้)
  // ส่งไปกับ payload เป็น snapshot เฉย ๆ ไม่มีผลต่อการตัดสิน OK/NG
  const [moInfo, setMoInfo] = useState(null);
  // inputs[checkpointId] = { pieces: ['9.98', ...] } หรือ { judgment: 'OK'|'NG' }
  const [inputs, setInputs] = useState({});
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [charts, setCharts] = useState(null);      // null = ยังไม่เคยบันทึกในรอบนี้
  const [chartsLoading, setChartsLoading] = useState(false);

  const gridRef = useRef(null);
  const saveRef = useRef(null);
  const masterLoaded = useRef(false);

  const ready = isStationReady(station);

  // ── โหลด master ───────────────────────────────────────────────────────
  const loadMaster = useCallback(async () => {
    try {
      const [lk, ms] = await Promise.all([apiCall('/master/lookups'), apiCall('/master/models')]);
      const modelRows = normalizeRows(ms);
      setLookups(lk);
      setModels(modelRows);

      // ⚠️ สถานีที่จำไว้อาจชี้ไป master ที่ถูกปิดใช้งาน/ลบไปแล้ว ต้องกรองก่อนใช้
      //    ไม่งั้น <Form.Select> มี value ที่ไม่มี <option> รองรับ = ช่องว่างที่อธิบายตัวเองไม่ได้
      setStation((prev) => {
        const fixed = reconcileStation(prev, {
          models: modelRows,
          machines: lk.machines ?? [],
          inspectors: lk.inspectors ?? [],
        });
        return { ...fixed, shift: fixed.shift || currentShift() };
      });
      masterLoaded.current = true;
    } catch (e) {
      setMsg({ variant: 'danger', text: `โหลดข้อมูลตั้งต้นไม่สำเร็จ: ${e.message}` });
    }
  }, []);

  useEffect(() => { loadMaster(); }, [loadMaster]);
  useEffect(() => on('master_updated', loadMaster), [loadMaster]);

  // จำสถานีไว้ — เขียนหลัง master โหลดเสร็จเท่านั้น ไม่งั้นรอบแรกจะเขียนค่าว่างทับของเดิม
  useEffect(() => {
    if (masterLoaded.current) writeStation(station);
  }, [station]);

  // ── เลือกรุ่น → โหลดจุดตรวจ + ประวัติ ─────────────────────────────────
  const loadHistory = useCallback(async (modelId) => {
    if (!modelId) return setHistory([]);
    try {
      setHistory(normalizeRows(await apiCall(`/inspections?model_id=${modelId}&limit=10`)));
    } catch (e) {
      console.error('โหลดประวัติไม่สำเร็จ', e);
    }
  }, []);

  useEffect(() => {
    const modelId = station.modelId;
    setCharts(null);
    if (!modelId) {
      setCheckpoints([]);
      setInputs({});
      setHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { checkpoints: cps } = await apiCall(`/master/models/${modelId}`);
        if (cancelled) return;
        const list = normalizeCheckpoints(cps);
        setCheckpoints(list);
        setInputs(blankInputs(list));
        loadHistory(modelId);
      } catch (e) {
        if (!cancelled) setMsg({ variant: 'danger', text: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [station.modelId, loadHistory]);

  // ── ตัดสิน OK/NG สด ๆ ตอนพิมพ์ ────────────────────────────────────────
  const verdicts = useMemo(() => {
    const out = {};
    for (const cp of checkpoints) {
      const inp = inputs[cp.id];
      if (cp.char_type === 'attribute') {
        out[cp.id] = { judgment: inp?.judgment ?? null, pieces: [], xbar: null, range: null };
        continue;
      }
      const raws = inp?.pieces ?? [];
      const pieces = raws.map((raw) =>
        String(raw).trim() === '' ? null : judgeLocal(raw, cp.usl, cp.lsl)
      );
      // X̄ กับ R ขึ้นสดขณะพิมพ์ เหมือนคอลัมน์ X/MIN/MAX ในฟอร์ม Excel
      const nums = raws.map(toNum).filter((v) => v !== null);
      out[cp.id] = {
        pieces,
        judgment: pieces.includes('NG') ? 'NG' : pieces.length > 0 && pieces.every((p) => p === 'OK') ? 'OK' : null,
        xbar: nums.length > 0 ? mean(nums) : null,
        range: nums.length > 1 ? Math.max(...nums) - Math.min(...nums) : null,
      };
    }
    return out;
  }, [checkpoints, inputs]);

  const filledAll = checkpoints.length > 0 && checkpoints.every((c) => verdicts[c.id]?.judgment !== null);
  const hasMo = entry.mo_no.trim() !== '';
  const ngCount = checkpoints.filter((c) => verdicts[c.id]?.judgment === 'NG').length;

  // จำนวนช่องที่ต้องกรอกทั้งใบ — ใช้บอกความคืบหน้าบนแถบบันทึก
  const { totalCells, filledCells } = useMemo(() => {
    let total = 0;
    let filled = 0;
    for (const cp of checkpoints) {
      if (cp.char_type === 'attribute') {
        total += 1;
        if (verdicts[cp.id]?.judgment) filled += 1;
        continue;
      }
      const raws = inputs[cp.id]?.pieces ?? [];
      total += raws.length;
      filled += raws.filter((r) => String(r).trim() !== '').length;
    }
    return { totalCells: total, filledCells: filled };
  }, [checkpoints, inputs, verdicts]);

  const setPiece = (cpId, idx, value) =>
    setInputs((prev) => {
      const pieces = [...(prev[cpId]?.pieces ?? [])];
      pieces[idx] = value;
      return { ...prev, [cpId]: { ...prev[cpId], pieces } };
    });

  // ── เลื่อน focus ด้วยคีย์บอร์ด ─────────────────────────────────────────
  //
  // ⚠️ ใช้ querySelectorAll บน container ไม่ใช่ array ของ ref
  //    ลำดับจุดตรวจเปลี่ยนได้ระหว่างกรอก (MasterSetup ย้ายลำดับ → emit master_updated
  //    → หน้านี้โหลดใหม่) array ที่อิง index จะชี้ผิดทันที ส่วน querySelectorAll
  //    คืนตามลำดับใน DOM เสมอ และรองรับตารางที่แต่ละแถวมีจำนวนช่องไม่เท่ากันอยู่แล้ว
  const moveFocus = (from, delta) => {
    const cells = Array.from(gridRef.current?.querySelectorAll('[data-cell]') ?? []);
    const i = cells.indexOf(from);
    if (i === -1) return false;
    const next = cells[i + delta];
    if (!next) {
      // หมดใบแล้ว → ไปที่ปุ่มบันทึก คนกรอกจะได้กด Enter ต่อได้เลย
      if (delta > 0) saveRef.current?.focus();
      return true;
    }
    next.focus();
    if (typeof next.select === 'function') next.select();
    return true;
  };

  const onCellKeyDown = (e) => {
    if (e.key === 'Enter') {
      // ⚠️ ต้อง preventDefault ไม่งั้น Enter ไป submit ฟอร์ม
      //    (แลกมาด้วยการที่ Enter ในช่องไม่ใช่ "บันทึก" อีกต่อไป — ตั้งใจ
      //     ปุ่มบันทึกรับ Enter ได้เองเมื่อ focus ไปถึง)
      e.preventDefault();
      moveFocus(e.currentTarget, 1);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(e.currentTarget, 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(e.currentTarget, -1); }
  };

  // ── บันทึก — ทั้งใบใน request เดียว ───────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const res = await apiCall('/inspections', {
        method: 'POST',
        body: {
          model_id: station.modelId,
          machine_id: station.machineId,
          inspector_id: station.inspectorId,
          shift: station.shift,
          mo_no: entry.mo_no,
          lot_no: entry.lot_no,
          remark: entry.remark,
          // audit trail: MO ใบนี้ IPBASS บอกว่าเป็น item อะไร ณ เวลาที่ตรวจ
          // ไม่ตรงกับ item ที่เลือก = ติดใบตรวจผิด ตรวจย้อนหลังได้จากตรงนี้
          mo_item_no: moInfo?.itemNo ?? '',
          mo_item_name: moInfo?.itemName ?? '',
          mo_draw: moInfo?.draw ?? '',
          mo_model_group: moInfo?.modelGroup ?? '',
          results: checkpoints.map((cp) =>
            cp.char_type === 'attribute'
              ? { checkpoint_id: cp.id, judgment: inputs[cp.id]?.judgment ?? 'OK' }
              : {
                  checkpoint_id: cp.id,
                  pieces: (inputs[cp.id]?.pieces ?? []).map((v, i) => ({ piece_no: i + 1, value: v })),
                }
          ),
        },
      });

      setMsg({
        variant: res.overall_result === 'NG' ? 'danger' : 'success',
        text: `บันทึกแล้ว — subgroup #${res.subgroup_no} · ผลรวม ${res.overall_result}`,
      });
      setInputs(blankInputs(checkpoints));
      loadHistory(station.modelId);
      loadCharts(station.modelId);
    } catch (err) {
      setMsg({ variant: 'danger', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  // ── กราฟหลังบันทึก ────────────────────────────────────────────────────
  //
  // ⚠️ ใช้ /reports/model/:id เส้นเดียว ไม่ใช่ยิง /charts/:checkpointId ทีละจุด
  //    เส้นนี้คืน charts[] รูปเดียวกันครบทุกจุดในคำขอเดียว (Dashboard ก็ใช้เส้นนี้)
  //    ยิงทีละจุดคือ 10-20 request ต่อการบันทึกหนึ่งครั้ง
  //    และ id ที่ POST /inspections คืนมาเป็น inspection id ไม่ใช่ checkpoint id
  //    เอาไปใส่ /charts/:checkpointId จะได้กราฟของจุดอื่นแบบเงียบ ๆ
  const loadCharts = useCallback(async (modelId) => {
    if (!modelId) return;
    setChartsLoading(true);
    try {
      const res = await apiCall(`/reports/model/${modelId}`);
      // charts[] มีทั้งจุด variable และจุด attribute (mode:'attribute', limits:null)
      // ControlChart แยกสาขาเองอยู่แล้ว ไม่ต้องกรองออก
      setCharts((res.charts ?? []).map(normalizeChart));
    } catch (e) {
      console.error('โหลดกราฟไม่สำเร็จ', e);
    } finally {
      setChartsLoading(false);
    }
  }, []);

  const maxPieces = checkpoints.reduce(
    (m, c) => Math.max(m, c.char_type === 'attribute' ? 1 : c.sample_size || 1),
    1
  );
  const pieceCols = Array.from({ length: maxPieces }, (_, i) => i + 1);

  const setMoNo = useCallback((v) => setEntry((prev) => ({ ...prev, mo_no: v })), []);

  // เลือก item จากผลค้นหา MO — ต้องทำเหมือน StationBar.setModel ทุกอย่าง
  // (ล้างเครื่อง/ผู้ตรวจที่อยู่คนละ division) ไม่งั้นจะเหลือ id ที่ไม่มี option รองรับ
  const pickModel = useCallback((model) => {
    setStation((prev) => {
      const stillValid = (list, id) =>
        id && list.some((r) => String(r.id) === id && String(r.division_id) === String(model.division_id));
      return {
        ...prev,
        modelId: String(model.id),
        machineId: stillValid(lookups.machines ?? [], prev.machineId) ? prev.machineId : '',
        inspectorId: stillValid(lookups.inspectors ?? [], prev.inspectorId) ? prev.inspectorId : '',
      };
    });
  }, [lookups.machines, lookups.inspectors]);

  const entryField = (key) => ({
    value: entry[key],
    onChange: (e) => setEntry((v) => ({ ...v, [key]: e.target.value })),
  });

  return (
    <Container fluid className="page">
      <div className="page-head">
        <h1>Check Station</h1>
        {checkpoints.length > 0 && (
          <div className="page-head__meta num">{checkpoints.length} จุดตรวจ</div>
        )}
      </div>

      {msg && <Alert variant={msg.variant} dismissible onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <MoLookupBar
        moNo={entry.mo_no}
        onMoNoChange={setMoNo}
        divisions={lookups.divisions ?? []}
        models={models}
        currentModelId={station.modelId}
        onPickModel={pickModel}
        onInfoChange={setMoInfo}
      />

      <StationBar
        station={station}
        models={models}
        machines={lookups.machines ?? []}
        inspectors={lookups.inspectors ?? []}
        onChange={setStation}
        ready={ready}
      />

      {/* ทางตันแบบเดียวกับ no-model ใน MoLookupBar — บอกว่าให้ไปทำที่ Master เฉย ๆ
          แล้วไม่มีลิงก์ให้ไป ไปถึงก็ต้องไล่หา item ในลิสต์เอง */}
      {station.modelId && checkpoints.length === 0 && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <span>item นี้ยังไม่ได้ตั้งจุดตรวจสอบไว้ — ตั้งจุดตรวจก่อนจึงจะกรอกใบตรวจได้</span>
          <Link to={masterHref({ modelId: station.modelId })} className="btn btn-sm btn-warning">
            ไปตั้งจุดตรวจ
          </Link>
        </Alert>
      )}

      {checkpoints.length > 0 && (
        <Form onSubmit={handleSubmit}>
          {/* MO ย้ายขึ้นไปอยู่ MoLookupBar บนสุดแล้ว — เป็นช่องแรกที่สแกน ไม่ใช่ช่องท้าย ๆ */}
          <Row className="g-2 mb-3">
            <Col md={3}>
              <Form.Label className="small mb-1 text-muted">Lot No.</Form.Label>
              <Form.Control {...entryField('lot_no')} />
            </Col>
            <Col md={9}>
              <Form.Label className="small mb-1 text-muted">หมายเหตุ</Form.Label>
              <Form.Control {...entryField('remark')} />
            </Col>
          </Row>

          <div className="sheet-wrap" ref={gridRef}>
            <table className="sheet">
              <thead>
                <tr>
                  <th scope="col" className="sheet__seq">#</th>
                  <th scope="col" className="sheet__name">จุดตรวจ</th>
                  <th scope="col" className="sheet__spec">สเปก</th>
                  {pieceCols.map((n) => (
                    <th scope="col" key={n} className="sheet__piece text-end">{n}</th>
                  ))}
                  <th scope="col" className="sheet__stat">X̄ / R</th>
                  <th scope="col" className="sheet__verdict">ผล</th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.map((cp) => {
                  const v = verdicts[cp.id] ?? {};
                  const isAttr = cp.char_type === 'attribute';
                  const n = isAttr ? 0 : cp.sample_size || 1;

                  return (
                    <tr key={cp.id}>
                      <td className="sheet__seq">{cp.seq_no}</td>
                      <th scope="row" className="sheet__name fw-normal">
                        <b>{cp.name}</b>
                        {cp.is_critical && (
                          <span className="badge bg-light text-dark ms-1" title="จุดวิกฤต — CTF">CTF</span>
                        )}
                        {cp.gauge && <span className="sheet__gauge">{cp.gauge}</span>}
                      </th>
                      <td className="sheet__spec"><SpecValue checkpoint={cp} /></td>

                      {isAttr ? (
                        // จุดตรวจด้วยตา กิน cell ของชิ้นทั้งหมด
                        // ⚠️ colSpan ทำให้ cell หลุดความสัมพันธ์กับหัวคอลัมน์ ต้องมี aria-label เอง
                        <td colSpan={maxPieces}>
                          <div className="d-flex gap-3" role="radiogroup" aria-label={`ผลตรวจ ${cp.name}`}>
                            {/* ⚠️ ไม่ใส่ data-cell ที่นี่ — Form.Check ของ react-bootstrap โยน prop
                                ที่ไม่รู้จักลง wrapper div ไม่ใช่ input ตัวจริง ถ้าใส่ไว้
                                moveFocus จะไปสั่ง .focus() ใส่ div ที่โฟกัสไม่ได้แล้วเงียบไปเฉย ๆ
                                จุด attribute จึงไม่อยู่ในสายพาน Enter ใช้ Tab เข้าถึงตามปกติ */}
                            {['OK', 'NG'].map((j) => (
                              <Form.Check
                                key={j}
                                type="radio"
                                id={`cp-${cp.id}-${j}`}
                                label={j}
                                name={`cp-${cp.id}`}
                                checked={inputs[cp.id]?.judgment === j}
                                onChange={() =>
                                  setInputs((prev) => ({ ...prev, [cp.id]: { judgment: j } }))
                                }
                              />
                            ))}
                          </div>
                        </td>
                      ) : (
                        <>
                          {pieceCols.map((col) => {
                            const idx = col - 1;
                            if (idx >= n) {
                              // จุดนี้สุ่มน้อยชิ้นกว่าจุดอื่น — ช่องที่เกินต้องว่างและ focus ไม่ได้
                              return <td key={col} className="sheet__piece" aria-hidden="true" />;
                            }
                            return (
                              <td key={col} className="sheet__piece">
                                <input
                                  data-cell=""
                                  className={`cell${v.pieces?.[idx] === 'NG' ? ' cell--ng' : ''}`}
                                  // ⚠️ type="text" ไม่ใช่ number — อ่าน selectionStart บน input[type=number]
                                  //    จะ throw ทำให้จับตำแหน่งเคอร์เซอร์ไม่ได้ และลูกศร/ลูกกลิ้งเมาส์
                                  //    ไปแก้ค่าที่กรอกไว้แล้วโดยไม่รู้ตัว · toNum ฝั่งเรากับ server แปลงให้อยู่แล้ว
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  aria-label={`${cp.name} ชิ้นที่ ${col}`}
                                  value={inputs[cp.id]?.pieces?.[idx] ?? ''}
                                  onChange={(e) => setPiece(cp.id, idx, e.target.value)}
                                  onKeyDown={onCellKeyDown}
                                />
                              </td>
                            );
                          })}
                        </>
                      )}

                      {/* ⚠️ aria-live="off" — ค่าพวกนี้คำนวณใหม่ทุกตัวอักษรที่พิมพ์
                          ถ้าประกาศทุกครั้ง screen reader จะพูดทับจนกรอกไม่ได้ */}
                      <td className="sheet__stat" aria-live="off">
                        {v.xbar !== null && v.xbar !== undefined ? (
                          <>
                            <b>{v.xbar.toFixed(4)}</b>
                            {v.range !== null && v.range !== undefined && <span>R {v.range.toFixed(4)}</span>}
                          </>
                        ) : (
                          <span>—</span>
                        )}
                      </td>

                      <td className="sheet__verdict">
                        <span
                          className={`verdict ${
                            v.judgment === 'NG' ? 'verdict--ng' : v.judgment === 'OK' ? 'verdict--ok' : 'verdict--empty'
                          }`}
                        >
                          {v.judgment ?? '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="savebar">
            <span className="savebar__count">
              กรอกแล้ว {filledCells}/{totalCells} ช่อง
            </span>
            {ngCount > 0 && (
              <span className="verdict verdict--ng">NG {ngCount} จุด</span>
            )}
            <span className="savebar__spacer" />
            {/* MO ว่างเคยถูกจับที่ server อย่างเดียว = กรอกครบทั้งใบแล้วค่อยโดนตีกลับ
                ตอนนี้ MO เป็นช่องแรกที่สแกน ยิ่งต้องกันตั้งแต่ตรงนี้ */}
            <Button ref={saveRef} type="submit" variant="primary" disabled={!filledAll || !ready || !hasMo || saving}>
              {saving && <Spinner size="sm" animation="border" className="me-1" />}
              บันทึกใบตรวจ
            </Button>
          </div>

          {!ready && (
            <div className="small text-muted mt-2">ตั้งค่าสถานีให้ครบก่อนจึงจะบันทึกได้</div>
          )}
          {ready && !hasMo && (
            <div className="small text-muted mt-2">กรอก MO No. ด้านบนก่อนจึงจะบันทึกได้</div>
          )}
        </Form>
      )}

      {/* ── กราฟหลังบันทึก — ไม่ต้องข้ามหน้าไปดู ── */}
      {(chartsLoading || charts) && (
        <section className="mt-4">
          <div className="page-head">
            <h2>กราฟหลังบันทึก</h2>
          </div>
          {chartsLoading && !charts ? (
            <div className="empty"><Spinner animation="border" size="sm" className="me-2" />กำลังโหลดกราฟ</div>
          ) : (
            <Row>
              {charts.map((c) => (
                <Col xl={6} key={c.checkpoint.id}>
                  <ControlChart chart={c} />
                </Col>
              ))}
            </Row>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-4">
          <div className="page-head">
            <h2>ข้อมูลล่าสุดของ model นี้</h2>
          </div>
          <div className="sheet-wrap" style={{ maxHeight: 'none' }}>
            <table className="sheet">
              <thead>
                <tr>
                  <th scope="col">เวลา</th>
                  <th scope="col">MO</th>
                  <th scope="col">Lot</th>
                  <th scope="col">Subgroup</th>
                  <th scope="col">Shift</th>
                  <th scope="col">M/C</th>
                  <th scope="col">ผู้ตรวจสอบ</th>
                  <th scope="col">จุด NG</th>
                  <th scope="col">ผล</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="num">
                      {h.inspected_at
                        ? new Date(h.inspected_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
                        : '—'}
                    </td>
                    <td>{h.mo_no ?? '—'}</td>
                    <td>{h.lot_no ?? '—'}</td>
                    <td className="num">#{h.subgroup_no}</td>
                    <td>{h.shift}</td>
                    <td>{h.machine_name ?? '—'}</td>
                    <td>{h.inspector_name ?? '—'}</td>
                    <td className="num">{h.ng_count ?? 0}</td>
                    <td>
                      <span className={`verdict ${h.overall_result === 'NG' ? 'verdict--ng' : 'verdict--ok'}`}>
                        {h.overall_result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Container>
  );
};

export default InspectionSheet;
