// frontend/src/components/InspectionSheet.js — ใบตรวจอิเล็กทรอนิกส์
//
// เลย์เอาต์ตามชีต Input ของฟอร์ม Excel ที่ QC ใช้ (Inspection_data_… .xlsx):
// คอลัมน์ = จุดตรวจ · แถว = ชิ้นที่ 1..n · ท้ายตารางเป็น X̄ / R / ผล ของแต่ละจุด
// หัวตาราง (`GridHead` ใน InputGrid.js) ใช้ชุดเดียวกับตารางประวัติข้างล่าง
// ใบที่กำลังกรอกจึงหน้าตาเหมือน "บรรทัดถัดไป" ของชีต Input
//
// สามอย่างที่ตั้งใจให้ลดขั้นตอนการทำงาน:
//   1. สถานี (รุ่น/เครื่อง/กะ/ผู้ตรวจ) จำไว้ใน localStorage — เปิดมากรอกค่าได้เลย
//   2. กรอกทั้งใบด้วยคีย์บอร์ดอย่างเดียว Enter เลื่อนช่อง (ลง/ขวา สลับได้) ลูกศรเลื่อนตามทิศ
//   3. บันทึกแล้วกราฟของรุ่นนี้เปิดใต้ใบตรวจทันที ไม่ต้องข้ามไป Dashboard แล้วเลือกรุ่นซ้ำ
//
// ความถี่ต่อจุด (checkpoints.frequency): จุดที่ "ทำแล้วรอบนี้" (GET /inspections/due) เป็นคอลัมน์สีเทา
// ไม่บังคับกรอก แต่กรอกได้ — กรอกแล้วต้องครบทุกชิ้น · ตัวบังคับจริงคือ POST /inspections
//
// "แก้" ในตารางประวัติ = แก้เป็นใบใหม่: เติมค่าของใบเดิมลงใบตรวจ บันทึกแล้วใบเดิมถูกยกเลิกให้
// ใน transaction เดียวกัน (POST /inspections + replaces_id) · ระหว่างแก้ จุดที่บังคับ = จุดของใบเดิม
//
// ⚠️ ค่าที่ลง DB คือค่าที่ backend ตัดสิน judgeLocal ที่นี่เป็น advisory ล้วน ๆ
//    มีไว้ให้เห็นแดงทันทีตอนพิมพ์เท่านั้น ถ้าสองฝั่งไม่ตรงกันให้ยึด server
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Container, Row, Col, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { on } from '../utils/socket';
import { normalizeRows, normalizeCheckpoints, normalizeChart, judgeLocal, toNum } from '../utils/normalize';
import { isRoutinePoint } from '../utils/checkpointForm';
import { readStation, writeStation, reconcileStation, isStationReady } from '../utils/station';
import { masterHref } from '../utils/useModelParam';
import { useDialog } from '../utils/useDialog';
import AppDialog from './AppDialog';
import MoLookupBar from './MoLookupBar';
import InspectionList from './InspectionList';
import StationBar from './StationBar';
import ControlChart from './ControlChart';
import InputGrid, { GridHead, cpDecimals, freqLabel } from './InputGrid';
import SpecValue, { decimalsOf } from './SpecValue';
import LayoutToggle, { useLayout } from './LayoutToggle';
import { cleanDecimal, specAllowsMinus } from '../utils/numericInput';

// ── ทิศของ Enter ────────────────────────────────────────────────────────
// 'down'  = ไล่ชิ้นที่ 1..n ของจุดเดียวจนจบแล้วค่อยไปจุดถัดไป (วัดด้วยเกจเดียวทีละจุด)
// 'right' = ไล่ทุกจุดของชิ้นที่ 1 แล้วค่อยขึ้นชิ้นที่ 2 (แบบกรอกชีต Input ของ Excel)
// ⚠️ ค่าตั้งต้นของทั้งระบบอยู่ที่ตัวแปรนี้ที่เดียว — ผู้ใช้สลับเองได้บนหน้าจอแล้วเครื่องจำไว้
export const ENTER_DIR_DEFAULT = 'down';
// แนวตั้ง/แนวนอนของตารางกรอก (components/LayoutToggle.js) — ค่าเริ่ม = แนวนอนแบบชีต Input เดิม
const SHEET_LAYOUT_KEY = 'spc.sheetLayout';
const SHEET_LAYOUT_DEFAULT = 'horizontal';
const ENTER_DIR_KEY = 'spc.enterDir';

// ⚠️ try/catch ทั้งอ่านและเขียน — กฎเดียวกับ utils/station.js (private mode / บล็อก storage throw ได้)
const readEnterDir = () => {
  try {
    const v = window.localStorage.getItem(ENTER_DIR_KEY);
    return v === 'down' || v === 'right' ? v : ENTER_DIR_DEFAULT;
  } catch {
    return ENTER_DIR_DEFAULT;
  }
};

const writeEnterDir = (v) => {
  try { window.localStorage.setItem(ENTER_DIR_KEY, v); } catch { /* จำไม่ได้ก็ใช้ได้ */ }
};

// จุด attribute ตั้งต้นเป็น OK (ไม่ต้องคลิกทุกจุดที่ดูด้วยตา) · `touched` บอกว่าคนเลือกเองแล้ว
// ⚠️ ต้องมี touched — จุด attribute ที่ "ทำแล้วรอบนี้" จะถูกส่งไปก็ต่อเมื่อคนแตะเองเท่านั้น
//    ไม่งั้นค่าตั้งต้น OK จะกลายเป็นผลตรวจที่ไม่มีใครตรวจจริง
const blankInputs = (list) =>
  Object.fromEntries(list.map((c) => [
    c.id,
    c.char_type === 'attribute'
      ? { judgment: 'OK', touched: false }
      : { pieces: Array(c.sample_size || 1).fill('') },
  ]));

const mean = (nums) => nums.reduce((a, b) => a + b, 0) / nums.length;

// ผลของใบเดิม (GET /inspections/:id) → inputs ของใบตรวจ · จุดที่ใบเดิมไม่มีคงค่าว่างไว้
// ค่าวัดแสดงทศนิยม max(ของสเปก, ของค่าจริง) — กฎเดียวกับ InputGrid ห้ามปัดทิ้ง
const inputsFromResults = (list, results) => {
  const out = blankInputs(list);
  const byId = new Map(list.map((c) => [c.id, c]));
  for (const r of results) {
    const cp = byId.get(Number(r.checkpoint_id));
    if (!cp) continue; // จุดที่ถูกปิดใช้งานไปแล้ว — ใบแทนไม่ต้องมี (server ก็ไม่บังคับ)
    if (cp.char_type === 'attribute') {
      out[cp.id] = { judgment: r.judgment === 'NG' ? 'NG' : 'OK', touched: true };
      continue;
    }
    const v = toNum(r.value);
    const idx = Number(r.piece_no) - 1;
    if (v === null || idx < 0 || idx >= out[cp.id].pieces.length) continue;
    out[cp.id].pieces[idx] = v.toFixed(Math.max(cpDecimals(cp), decimalsOf(v)));
  }
  return out;
};

const ENTRY_LEFT = [{ key: 'piece', label: 'ชิ้นที่', width: 4.5 }];

const InspectionSheet = () => {
  const [lookups, setLookups] = useState({ divisions: [], machines: [], inspectors: [] });
  const [models, setModels] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [station, setStation] = useState(readStation);
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
  // Set ของ checkpoint id ที่ทำแล้วรอบนี้ · null = ยังไม่รู้ (ถือว่าถึงรอบทุกจุด server ตัดสินซ้ำอยู่ดี)
  const [doneIds, setDoneIds] = useState(null);
  const [enterDir, setEnterDir] = useState(readEnterDir);
  const [layout, setLayout] = useLayout(SHEET_LAYOUT_KEY, SHEET_LAYOUT_DEFAULT);
  const vertical = layout === 'vertical';
  const [gridKey, setGridKey] = useState(0);
  // กำลัง "แก้เป็นใบใหม่" แทนใบไหน · null = ใบตรวจปกติ
  // { id, subgroup_no, mo_no, checkpointIds: Set } — checkpointIds = จุดที่ใบเดิมมี (บังคับกรอกแทนรอบปกติ)
  const [replacing, setReplacing] = useState(null);
  const { dialog, showPrompt, closeDialog } = useDialog();

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
        return reconcileStation(prev, {
          models: modelRows,
          machines: lk.machines ?? [],
          inspectors: lk.inspectors ?? [],
        });
      });
      masterLoaded.current = true;
    } catch (e) {
      setMsg({ variant: 'danger', text: `โหลดข้อมูลตั้งต้นไม่สำเร็จ: ${e.message}` });
    }
  }, []);

  // เพิ่มผู้ตรวจใหม่จากแถบสถานี — คนที่ยังไม่มีในระบบคือทางตันของคนที่กำลังจะกรอกใบตรวจ
  // ⚠️ ต้องโหลด master ใหม่ก่อนคืน id ไม่งั้น StationBar เลือก id ที่ยังไม่มีในลิสต์ของตัวเอง
  //    แล้วช่องจะว่างทั้งที่เพิ่มสำเร็จ (กับดักเดียวกับ <Form.Select> ที่ value ไม่มี option รองรับ)
  const addInspector = useCallback(async (data) => {
    const res = await apiCall('/master/add', {
      method: 'POST',
      body: {
        table: 'inspectors',
        data: {
          emp_code: data.emp_code,
          name: data.name,
          division_id: data.division_id || null,
          is_active: 1,
        },
      },
    });
    await loadMaster();
    return res.id;
  }, [loadMaster]);

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
    setReplacing(null); // เปลี่ยน item = ใบเดิมที่กำลังแก้ไม่เกี่ยวแล้ว (inputs ถูกล้างอยู่แล้ว)
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
        // เฉพาะจุดของใบตรวจตามรอบ — จุดที่ตั้งไว้แค่ Set up / Last Piece ไม่ขึ้นในใบนี้ (server ก็ปฏิเสธ)
        const list = normalizeCheckpoints(cps).filter(isRoutinePoint);
        setCheckpoints(list);
        setInputs(blankInputs(list));
        loadHistory(modelId);
      } catch (e) {
        if (!cancelled) setMsg({ variant: 'danger', text: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [station.modelId, loadHistory]);

  // ── จุดไหนถึงรอบ (ตามความถี่ต่อจุด) ────────────────────────────────────
  //
  // ⚠️ เปลี่ยนเครื่อง/กะแล้วโหลดชุดนี้ใหม่ **อย่างเดียว** ห้ามล้างค่าที่กรอกไว้
  //    (blankInputs ผูกกับการเปลี่ยน item เท่านั้น)
  const loadDue = useCallback(async () => {
    const modelId = station.modelId;
    const machineId = station.machineId;
    const shift = station.shift;
    if (!modelId || !machineId || !shift) { setDoneIds(null); return; }
    try {
      const res = await apiCall(
        `/inspections/due?model_id=${modelId}&machine_id=${machineId}&shift=${encodeURIComponent(shift)}`
      );
      setDoneIds(new Set((res.done ?? []).map(Number)));
    } catch (e) {
      // รู้ไม่ได้ = ถือว่าถึงรอบทุกจุด (กรอกเกินได้ ขาดไม่ได้)
      console.error('โหลดจุดที่ถึงรอบไม่สำเร็จ', e);
      setDoneIds(null);
    }
  }, [station.modelId, station.machineId, station.shift]);

  useEffect(() => { loadDue(); }, [loadDue]);

  // ระหว่างแก้เป็นใบใหม่ "ทำแล้ว" = จุดที่ใบเดิมไม่มี (ไม่บังคับ) — ใบเดิมอาจมาจากกะก่อน เทียบกับรอบปัจจุบันไม่ได้
  const isDone = useCallback(
    (cp) => (replacing ? !replacing.checkpointIds.has(cp.id) : Boolean(doneIds?.has(cp.id))),
    [doneIds, replacing]
  );

  // ── ตัดสิน OK/NG สด ๆ ตอนพิมพ์ ────────────────────────────────────────
  const verdicts = useMemo(() => {
    const out = {};
    for (const cp of checkpoints) {
      const inp = inputs[cp.id];
      const done = isDone(cp);
      if (cp.char_type === 'attribute') {
        const j = inp?.judgment ?? null;
        // จุดที่ทำแล้วรอบนี้ถูกนับก็ต่อเมื่อคนเลือกเอง — ค่าตั้งต้น OK ไม่ใช่ผลตรวจ
        const included = !done || Boolean(inp?.touched);
        out[cp.id] = { judgment: included ? j : null, pieces: [], xbar: null, range: null, included, complete: j !== null };
        continue;
      }
      const raws = inp?.pieces ?? [];
      const pieces = raws.map((raw) =>
        String(raw).trim() === '' ? null : judgeLocal(raw, cp.usl, cp.lsl)
      );
      // X̄ กับ R ขึ้นสดขณะพิมพ์ เหมือนคอลัมน์ X/MIN/MAX ในฟอร์ม Excel
      const nums = raws.map(toNum).filter((v) => v !== null);
      const complete = pieces.length > 0 && pieces.every((p) => p !== null);
      out[cp.id] = {
        pieces,
        judgment: pieces.includes('NG') ? 'NG' : complete ? 'OK' : null,
        xbar: nums.length > 0 ? mean(nums) : null,
        range: nums.length > 1 ? Math.max(...nums) - Math.min(...nums) : null,
        // ⚠️ จุดที่ทำแล้วรอบนี้แต่เริ่มกรอก = ต้องกรอกให้ครบทุกชิ้น (server ปฏิเสธใบที่ส่งมาครึ่ง ๆ)
        included: !done || pieces.some((p) => p !== null),
        complete,
      };
    }
    return out;
  }, [checkpoints, inputs, isDone]);

  // จุดที่จะถูกส่งไปกับใบนี้ = จุดที่ถึงรอบ + จุดที่ทำแล้วแต่คนกรอกเพิ่มเอง
  const included = checkpoints.filter((c) => verdicts[c.id]?.included);
  const filledAll = included.length > 0 && included.every((c) => verdicts[c.id]?.complete);
  const hasMo = entry.mo_no.trim() !== '';
  const ngCount = included.filter((c) => verdicts[c.id]?.judgment === 'NG').length;
  const doneCount = checkpoints.filter(isDone).length;

  // จำนวนช่องที่ต้องกรอกทั้งใบ — ใช้บอกความคืบหน้าบนแถบบันทึก (นับเฉพาะจุดที่จะถูกส่ง)
  const { totalCells, filledCells } = useMemo(() => {
    let total = 0;
    let filled = 0;
    for (const cp of checkpoints) {
      if (!verdicts[cp.id]?.included) continue;
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
  //    คืนตามลำดับใน DOM เสมอ และรองรับตารางที่แต่ละคอลัมน์มีจำนวนช่องไม่เท่ากันอยู่แล้ว
  //    ตำแหน่งอ่านจาก data-row (ชิ้น) / data-col (ลำดับจุด) ของ element เอง
  const cellPos = (el) => ({ row: Number(el.dataset.row), col: Number(el.dataset.col) });
  const allCells = () => Array.from(gridRef.current?.querySelectorAll('[data-cell]') ?? []);

  const focusCell = (el) => {
    el.focus();
    if (typeof el.select === 'function') el.select();
  };

  // Enter: 'down' = ชิ้นถัดไปของจุดเดียว (col → row) · 'right' = จุดถัดไปของชิ้นเดียว (row → col)
  // ⚠️ เรียงเองเสมอ ไม่พึ่งลำดับ DOM — แนวตั้ง/แนวนอนวาดคนละทิศ แต่ความหมายของ Enter ต้องเท่าเดิม
  const moveFocus = (from, delta) => {
    const cells = allCells()
      .map((el) => ({ el, ...cellPos(el) }))
      .sort((a, b) => (enterDir === 'down' ? a.col - b.col || a.row - b.row : a.row - b.row || a.col - b.col))
      .map((x) => x.el);
    const i = cells.indexOf(from);
    if (i === -1) return false;
    const next = cells[i + delta];
    if (!next) {
      // หมดใบแล้ว → ไปที่ปุ่มบันทึก คนกรอกจะได้กด Enter ต่อได้เลย
      if (delta > 0) saveRef.current?.focus();
      return true;
    }
    focusCell(next);
    return true;
  };

  // ลูกศร: เดินตามทิศจริงเสมอ ไม่ขึ้นกับโหมด Enter · ไม่มีช่องในทิศนั้น = อยู่กับที่
  const moveGrid = (from, dRow, dCol) => {
    const here = cellPos(from);
    const cands = allCells()
      .map((el) => ({ el, ...cellPos(el) }))
      .filter((c) => (dRow !== 0
        ? c.col === here.col && Math.sign(c.row - here.row) === dRow
        : c.row === here.row && Math.sign(c.col - here.col) === dCol));
    if (cands.length === 0) return;
    cands.sort((a, b) => (dRow !== 0 ? Math.abs(a.row - here.row) - Math.abs(b.row - here.row)
      : Math.abs(a.col - here.col) - Math.abs(b.col - here.col)));
    focusCell(cands[0].el);
  };

  const onCellKeyDown = (e) => {
    const el = e.currentTarget;
    if (e.key === 'Enter') {
      // ⚠️ ต้อง preventDefault ไม่งั้น Enter ไป submit ฟอร์ม
      //    (แลกมาด้วยการที่ Enter ในช่องไม่ใช่ "บันทึก" อีกต่อไป — ตั้งใจ
      //     ปุ่มบันทึกรับ Enter ได้เองเมื่อ focus ไปถึง)
      e.preventDefault();
      moveFocus(el, e.shiftKey ? -1 : 1);
      return;
    }
    // <select> ของจุด attribute ใช้ลูกศรขึ้น/ลงเปลี่ยนค่าเอง ไม่แย่ง
    const isSelect = el.tagName === 'SELECT';
    // ลูกศรเดินตามที่ตาเห็น — แนวตั้ง: ขึ้น/ลง = จุดตรวจ (col) · ซ้าย/ขวา = ชิ้น (row)
    const go = (dUp, dSide) => (vertical ? moveGrid(el, dSide, dUp) : moveGrid(el, dUp, dSide));
    if (e.key === 'ArrowDown' && !isSelect) { e.preventDefault(); go(1, 0); return; }
    if (e.key === 'ArrowUp' && !isSelect) { e.preventDefault(); go(-1, 0); return; }
    // ซ้าย/ขวา ย้ายช่องเฉพาะตอนเคอร์เซอร์อยู่สุดขอบข้อความ ไม่งั้นแก้ตัวเลขกลางค่าไม่ได้
    const len = el.value?.length ?? 0;
    const atStart = isSelect || (el.selectionStart === 0 && el.selectionEnd === 0);
    const atEnd = isSelect || (el.selectionStart === len && el.selectionEnd === len);
    if (e.key === 'ArrowLeft' && atStart) { e.preventDefault(); go(0, -1); return; }
    if (e.key === 'ArrowRight' && atEnd) { e.preventDefault(); go(0, 1); }
  };

  const toggleEnterDir = () => {
    const next = enterDir === 'down' ? 'right' : 'down';
    setEnterDir(next);
    writeEnterDir(next);
  };

  // ── แก้เป็นใบใหม่ ─────────────────────────────────────────────────────
  //
  // เติมค่าของใบเดิม + MO/Lot/หมายเหตุ + เครื่อง/กะ ของใบเดิม (ผู้ตรวจคงเป็นคนที่กำลังแก้)
  // ⚠️ ยังไม่ยกเลิกใบเดิมตรงนี้ — ยกเลิกตอนบันทึกใบแทนสำเร็จเท่านั้น (server ทำใน transaction เดียว)
  const startReplace = async (row) => {
    setMsg(null);
    try {
      const { inspection, results } = await apiCall(`/inspections/${row.id}`);
      setInputs(inputsFromResults(checkpoints, results ?? []));
      setEntry({ mo_no: inspection.mo_no ?? '', lot_no: inspection.lot_no ?? '', remark: inspection.remark ?? '' });
      setStation((prev) => ({ ...prev, machineId: String(inspection.machine_id), shift: inspection.shift }));
      setReplacing({
        id: inspection.id,
        subgroup_no: inspection.subgroup_no,
        mo_no: inspection.mo_no,
        checkpointIds: new Set((results ?? []).map((r) => Number(r.checkpoint_id))),
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setMsg({ variant: 'danger', text: `เปิดใบเดิมไม่สำเร็จ: ${e.message}` });
    }
  };

  const cancelReplace = () => {
    setReplacing(null);
    setInputs(blankInputs(checkpoints));
  };

  // ── บันทึก — ทั้งใบใน request เดียว ───────────────────────────────────
  // ⚠️ แก้เป็นใบใหม่ต้องถามเหตุผลก่อน (ลงเป็น voided_reason ของใบเดิม) — modal ไม่ใช่ synchronous
  //    งานบันทึกทั้งก้อนจึงอยู่ใน save() ที่ onConfirm เรียก
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!replacing) { save(null); return; }
    showPrompt({
      title: `แก้ใบตรวจ #${replacing.subgroup_no} (MO ${replacing.mo_no})`,
      body: 'ใบนี้จะถูกบันทึกเป็นใบใหม่ (เวลาและเลข subgroup ใหม่) แล้วใบเดิมถูกยกเลิกพร้อมกัน',
      inputLabel: 'เหตุผลที่แก้',
      inputHint: 'จำเป็นต้องกรอก — เช่น "พิมพ์ค่าชิ้นที่ 2 ผิด — สมชาย"',
      confirmLabel: 'บันทึกใบแทน',
      cancelLabel: 'ปิด',
      variant: 'primary',
      onConfirm: (reason) => save(reason),
    });
  };

  const save = async (replaceReason) => {
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
          ...(replacing && replaceReason ? { replaces_id: replacing.id, replace_reason: replaceReason } : {}),
          // เฉพาะจุดที่ถึงรอบ + จุดที่ทำแล้วแต่คนกรอกเพิ่มเอง (ดู verdicts[].included)
          results: included.map((cp) =>
            cp.char_type === 'attribute'
              ? { checkpoint_id: cp.id, judgment: inputs[cp.id]?.judgment ?? 'OK' }
              : {
                  checkpoint_id: cp.id,
                  pieces: (inputs[cp.id]?.pieces ?? []).map((v, i) => ({ piece_no: i + 1, value: v })),
                }
          ),
        },
      });

      // ⚠️ ใบเดิมอยู่ในช่วง baseline ที่ล็อกไว้ = เส้น control limit ยังมาจากค่าเดิม ต้องบอกให้ re-baseline
      const stale = res.staleBaselines?.length
        ? ` · ใบเดิมอยู่ในช่วง baseline ที่ล็อกไว้ ต้อง Re-baseline: ${res.staleBaselines.join(', ')}`
        : '';
      setMsg({
        variant: res.overall_result === 'NG' ? 'danger' : stale ? 'warning' : 'success',
        text: res.replaced_id
          ? `บันทึกใบแทนแล้ว — subgroup #${res.subgroup_no} · ผลรวม ${res.overall_result} · ใบเดิมถูกยกเลิกแล้ว${stale}`
          : `บันทึกแล้ว — subgroup #${res.subgroup_no} · ผลรวม ${res.overall_result}`,
      });
      setReplacing(null);
      setInputs(blankInputs(checkpoints));
      loadHistory(station.modelId);
      loadCharts(station.modelId);
      loadDue();
      setGridKey((k) => k + 1);
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
  const pieceRows = Array.from({ length: maxPieces }, (_, i) => i);

  // ── ช่องกรอก 1 ช่อง (จุด × ชิ้น) — ใช้ทั้งแนวนอนและแนวตั้ง ไม่ copy ─────────────
  // data-row = ชิ้น · data-col = ลำดับจุด (moveFocus/moveGrid อ่านจากตรงนี้ ทั้งสองโหมด)
  const renderCell = (cp, col, idx, cls) => {
    const v = verdicts[cp.id] ?? {};
    if (cp.char_type === 'attribute') {
      // จุดตรวจด้วยตา มีผลเดียวต่อใบ อยู่ช่องชิ้นที่ 1
      if (idx > 0) return <td key={idx + ':' + cp.id} className={cls} aria-hidden="true" />;
      return (
        <td key={idx + ':' + cp.id} className={cls}>
          <select
            data-cell=""
            data-row={idx}
            data-col={col}
            className={`cell${v.judgment === 'NG' ? ' cell--ng' : ''}`}
            aria-label={`ผลตรวจ ${cp.name}`}
            value={inputs[cp.id]?.judgment ?? 'OK'}
            onChange={(e) =>
              setInputs((prev) => ({ ...prev, [cp.id]: { judgment: e.target.value, touched: true } }))
            }
            onKeyDown={onCellKeyDown}
          >
            <option value="OK">OK</option>
            <option value="NG">NG</option>
          </select>
        </td>
      );
    }
    const n = cp.sample_size || 1;
    if (idx >= n) {
      // จุดนี้สุ่มน้อยชิ้นกว่าจุดอื่น — ช่องที่เกินต้องว่างและ focus ไม่ได้
      return <td key={idx + ':' + cp.id} className={`${cls} cell-none`} aria-hidden="true" />;
    }
    return (
      <td key={idx + ':' + cp.id} className={cls}>
        <input
          data-cell=""
          data-row={idx}
          data-col={col}
          className={`cell${v.pieces?.[idx] === 'NG' ? ' cell--ng' : ''}`}
          // ⚠️ type="text" ไม่ใช่ number — อ่าน selectionStart บน input[type=number]
          //    จะ throw ทำให้จับตำแหน่งเคอร์เซอร์ไม่ได้ และลูกศร/ลูกกลิ้งเมาส์
          //    ไปแก้ค่าที่กรอกไว้แล้วโดยไม่รู้ตัว · toNum ฝั่งเรากับ server แปลงให้อยู่แล้ว
          // ⚠️ รับแค่ตัวเลขกับจุด (cleanDecimal) — "-" เฉพาะจุดที่สเปกติดลบ
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={`${cp.name} ชิ้นที่ ${idx + 1}`}
          value={inputs[cp.id]?.pieces?.[idx] ?? ''}
          onChange={(e) => setPiece(cp.id, idx, cleanDecimal(e.target.value, { allowMinus: specAllowsMinus(cp) }))}
          onKeyDown={onCellKeyDown}
        />
      </td>
    );
  };


  const doneClass = (cp) => (isDone(cp) ? 'igrid__col--done' : '');

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
        <h1>Inspection Record <span className="page-head__sub">ตรวจตามรอบ</span></h1>
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
        divisions={lookups.divisions ?? []}
        machineItems={lookups.machineItems ?? []}
        onChange={setStation}
        onAddInspector={addInspector}
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

      {replacing && (
        <div className="replace-bar mb-3" role="status">
          <span>
            <b>กำลังแก้ใบ #{replacing.subgroup_no}</b> (MO {replacing.mo_no}) — บันทึกแล้วจะได้ใบใหม่
            (เวลาและเลข subgroup ใหม่ จุดย้ายไปท้ายกราฟ) และใบเดิมถูกยกเลิกให้พร้อมกัน
          </span>
          <Button size="sm" variant="outline-secondary" onClick={cancelReplace}>เลิกแก้</Button>
        </div>
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

          {/* Enter เดินลง (ทีละจุด) หรือไปขวา (ทีละชิ้น) — ค่าตั้งต้นที่ ENTER_DIR_DEFAULT เครื่องจำที่เลือกไว้ */}
          <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
            <Button size="sm" variant="outline-secondary" onClick={toggleEnterDir}
              title="สลับทิศที่ Enter พาไปช่องถัดไป (Shift+Enter = ย้อนกลับ)">
              {enterDir === 'down'
                ? `Enter ${vertical ? '→' : '↓'} ชิ้นถัดไป`
                : `Enter ${vertical ? '↓' : '→'} จุดถัดไป`}
            </Button>
            <LayoutToggle layout={layout} onChange={setLayout} />
            {doneCount > 0 && (
              <span className="small text-muted">
                {vertical ? 'แถว' : 'คอลัมน์'}สีเทา = ทำแล้วรอบนี้ ({doneCount} จุด) ไม่บังคับกรอก — กรอกเพิ่มได้ แต่ต้องครบทุกชิ้น
              </span>
            )}
          </div>

          {vertical ? (
            // ── แนวตั้ง: 1 แถวต่อจุดตรวจ (แบบฟอร์ม SET UP) — ช่องกรอกตัวเดียวกับแนวนอน (renderCell) ──
            <div className="mc-freeze setup-grid-wrap" ref={gridRef}>
              <table className="table table-sm table-bordered align-middle mb-0 setup-grid sheet-vgrid">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>No</th>
                    <th className="mc-sticky-start">จุดตรวจ</th>
                    <th>Spec</th>
                    <th>เครื่องมือวัด</th>
                    <th>Sample size</th>
                    {pieceRows.map((idx) => <th key={idx} className="text-center" style={{ width: 96 }}>{idx + 1}</th>)}
                    <th className="text-center">X̄</th>
                    <th className="text-center">R</th>
                    <th className="text-center">ผล</th>
                  </tr>
                </thead>
                <tbody>
                  {checkpoints.map((cp, col) => {
                    const v = verdicts[cp.id] ?? {};
                    const done = isDone(cp);
                    const j = v.judgment ?? null;
                    return (
                      <tr key={cp.id} className={done ? 'sheet-vgrid__done' : ''}>
                        <td>{cp.seq_no}</td>
                        <td className="mc-sticky-start">
                          {cp.characteristic && <div className="small text-muted">{cp.characteristic}</div>}
                          {cp.name}
                          {cp.is_critical && <span className="igrid__ctf ms-1" title="จุดวิกฤต — SC point">SC point</span>}
                          {done && <div><span className="igrid__due-badge">ทำแล้วรอบนี้</span></div>}
                        </td>
                        <td className="small text-nowrap"><SpecValue checkpoint={cp} /></td>
                        <td className="small text-muted">{cp.gauge || '—'}</td>
                        <td className="small text-nowrap">{freqLabel(cp)}</td>
                        {pieceRows.map((idx) => renderCell(cp, col, idx, 'sheet-vgrid__cell'))}
                        <td className="num text-center" aria-live="off">
                          {cp.char_type !== 'attribute' && typeof v.xbar === 'number' ? v.xbar.toFixed(cpDecimals(cp) + 1) : ''}
                        </td>
                        <td className="num text-center" aria-live="off">
                          {cp.char_type !== 'attribute' && typeof v.range === 'number' ? v.range.toFixed(cpDecimals(cp)) : ''}
                        </td>
                        <td className="text-center">
                          <span className={`verdict ${j === 'NG' ? 'verdict--ng' : j === 'OK' ? 'verdict--ok' : 'verdict--empty'}`}>{j ?? '—'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
          <div className="igrid-wrap" ref={gridRef}>
            <table className="igrid">
              <GridHead
                checkpoints={checkpoints}
                leftCols={ENTRY_LEFT}
                colClass={doneClass}
                badge={(cp) => (isDone(cp) ? <span className="igrid__due-badge">ทำแล้วรอบนี้</span> : null)}
              />
              <tbody>
                {pieceRows.map((idx) => (
                  <tr key={idx}>
                    <th scope="row" className="igrid__left igrid__meta text-end" style={{ left: 0, width: '4.5rem', minWidth: '4.5rem' }}>
                      {idx + 1}
                    </th>
                    {checkpoints.map((cp, col) => renderCell(cp, col, idx, `igrid__entry ${doneClass(cp)}`))}
                  </tr>
                ))}

                {/* ⚠️ aria-live="off" — ค่าพวกนี้คำนวณใหม่ทุกตัวอักษรที่พิมพ์
                    ถ้าประกาศทุกครั้ง screen reader จะพูดทับจนกรอกไม่ได้ */}
                {[
                  ['X̄', (cp, v) => (typeof v.xbar === 'number' ? v.xbar.toFixed(cpDecimals(cp) + 1) : '')],
                  ['R', (cp, v) => (typeof v.range === 'number' ? v.range.toFixed(cpDecimals(cp)) : '')],
                ].map(([label, render]) => (
                  <tr key={label} className="igrid__sum">
                    <th scope="row" className="igrid__left" style={{ left: 0, width: '4.5rem', minWidth: '4.5rem' }}>{label}</th>
                    {checkpoints.map((cp) => (
                      <td key={cp.id} className={doneClass(cp)} aria-live="off">
                        {cp.char_type === 'attribute' ? '' : render(cp, verdicts[cp.id] ?? {})}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="igrid__sum">
                  <th scope="row" className="igrid__left" style={{ left: 0, width: '4.5rem', minWidth: '4.5rem' }}>ผล</th>
                  {checkpoints.map((cp) => {
                    const j = verdicts[cp.id]?.judgment ?? null;
                    return (
                      <td key={cp.id} className={`text-center ${doneClass(cp)}`}>
                        <span className={`verdict ${j === 'NG' ? 'verdict--ng' : j === 'OK' ? 'verdict--ok' : 'verdict--empty'}`}>
                          {j ?? '—'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          )}

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
              {replacing ? 'บันทึกใบแทน' : 'บันทึกใบตรวจ'}
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

      {/* ── ข้อมูลล่าสุดแบบชีต Input — ใบที่เพิ่งบันทึกไปต่อท้ายตารางนี้ ── */}
      {station.modelId && checkpoints.length > 0 && (
        <section className="mt-4">
          <div className="page-head">
            <h2>ชีต Input — 10 ใบล่าสุด{station.machineId ? ' ของเครื่องนี้' : ''}</h2>
          </div>
          <InputGrid
            modelId={station.modelId}
            query={station.machineId ? `?machine_id=${station.machineId}` : ''}
            limit={10}
            reloadKey={gridKey}
            showStats={false}
            emptyText="ยังไม่มีใบตรวจของ item นี้"
          />
        </section>
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
          {/* กรอกผิดแล้วกดยกเลิกได้จากตรงนี้เลย — แถวไม่หาย แค่ถูกตัดออกจากกราฟ
              โหลดทั้งประวัติและกราฟใหม่หลังยกเลิก เพราะทั้งคู่เปลี่ยนพร้อมกัน */}
          <InspectionList
            rows={history}
            onReplace={startReplace}
            onChanged={async () => {
              await loadHistory(station.modelId);
              await loadCharts(station.modelId);
              // ยกเลิกใบ = จุดที่ "ทำแล้วรอบนี้" อาจกลับมาถึงรอบ
              loadDue();
              setGridKey((k) => k + 1);
            }}
          />
        </section>
      )}
      <AppDialog dialog={dialog} onHide={closeDialog} />
    </Container>
  );
};

export default InspectionSheet;
