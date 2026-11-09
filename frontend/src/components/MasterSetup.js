// frontend/src/components/MasterSetup.js — ตั้งค่า master ทั้งหมด
//
// ของเดิมมีปุ่มแก้/ลบให้เฉพาะ spec ส่วน division/machine/part เพิ่มได้อย่างเดียว
// (จะแก้ต้องเข้าไปทำที่ DB ตรง ๆ) รอบนี้ทำให้ครบทุกชั้น + จัดลำดับจุดตรวจ + baseline
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Row, Col, Card, Form, Button, Table, Badge, Alert, Nav, Modal } from 'react-bootstrap';
import { apiCall } from '../utils/api';
import { PREFILL_KEYS } from '../utils/useModelParam';
import { on } from '../utils/socket';
import { normalizeRows, normalizeCheckpoints, numOrNull, toNum } from '../utils/normalize';
import {
  UNIT_OPTIONS, mergeOptions, specIssues, readCpMemory, rememberCp,
  limitsFromTolerance, toleranceFromLimits,
} from '../utils/checkpointForm';
import SpecValue from './SpecValue';
import AppDialog from './AppDialog';
import UsersTab from './UsersTab';
import SearchSelect from './SearchSelect';
import { useDialog } from '../utils/useDialog';

const CHAR_TYPES = [
  { value: 'variable', label: 'วัดค่า (variable)' },
  { value: 'attribute', label: 'ตรวจด้วยตา (attribute)' },
];

// ⚠️ ช่องที่เป็น "วิธีวัด" (หน่วย / เครื่องมือวัด / ชิ้นต่อครั้ง) ถูกเติมจากที่จำไว้ ไม่ใช่ค่าว่าง
//    จุดตรวจในแบบเดียวกันใช้เครื่องมือตัวเดิมกันแทบทั้งใบ พิมพ์ใหม่ทุกแถวนอกจากเสียเวลา
//    ยังทำให้สะกดไม่ตรงกันจนกลายเป็นคนละเครื่องมือในสายตาระบบ
//
// ⚠️ char_type **ไม่** sticky กลับเป็น 'variable' เสมอ — 'attribute' ที่ค้างมาจากจุดก่อนหน้า
//    จะ disable ช่องตัวเลขครึ่งฟอร์มของจุดถัดไปโดยที่คนกรอกไม่ได้สั่ง
// รูปแบบการกรอกสเปก — แบบ (drawing) ส่วนใหญ่เขียนเป็นค่ากลาง + พิกัด ไม่ใช่เลขสัมบูรณ์
// สิ่งที่บันทึกลง DB ยังเป็น LSL/Target/USL ชุดเดิมเสมอ พิกัดเป็นแค่วิธีพิมพ์
const SPEC_MODES = [
  { value: 'limits', label: 'LSL / Target / USL' },
  { value: 'tol', label: 'ค่ากลาง + พิกัดจากแบบ' },
];

const EMPTY_TOL = { nominal: '', tolUpper: '', tolLower: '' };

// ความถี่ตรวจต่อจุด (checkpoints.frequency) — หัวชีต Input ของ Excel "2 pcs / shift", "1 pcs / day"
// จุดที่ทำแล้วในรอบนั้นไม่บังคับกรอกในใบถัดไป (ดู fetchDoneCheckpointIds ฝั่ง server)
const FREQUENCIES = [
  { value: 'shift', label: 'ทุกกะ' },
  { value: 'day', label: 'ทุกวัน' },
];
const freqShort = (f) => (f === 'day' ? 'วัน' : 'กะ');

// ชุดกฎ OCS ของลูกค้า (customers.ocs_rule_set) — รูป { id, name } ตามที่ช่อง select ของ SimpleTab ใช้
const OCS_RULE_SET_OPTIONS = [
  { id: 'basic', name: 'ข้อ 1–4 (Mechanical)' },
  { id: 'full', name: 'ครบ 8 ข้อ (MAMM)' },
];

const blankCheckpoint = (memory = null) => ({
  name: '',
  char_type: 'variable',
  unit: memory?.unit ?? '',
  gauge: memory?.gauge ?? '',
  characteristic: '',
  usl: '', lsl: '', target: '',
  sample_size: memory?.sampleSize ?? 1,
  frequency: 'shift',
  is_critical: false,
  is_active: true,
});

// ไอคอนลูกศรย้ายลำดับ — เดิมเป็นอักขระ ▲▼ ซึ่งขนาดและตำแหน่งเพี้ยนตามฟอนต์ที่เครื่องมี
const Caret = ({ dir }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path
      d={dir === 'up' ? 'M6 3.5 10 8.5H2z' : 'M6 8.5 2 3.5h8z'}
      fill="currentColor"
    />
  </svg>
);

const blankModel = () => ({
  division_id: '', item_no: '', item_name: '', drawing_no: '', drawing_rev: '',
  customer_id: '', ...blankMins(),
});

// ── เกณฑ์ Cp/Cpk ขั้นต่ำของ item ────────────────────────────────────────
//
// ช่องว่าง = ใช้เกณฑ์ของลูกค้า (ไม่มีลูกค้า = ค่าระบบ) — ลำดับเลือกอยู่ที่
// backend/services/capabilityTarget.js ที่เดียว หน้านี้แค่เก็บค่า override
// ⚠️ ต้องส่ง null ไม่ใช่ '' — คอลัมน์เป็น DECIMAL(4,2) NULL และ NULL คือ "ตามลูกค้า"
const MIN_FIELDS = [
  { key: 'min_cp', label: 'Cp' },
  { key: 'min_cpk', label: 'Cpk' },
  { key: 'min_cp_ctf', label: 'Cp (SC point)' },
  { key: 'min_cpk_ctf', label: 'Cpk (SC point)' },
];
const blankMins = () => Object.fromEntries(MIN_FIELDS.map((f) => [f.key, '']));

// DECIMAL(4,2) เก็บได้ถึง 99.99 · 0 หรือติดลบไม่มีความหมายเป็นเกณฑ์
const badMin = (v) => v !== '' && v !== null && v !== undefined
  && !(Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 100);

// ค่าที่หน้าใบตรวจหิ้วมาให้ทาง URL (ดู masterHref ใน utils/useModelParam.js)
const readPrefill = (params) => {
  const out = {};
  for (const k of PREFILL_KEYS) {
    const v = params.get(k);
    if (v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
};

const MasterSetup = () => {
  const [params, setParams] = useSearchParams();

  // ⚠️ อ่านครั้งเดียวตอน mount แล้วถือไว้เอง ห้ามอ่าน params สด ๆ ทุก render
  //    <ModelsTab> เรนเดอร์ตามแท็บ กดไป Division แล้วกดกลับ = unmount แล้ว mount ใหม่
  //    ถึงตอนนั้น params ถูกล้างไปแล้ว (effect ข้างล่าง) ถ้าไปอ่านสด ๆ มันจะ seed ด้วย
  //    ค่าว่างทับของที่พิมพ์ไว้จนหายเกลี้ยง
  const [prefill] = useState(() => readPrefill(params));

  // ⚠️ ฟอร์มเพิ่ม/แก้ item ต้องอยู่ที่นี่ ไม่ใช่ใน <ModelsTab>
  //    <ModelsTab> เรนเดอร์ตามแท็บ กดไป Division แล้วกดกลับ = unmount แล้ว mount ใหม่
  //    สเตตที่อยู่ข้างในหายหมด — คนที่ถูกเด้งมาจาก MO แล้วแวะไปเพิ่ม Division ที่ขาด
  //    จะกลับมาเจอฟอร์มว่างแล้วต้องพิมพ์ใหม่ทั้งหมด ซึ่งคือสิ่งที่ฟีเจอร์นี้ตั้งใจกำจัด
  const [modelForm, setModelForm] = useState(() => ({ ...blankModel(), ...(prefill ?? {}) }));
  const [editingModel, setEditingModel] = useState(null);

  // ⚠️ ฟอร์มจุดตรวจต้องอยู่ที่นี่ด้วยเหตุผลเดียวกับ modelForm ข้างบน — <ModelsTab> unmount
  //    ทุกครั้งที่สลับแท็บ กรอกจุดตรวจค้างไว้แล้วแวะไปแท็บอื่นจะหายเกลี้ยง
  const [cpForm, setCpForm] = useState(() => blankCheckpoint(readCpMemory()));
  const [editingCp, setEditingCp] = useState(null);
  // เครื่องมือวัดที่เคยใช้ เอาไว้เป็นตัวเลือกใน <datalist> — อ่านจาก localStorage ครั้งเดียว
  // แล้วอัปเดตเองทุกครั้งที่บันทึกจุดตรวจสำเร็จ
  const [gaugeMemory, setGaugeMemory] = useState(() => readCpMemory().gauges);
  // ⚠️ โหมดกรอกสเปกไม่ sticky ลง localStorage ด้วยเหตุผลเดียวกับที่ char_type ไม่ sticky —
  //    โหมดที่ค้างมาจากเมื่อวานเปลี่ยนความหมายของช่องครึ่งฟอร์มโดยที่คนกรอกไม่ได้สั่ง
  //    แต่คงไว้ระหว่างเซสชัน เพราะแบบใบเดียวมีจุดตรวจที่เขียนรูปเดียวกันหมดสิบกว่าจุด
  // กล่องยืนยัน/แจ้งเตือนของทั้งหน้า — ตัวเดียว ไม่ซ้อนกัน (ดู utils/useDialog.js)
  const { dialog, showAlert, showConfirm, showForm, closeDialog } = useDialog();

  const [specMode, setSpecMode] = useState('limits');
  const [tolForm, setTolForm] = useState(EMPTY_TOL);

  const [tab, setTab] = useState('models');
  const [lookups, setLookups] = useState({ divisions: [], machines: [], inspectors: [] });
  const [models, setModels] = useState([]);
  // ?model= = item ที่หน้าใบตรวจอยากให้เปิดค้างไว้ (ชื่อ param เดียวกับ Dashboard/ReportPage)
  const [selectedModel, setSelectedModel] = useState(() => params.get('model') ?? '');
  const [checkpoints, setCheckpoints] = useState([]);
  const [msg, setMsg] = useState(null);
  const [baselineInfo, setBaselineInfo] = useState(null);

  // setMsg เป็น setter ที่ React การันตีว่าคงที่ ห่อ useMemo ไว้ให้ say/fail คงที่ตาม
  // ไม่งั้น useCallback ที่เรียกใช้จะถูกสร้างใหม่ทุก render แล้ว useEffect วิ่งรัว
  const { say, fail } = useMemo(() => {
    const s = (variant, text) => setMsg({ variant, text });
    return { say: s, fail: (e) => s('danger', e.message) };
  }, []);

  // ── โหลด ──────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [lk, ms] = await Promise.all([
        apiCall('/master/lookups?all=1'),
        apiCall('/master/models?all=1'),
      ]);
      setLookups(lk);
      setModels(normalizeRows(ms));
    } catch (e) { fail(e); }
  }, [fail]);

  const loadCheckpoints = useCallback(async (modelId) => {
    if (!modelId) return setCheckpoints([]);
    try {
      const { checkpoints: cps } = await apiCall(`/master/models/${modelId}?all=1`);
      setCheckpoints(normalizeCheckpoints(cps));
    } catch (e) { fail(e); }
  }, [fail]);

  // ล้าง param ของ prefill ทิ้งหลังจับค่าไว้แล้ว — ไม่ล้างแล้วกด F5 หลังบันทึก ฟอร์มจะเด้ง
  // กลับมาพร้อม item ที่เพิ่งเพิ่มไป กดเพิ่มซ้ำแล้วชน UNIQUE (division_id, item_no)
  // ⚠️ เก็บ ?model= ไว้ มันคือ "กำลังดู item ไหน" เหมือนหน้าอื่น ไม่ใช่ prefill
  useEffect(() => {
    if (!prefill) return;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      PREFILL_KEYS.forEach((k) => next.delete(k));
      return next;
    }, { replace: true });
  }, [prefill, setParams]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => on('master_updated', loadAll), [loadAll]);
  useEffect(() => { loadCheckpoints(selectedModel); }, [selectedModel, loadCheckpoints]);

  // ── ฟอร์มจุดตรวจ ──────────────────────────────────────────────────────
  //
  // ล้างเฉพาะช่องที่เป็นของจุดนั้น ๆ แล้วเติมช่องวิธีวัดจากที่จำไว้ (ดู blankCheckpoint)
  const resetCp = useCallback(() => {
    setCpForm(blankCheckpoint(readCpMemory()));
    setEditingCp(null);
    // ล้างช่องพิกัดด้วย แต่คงโหมดไว้ — จุดถัดไปในแบบใบเดียวกันเขียนรูปเดียวกัน
    setTolForm(EMPTY_TOL);
  }, []);

  const rememberMeasurement = useCallback((data) => {
    rememberCp(data);
    setGaugeMemory(readCpMemory().gauges);
  }, []);

  // ⚠️ editingCp ชี้ไปจุดตรวจของ item ที่เลือกอยู่ตอนกด "แก้" — สลับ item แล้วปล่อยค้างไว้
  //    จะกลายเป็นหัวการ์ดบอก item ใหม่แต่กดบันทึกไปแก้จุดของ item เก่า และตอนนี้ฟอร์ม
  //    ไม่ได้ unmount ตามแท็บอีกแล้ว สเตตที่ค้างจึงอยู่ได้นานกว่าเดิมมาก
  useEffect(() => { resetCp(); }, [selectedModel, resetCp]);

  // ── CRUD กลาง ─────────────────────────────────────────────────────────
  const save = async (table, data, id) => {
    try {
      const res = id
        ? await apiCall('/master/update', { method: 'PUT', body: { table, id, data } })
        : await apiCall('/master/add', { method: 'POST', body: { table, data } });

      say('success', id ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว');
      if (res.baselineMayBeStale) {
        say('warning', 'แก้ sample_size แล้ว — baseline เดิมของจุดนี้ใช้ไม่ได้ ต้องกด Re-baseline ใหม่');
      }
      await loadAll();
      if (table === 'checkpoints') await loadCheckpoints(selectedModel);
      return true;
    } catch (e) { fail(e); return false; }
  };

  const remove = (table, id, label) => showConfirm({
    title: `ลบ "${label}" ?`,
    body: 'ถ้ามีใบตรวจอ้างอิงอยู่ ระบบจะไม่ยอมลบ — ให้ปิดใช้งานแทน',
    confirmLabel: 'ลบ',
    onConfirm: async () => {
      try {
        await apiCall('/master/delete', { method: 'DELETE', body: { table, id } });
        say('success', 'ลบแล้ว');
        await loadAll();
        if (table === 'checkpoints') await loadCheckpoints(selectedModel);
      } catch (e) { fail(e); }
    },
  });

  // ชั้น 2 ของการลบ — ล้างใบที่ "ยกเลิกไปแล้ว" ออกจาก DB จริง
  //
  // มีไว้เพื่อให้ลบ item ที่ติด FK RESTRICT ได้ โดยไม่ต้อง force delete ทับหลักฐานจริง
  // ยกเลิกก่อน (ที่หน้าใบตรวจหรือหน้า Report) แล้วค่อยมากดล้างที่นี่
  const purgeVoided = (model) => showConfirm({
    title: `ล้างใบตรวจที่ยกเลิกแล้วของ ${model.item_no}`,
    body:
      `จำนวน ${model.voided_count} ใบ\n\n` +
      'อันนี้ลบออกจากฐานข้อมูลจริง กู้คืนไม่ได้',
    confirmLabel: 'ล้างทิ้งถาวร',
    onConfirm: async () => {
      try {
        const res = await apiCall('/inspections/voided', {
          method: 'DELETE', body: { model_id: model.id },
        });
        say('success', `ล้างไปแล้ว ${res.deleted} ใบ`);
        await loadAll();
      } catch (e) { fail(e); }
    },
  });

  const moveCheckpoint = async (id, direction) => {
    try {
      await apiCall(`/master/checkpoints/${id}/move`, { method: 'PUT', body: { direction } });
      await loadCheckpoints(selectedModel);
    } catch (e) { fail(e); }
  };

  // ── baseline (แยกรายเครื่อง) ──────────────────────────────────────────
  //
  // ⚠️ ขอบเขตต้องเลือก "ก่อน" พรีวิว — ตัวเลขที่พรีวิวคือค่าที่คำนวณจากใบตรวจของขอบเขตนั้น
  //    เลือกทีหลังเมื่อไหร่ คนจะเห็นเลขของชุดรวมแล้วกดล็อกให้เครื่องเดียว
  //
  // ⚠️ เครื่องที่ลิสต์ได้ต้องเป็นเครื่องใน division ของ item นี้เท่านั้น — ใบตรวจข้าม division
  //    ไม่มีอยู่จริง ลิสต์เครื่องของอีก division ให้เลือกคือชวนให้ล็อก baseline ที่ไม่มีข้อมูล
  const baselineMachines = useMemo(() => {
    const model = models.find((m) => String(m.id) === String(selectedModel));
    if (!model) return [];
    return (lookups.machines ?? []).filter((mc) => mc.division_id === model.division_id);
  }, [models, selectedModel, lookups.machines]);

  // ชื่อขอบเขตที่คนอ่านรู้เรื่อง — 0 = ชุดรวม ไม่ใช่รหัสเครื่องจริง
  const scopeName = useCallback((machineId) => {
    if (!machineId) return 'รวมทุกเครื่อง';
    const mc = (lookups.machines ?? []).find((m) => String(m.id) === String(machineId));
    return mc ? `${mc.code} — ${mc.name}` : `เครื่อง #${machineId}`;
  }, [lookups.machines]);

  // พรีวิวล้มเหลวต้องไม่ปิดกล่อง — ขอบเขตที่เพิ่งเลือกอาจยังไม่มีใบตรวจเลย ซึ่งเป็นเรื่องปกติ
  // คนต้องเลือกขอบเขตอื่นต่อได้ทันที ไม่ใช่โดนเด้งออกไปอ่าน error ที่หัวหน้า
  const loadBaselinePreview = useCallback(async (cp, machineId) => {
    setBaselineInfo({ checkpoint: cp, machineId, loading: true, preview: null, error: null });
    try {
      const q = machineId ? `?machine_id=${encodeURIComponent(machineId)}` : '';
      const preview = await apiCall(`/charts/${cp.id}/baseline/preview${q}`);
      setBaselineInfo((prev) => (prev && prev.checkpoint.id === cp.id && prev.machineId === machineId
        ? { ...prev, loading: false, preview } : prev));
    } catch (e) {
      setBaselineInfo((prev) => (prev && prev.checkpoint.id === cp.id && prev.machineId === machineId
        ? { ...prev, loading: false, error: e.message } : prev));
    }
  }, []);

  const previewBaseline = (cp) => loadBaselinePreview(cp, '');

  const confirmBaseline = async () => {
    const { checkpoint: cp, machineId } = baselineInfo;
    try {
      await apiCall(`/charts/${cp.id}/baseline`, {
        method: 'POST',
        body: machineId ? { machine_id: machineId } : {},
      });
      setBaselineInfo(null);
      say('success', `ล็อก control limit ของ "${scopeName(machineId)}" แล้ว`);
      await loadCheckpoints(selectedModel);
    } catch (e) { fail(e); }
  };

  // ⚠️ ปุ่มยืนยันเป็นสีเหลือง ไม่ใช่แดง — แดงสงวนไว้ให้แกนสเปก/ของที่กู้ไม่ได้
  //    ส่วน baseline คือ control limit (แกนเหลือง) และกดตั้งใหม่ได้เสมอ
  // ⚠️ ล้างทีละขอบเขต ไม่ใช่ล้างทั้งจุดตรวจ — ล้างของ MC-01 ต้องไม่ไปแตะชุดรวมหรือ MC-02
  const clearBaseline = (cp, machineId = 0) => showConfirm({
    title: `ล้าง baseline ของ "${cp.name}" (${scopeName(machineId)}) ?`,
    body: 'กราฟของขอบเขตนี้จะกลับไปคำนวณลิมิตสด (provisional) ขอบเขตอื่นไม่ถูกแตะ',
    variant: 'warning',
    confirmLabel: 'ล้าง baseline',
    onConfirm: async () => {
      try {
        const q = machineId ? `?machine_id=${encodeURIComponent(machineId)}` : '';
        await apiCall(`/charts/${cp.id}/baseline${q}`, { method: 'DELETE' });
        say('success', 'ล้าง baseline แล้ว');
        await loadCheckpoints(selectedModel);
      } catch (e) { fail(e); }
    },
  });

  // ── หมวดการตรวจของจุดนี้ (Set up / Last Piece × PD / QC) ─────────────────
  //
  // 1 ช่อง = จำนวนชิ้นของหมวด × ขั้น · เว้นว่าง = ขั้นนั้นไม่ตรวจจุดนี้ (PD กับ QC เช็คคนละจุดได้)
  // ⚠️ ไม่ผ่าน generic CRUD — PUT /master/checkpoints/:id/categories แทนทั้งชุดของจุดนี้ในทีเดียว
  // ⚠️ หมวด "ตรวจตามรอบ" ไม่อยู่ในกล่องนี้ — ใช้ n / ความถี่ ของจุดตรวจตามเดิม
  const workflowCategories = (lookups.categories ?? []).filter((c) => Number(c.has_workflow));
  const editCategories = (cp) => {
    const current = (c, stage) => cp.category_settings?.find((x) => x.category_id === c.id && x.stage === stage);
    const isAttr = cp.char_type === 'attribute';
    showForm({
      title: `หมวดการตรวจของ "${cp.name}"`,
      body: isAttr
        ? 'จุดตรวจด้วยตา: ใส่ 1 = ตรวจในขั้นนั้น · เว้นว่าง = ไม่ตรวจ'
        : `ใส่จำนวนชิ้นที่ต้องวัด (1-10) · เว้นว่าง = ขั้นนั้นไม่ตรวจจุดนี้ (ตรวจตามรอบใช้ n = ${cp.sample_size})`,
      confirmLabel: 'บันทึก',
      fields: workflowCategories.flatMap((c) => ['pd', 'qc'].map((stage) => ({
        name: `${c.id}_${stage}`,
        label: `${c.name} — ${stage === 'pd' ? 'Production Check (PD)' : 'QC Confirm (QC)'}`,
        type: 'number',
        defaultValue: current(c, stage) ? String(current(c, stage).sample_qty) : '',
      }))),
      onConfirm: async (data) => {
        const settings = Object.entries(data)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => {
            const [categoryId, stage] = k.split('_');
            return { category_id: Number(categoryId), stage, sample_qty: isAttr ? 1 : Number(v) };
          });
        try {
          await apiCall(`/master/checkpoints/${cp.id}/categories`, { method: 'PUT', body: { settings } });
          say('success', `ตั้งหมวดการตรวจของ "${cp.name}" แล้ว`);
          await loadCheckpoints(selectedModel);
        } catch (e) { fail(e); }
      },
    });
  };

  return (
    <Container fluid className="page">
      <div className="page-head">
        <h1>ตั้งค่า Master</h1>
      </div>
      {msg && <Alert variant={msg.variant} dismissible onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <Nav variant="tabs" activeKey={tab} onSelect={setTab} className="mb-3">
        <Nav.Item><Nav.Link eventKey="models">รุ่น &amp; จุดตรวจ</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="divisions">Division</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="machines">เครื่อง</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="inspectors">ผู้ตรวจ</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="customers">ลูกค้า</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="users">ผู้ใช้</Nav.Link></Nav.Item>
      </Nav>

      {tab === 'models' && (
        <ModelsTab
          fromMo={Boolean(prefill)}
          modelForm={modelForm} setModelForm={setModelForm}
          editingModel={editingModel} setEditingModel={setEditingModel}
          cpForm={cpForm} setCpForm={setCpForm}
          editingCp={editingCp} setEditingCp={setEditingCp}
          resetCp={resetCp} onRemember={rememberMeasurement} gaugeMemory={gaugeMemory}
          specMode={specMode} setSpecMode={setSpecMode} tolForm={tolForm} setTolForm={setTolForm}
          models={models} divisions={lookups.divisions} customers={lookups.customers ?? []}
          selectedModel={selectedModel} setSelectedModel={setSelectedModel}
          checkpoints={checkpoints}
          onSave={save} onRemove={remove} onMove={moveCheckpoint} onPurgeVoided={purgeVoided}
          onPreviewBaseline={previewBaseline} onClearBaseline={clearBaseline}
          onEditCategories={editCategories} categories={workflowCategories}
          scopeName={scopeName}
          onAlert={showAlert}
        />
      )}
      {tab === 'divisions' && (
        <SimpleTab
          title="Division" table="divisions" rows={lookups.divisions}
          columns={[
            { key: 'name', label: 'ชื่อ', required: true },
            // dept ของ IPBASS — ว่างไว้ได้ แต่การยิง MO หา item จะใช้ไม่ได้จนกว่าจะตั้ง
            { key: 'ipbass_dept', label: 'IPBASS dept (เช่น T47183)' },
          ]}
          onSave={save} onRemove={remove} onAlert={showAlert} labelOf={(r) => r.name}
        />
      )}
      {tab === 'machines' && (
        <SimpleTab
          title="เครื่อง" table="machines" rows={lookups.machines}
          columns={[
            { key: 'code', label: 'รหัส', required: true },
            { key: 'name', label: 'ชื่อ', required: true },
            { key: 'division_id', label: 'Division', type: 'select', options: lookups.divisions, required: true },
            { key: 'is_active', label: 'ใช้งาน', type: 'check' },
          ]}
          onSave={save} onRemove={remove} onAlert={showAlert} labelOf={(r) => `${r.code} — ${r.name}`}
        />
      )}
      {tab === 'inspectors' && (
        <SimpleTab
          title="ผู้ตรวจ" table="inspectors" rows={lookups.inspectors}
          columns={[
            { key: 'emp_code', label: 'รหัสพนักงาน', required: true },
            { key: 'name', label: 'ชื่อ', required: true },
            { key: 'division_id', label: 'Division', type: 'select', options: lookups.divisions },
            { key: 'is_active', label: 'ใช้งาน', type: 'check' },
          ]}
          onSave={save} onRemove={remove} onAlert={showAlert} labelOf={(r) => r.name}
        />
      )}
      {tab === 'customers' && (
        // เกณฑ์ตั้งต้นของลูกค้า — item ที่ผูกลูกค้านี้และเว้นช่องเกณฑ์ไว้จะใช้ค่าชุดนี้
        // จุด CTF (is_critical) ใช้อีกชุดเพราะลูกค้ามักกำหนดจุดวิกฤตสูงกว่า
        <SimpleTab
          title="ลูกค้า" table="customers" rows={lookups.customers ?? []}
          columns={[
            { key: 'name', label: 'ชื่อลูกค้า', required: true },
            { key: 'min_cp', label: 'min Cp', type: 'number', required: true, default: '1.33' },
            { key: 'min_cpk', label: 'min Cpk', type: 'number', required: true, default: '1.33' },
            { key: 'min_cp_ctf', label: 'min Cp (SC point)', type: 'number', required: true, default: '1.33' },
            { key: 'min_cpk_ctf', label: 'min Cpk (SC point)', type: 'number', required: true, default: '1.33' },
            // ชุดกฎ OCS ตามคู่มือ — Mechanical Div. ใช้ข้อ 1-4 · MAMM ใช้ครบ 8 (เลือกที่ backend/services/capabilityTarget.js)
            { key: 'ocs_rule_set', label: 'กฎ OCS', type: 'select', required: true, default: 'basic', options: OCS_RULE_SET_OPTIONS },
            { key: 'is_active', label: 'ใช้งาน', type: 'check' },
          ]}
          onSave={save} onRemove={remove} onAlert={showAlert} labelOf={(r) => r.name}
        />
      )}
      {tab === 'users' && (
        // บัญชี login หน้า Master — ไม่มีหน้าสมัครสาธารณะ คนที่ login อยู่เพิ่มให้คนอื่น (ดู UsersTab.js)
        <UsersTab say={say} fail={fail} showForm={showForm} showConfirm={showConfirm} onAlert={showAlert} />
      )}

      <BaselineModal
        info={baselineInfo}
        machines={baselineMachines}
        scopeName={scopeName}
        onScopeChange={(machineId) => loadBaselinePreview(baselineInfo.checkpoint, machineId)}
        onClose={() => setBaselineInfo(null)}
        onConfirm={confirmBaseline}
      />
      {/* ⚠️ กล่องที่ปิดอยู่ต้องไม่ทิ้ง node ไว้เลย — มีเทสยืนยันทั้งหน้าว่าสเปกด้านเดียว
          ต้องไม่มี role="alert" สักตัว (MasterSetup.test.js 'สเปกด้านเดียวต้องไม่มีคำเตือน') */}
      <AppDialog dialog={dialog} onHide={closeDialog} />
    </Container>
  );
};

// ── แท็บ master ธรรมดา (division / เครื่อง / ผู้ตรวจ) ───────────────────────
//
// ตารางเดียวใช้ได้ทั้งสามชั้น เพราะ backend เป็น generic CRUD อยู่แล้ว
// ⚠️ key ของ columns ต้องตรงชื่อคอลัมน์ใน DB เป๊ะ — ไม่อยู่ใน ALLOWED_COLUMNS จะถูกตอบ 400
const SimpleTab = ({ title, table, rows, columns, onSave, onRemove, onAlert, labelOf }) => {
  const blank = () => Object.fromEntries(columns.map((c) => [c.key, c.type === 'check' ? true : (c.default ?? '')]));
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);

  const reset = () => { setForm(blank()); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    for (const c of columns) {
      if (c.required && form[c.key] === '') {
        return onAlert({ title: 'กรอกข้อมูลไม่ครบ', body: `กรอก "${c.label}" ก่อน` });
      }
      if (c.type === 'number' && badMin(form[c.key])) {
        return onAlert({ title: 'ค่าไม่ถูกต้อง', body: `"${c.label}" ต้องเป็นตัวเลขมากกว่า 0 และน้อยกว่า 100` });
      }
    }
    const data = Object.fromEntries(columns.map((c) => [
      c.key,
      c.type === 'check' ? (form[c.key] ? 1 : 0)
        : c.type === 'select' ? (form[c.key] || null)
          : c.type === 'number' ? numOrNull(form[c.key])
            : form[c.key],
    ]));
    if (await onSave(table, data, editingId)) reset();
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    // ⚠️ ค่า null ต้องกลายเป็น '' ไม่งั้น <Form.Control> เปลี่ยนเป็น uncontrolled กลางคัน
    setForm(Object.fromEntries(columns.map((c) => [
      c.key, c.type === 'check' ? Boolean(Number(row[c.key])) : row[c.key] ?? '',
    ])));
  };

  return (
    <Card>
      <Card.Body>
        <Form onSubmit={submit}>
          <Row className="g-2 align-items-end mb-3">
            {columns.map((c) => (
              <Col md={c.type === 'check' ? 1 : c.type === 'number' ? 2 : 3} key={c.key}>
                <Form.Label className="small mb-1">{c.label}</Form.Label>
                {c.type === 'check' ? (
                  <Form.Check
                    checked={Boolean(form[c.key])}
                    onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.checked }))}
                  />
                ) : c.type === 'select' ? (
                  <SearchSelect
                    id={`simple-${table}-${c.key}`}
                    value={form[c.key] ?? ''}
                    onChange={(value) => setForm((f) => ({ ...f, [c.key]: value }))}
                    placeholder="--"
                    options={(c.options ?? []).map((o) => ({ value: String(o.id), label: o.name }))}
                  />
                ) : (
                  <Form.Control
                    type={c.type === 'number' ? 'number' : 'text'}
                    step={c.type === 'number' ? '0.01' : undefined}
                    min={c.type === 'number' ? '0.01' : undefined}
                    value={form[c.key] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                  />
                )}
              </Col>
            ))}
            <Col md="auto">
              <Button type="submit" variant={editingId ? 'warning' : 'primary'}>
                {editingId ? 'บันทึกการแก้ไข' : `เพิ่ม${title}`}
              </Button>
              {editingId && <Button variant="link" onClick={reset}>ยกเลิก</Button>}
            </Col>
          </Row>
        </Form>

        <Table striped bordered hover responsive size="sm" className="mb-0">
          <thead className="table-dark">
            <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}<th style={{ width: 130 }}>จัดการ</th></tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={columns.length + 1} className="text-center text-muted">ยังไม่มีข้อมูล</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className={Number(r.is_active) === 0 ? 'text-muted' : ''}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.type === 'check'
                        ? (Number(r[c.key]) ? 'ใช่' : '—')
                        : c.type === 'select'
                          ? (c.options ?? []).find((o) => String(o.id) === String(r[c.key]))?.name ?? '—'
                          : r[c.key] ?? '—'}
                    </td>
                  ))}
                  <td>
                    <Button size="sm" variant="primary" className="me-1" onClick={() => startEdit(r)}>แก้</Button>
                    <Button size="sm" variant="danger" onClick={() => onRemove(table, r.id, labelOf(r))}>ลบ</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
};

// ── แท็บ Item + จุดตรวจ ───────────────────────────────────────────────────
//
// "รุ่น" ของระบบนี้คือ item number ของ IPBASS — ตาราง/ตัวแปรยังชื่อ model/modelId ตามเดิม
// เปลี่ยนแค่คอลัมน์ item_no/item_name กับข้อความบนหน้าจอ
// ⚠️ ฟอร์มทั้งสองชุด (modelForm/editingModel และ cpForm/editingCp) ถูกยกไปไว้ที่
//    <MasterSetup> เพราะแท็บทำให้ component นี้ unmount — ดูคอมเมนต์ที่นั่น อย่าย้ายกลับลงมา
const ModelsTab = ({
  fromMo, modelForm, setModelForm, editingModel, setEditingModel,
  cpForm, setCpForm, editingCp, setEditingCp, resetCp, onRemember, gaugeMemory,
  specMode, setSpecMode, tolForm, setTolForm,
  models, divisions, customers, selectedModel, setSelectedModel, checkpoints,
  onSave, onRemove, onMove, onPurgeVoided, onPreviewBaseline, onClearBaseline,
  onEditCategories, categories = [],
  scopeName,
  onAlert,
}) => {
  const resetModel = () => { setModelForm(blankModel()); setEditingModel(null); };

  // ค้นหา item ในตารางข้างล่าง — เป็นสเตตชั่วคราวของการมอง ไม่ใช่ของที่กรอกค้างไว้
  // จึงปล่อยให้หายตอนสลับแท็บได้ ต่างจาก modelForm/cpForm ที่ถูกยกขึ้นไปไว้ที่ <MasterSetup>
  const [modelQuery, setModelQuery] = useState('');

  // ตัวเลือกใน <datalist> ทั้งสองช่องงอกเองจากของที่ใช้อยู่จริง ไม่ต้องมี endpoint ใหม่
  // ⚠️ ครึ่งที่มาจาก DB เห็นแค่ item ที่เลือกอยู่ (loadCheckpoints ดึงทีละ model)
  //    เครื่องที่เพิ่งเปิดใหม่จึงเห็นแค่ UNIT_OPTIONS และลิสต์เครื่องมือวัดว่าง — ตั้งใจ ไม่ใช่พัง
  const unitOptions = useMemo(
    () => mergeOptions(UNIT_OPTIONS, checkpoints.map((c) => c.unit)),
    [checkpoints]
  );
  const gaugeOptions = useMemo(
    () => mergeOptions(gaugeMemory, checkpoints.map((c) => c.gauge)),
    [gaugeMemory, checkpoints]
  );
  const charOptions = useMemo(
    () => mergeOptions([], checkpoints.map((c) => c.characteristic)),
    [checkpoints]
  );

  // ตรวจสดขณะพิมพ์ ไม่ใช่รอกดบันทึก — สเปกกลับหัวที่หลุดไปแล้วแก้ย้อนหลังไม่ได้
  // เพราะ judgment ถูก snapshot ลงใบตรวจไปแล้ว
  const issues = useMemo(() => specIssues(cpForm), [cpForm]);

  const editingCpRow = checkpoints.find((c) => c.id === editingCp) ?? null;

  const submitModel = async (e) => {
    e.preventDefault();
    if (!modelForm.division_id || !modelForm.item_no || !modelForm.item_name) {
      return onAlert({ title: 'กรอกข้อมูลไม่ครบ', body: 'กรอก Division / Item No. / ชื่อ item ให้ครบ' });
    }
    const bad = MIN_FIELDS.find((f) => badMin(modelForm[f.key]));
    if (bad) {
      return onAlert({
        title: 'เกณฑ์ไม่ถูกต้อง',
        body: `min ${bad.label} ต้องเป็นตัวเลขมากกว่า 0 และน้อยกว่า 100 — หรือเว้นว่างเพื่อใช้เกณฑ์ของลูกค้า`,
      });
    }
    // ⚠️ ช่องว่างต้องเป็น null — '' ลงคอลัมน์ INT/DECIMAL ไม่ได้ และ NULL คือ "ตามลูกค้า"
    const data = {
      ...modelForm,
      customer_id: modelForm.customer_id || null,
      ...Object.fromEntries(MIN_FIELDS.map((f) => [f.key, numOrNull(modelForm[f.key])])),
    };
    if (await onSave('models', data, editingModel)) resetModel();
  };

  // ช่องเกณฑ์ที่เว้นว่างบอกว่าจะได้ค่าอะไร — คนกรอกต้องเห็นว่าไม่ override แล้วได้เลขไหน
  const formCustomer = customers.find((c) => String(c.id) === String(modelForm.customer_id)) ?? null;
  const minPlaceholder = (key) => (formCustomer
    ? `ตามลูกค้า ${Number(formCustomer[key]).toFixed(2)}`
    : 'ค่าระบบ');

  const submitCp = async (e) => {
    e.preventDefault();
    if (!selectedModel) return onAlert({ title: 'ยังไม่ได้เลือก item', body: 'เลือก item ก่อน' });
    if (!cpForm.name) return onAlert({ title: 'กรอกข้อมูลไม่ครบ', body: 'กรอกชื่อจุดตรวจ' });
    // สเปกกลับหัวบันทึกไปแล้วทุกชิ้นที่วัดจะเป็น NG และ judgment ถูก snapshot ไปแล้ว
    if (issues.blocking) return onAlert({ title: 'สเปกไม่ถูกต้อง', body: issues.blocking });

    const isAttr = cpForm.char_type === 'attribute';
    const data = {
      model_id: selectedModel,
      name: cpForm.name,
      char_type: cpForm.char_type,
      // จุด attribute ไม่มีค่าตัวเลข หน่วยจึงไม่มีความหมาย ต้องล้างเหมือน usl/lsl/target
      unit: isAttr ? null : (cpForm.unit || null),
      gauge: cpForm.gauge || null,
      characteristic: cpForm.characteristic?.trim() || null,
      frequency: cpForm.frequency === 'day' ? 'day' : 'shift',
      // จุด attribute ไม่มีค่าตัวเลข ส่ง null ทั้งหมดและบังคับ n = 1
      usl: isAttr ? null : numOrNull(cpForm.usl),
      lsl: isAttr ? null : numOrNull(cpForm.lsl),
      target: isAttr ? null : numOrNull(cpForm.target),
      sample_size: isAttr ? 1 : Number(cpForm.sample_size) || 1,
      is_critical: cpForm.is_critical ? 1 : 0,
      is_active: cpForm.is_active ? 1 : 0,
    };
    // seq_no ต่อท้ายอัตโนมัติตอนเพิ่มใหม่ — ลำดับปรับด้วยปุ่มลูกศรทีหลัง
    if (!editingCp) data.seq_no = (checkpoints.reduce((m, c) => Math.max(m, c.seq_no), 0) || 0) + 1;

    if (await onSave('checkpoints', data, editingCp)) {
      // ⚠️ ต้องจำก่อน resetCp เพราะ resetCp เติมฟอร์มจากสิ่งที่จำไว้
      onRemember(data);
      resetCp();
    }
  };

  const startEditCp = (cp) => {
    setEditingCp(cp.id);
    // แก้ของเก่าต้องเห็นเลขที่เก็บอยู่จริงก่อนเสมอ — สลับไปโหมดพิกัดเองได้ทีหลัง
    setSpecMode('limits');
    setTolForm(EMPTY_TOL);
    // ⚠️ toNum คืน null ได้ ต้อง ?? '' ก่อนใส่ input
    setCpForm({
      name: cp.name ?? '', char_type: cp.char_type, unit: cp.unit ?? '', gauge: cp.gauge ?? '',
      characteristic: cp.characteristic ?? '',
      usl: cp.usl ?? '', lsl: cp.lsl ?? '', target: cp.target ?? '',
      sample_size: cp.sample_size ?? 1, frequency: cp.frequency === 'day' ? 'day' : 'shift',
      is_critical: cp.is_critical, is_active: cp.is_active,
    });
  };

  const cpField = (key) => ({
    value: cpForm[key] ?? '',
    onChange: (e) => setCpForm((f) => ({ ...f, [key]: e.target.value })),
  });

  // ⚠️ ช่องพิกัดเป็นแค่ "วิธีพิมพ์" — cpForm.lsl/target/usl ยังเป็นแหล่งความจริงเดียวเสมอ
  //     ทุกคีย์ที่เคาะแปลงแล้วเขียนกลับลง cpForm ทันที specIssues กับ submitCp จึงไม่ต้องรู้
  //     ด้วยซ้ำว่ามีโหมด และไม่มีทางที่ "สิ่งที่เห็นบน preview" กับ "สิ่งที่บันทึก" จะหลุดจากกัน
  const tolField = (key) => ({
    value: tolForm[key] ?? '',
    onChange: (e) => {
      const next = { ...tolForm, [key]: e.target.value };
      setTolForm(next);
      setCpForm((f) => ({ ...f, ...limitsFromTolerance(next) }));
    },
  });

  // เข้าโหมดพิกัดแล้วค่าที่กรอกไว้ต้องไม่หาย — แปลงขึ้นมาให้ (ไม่มีค่าพื้นให้คิดก็คืนว่างตามกฎ)
  // ออกจากโหมดพิกัดไม่ต้องทำอะไร ค่าอยู่ใน cpForm ครบแล้ว สลับไปกลับจึงไม่มีทางทำให้เลขขยับ
  const switchSpecMode = (mode) => {
    if (mode === 'tol') setTolForm(toleranceFromLimits(cpForm));
    setSpecMode(mode);
  };

  const isAttr = cpForm.char_type === 'attribute';
  const tolMode = specMode === 'tol' && !isAttr;

  // ⚠️ กรองเฉพาะ "ตารางที่แสดง" ไม่ได้กรอง models ที่ส่งเข้ามา — seq_no ของจุดตรวจและ
  //    การเลือก item ยังอ้าง models ตัวเต็มอยู่ กรองผิดที่แล้ว item ที่เลือกค้างไว้จะหายไปจากจอ
  const visibleModels = models.filter((m) => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return true;
    return `${m.item_no} ${m.item_name} ${m.division_name ?? ''}`.toLowerCase().includes(q);
  });

  // preview ใช้ <SpecValue> ตัวเดียวกับที่ operator เห็นบนใบตรวจจริง จะได้ไม่มีรูปที่สองให้เพี้ยน
  // ⚠️ numOrNull คืน NaN ได้ตอนพิมพ์ค้าง ซึ่ง SpecValue กรองด้วย isFinite อยู่แล้ว
  //     ห้ามส่ง cpForm เข้าไปตรง ๆ มันเป็นสตริง SpecValue เช็ค typeof === 'number'
  const specPreview = {
    char_type: 'variable',
    unit: cpForm.unit,
    usl: numOrNull(cpForm.usl),
    lsl: numOrNull(cpForm.lsl),
    target: numOrNull(cpForm.target),
  };

  return (
    <Row>
      {/* รุ่น */}
      <Col lg={4}>
        <Card className="mb-3">
          <Card.Header>รุ่น (Model)</Card.Header>
          <Card.Body>
            {fromMo && !editingModel && (
              <Alert variant="info" className="py-2 px-3 mb-2 small">
                ข้อมูลจาก MO เติมไว้ให้แล้ว — ตรวจดูแล้วกด <b>เพิ่ม Item</b> จากนั้นใส่จุดตรวจทางขวา
                (เพิ่ม item เฉย ๆ ยังกรอกใบตรวจไม่ได้ ต้องมีจุดตรวจด้วย)
              </Alert>
            )}
            <Form onSubmit={submitModel}>
              <div className="mb-2">
                <SearchSelect
                  id="model-division"
                  aria-label="Division ของ item"
                  value={modelForm.division_id}
                  onChange={(value) => setModelForm((f) => ({ ...f, division_id: value }))}
                  placeholder="-- Division --"
                  options={divisions.map((d) => ({ value: String(d.id), label: d.name }))}
                />
              </div>
              <Form.Control className="mb-2" placeholder="Item No. เช่น AAB-1001-01"
                value={modelForm.item_no} onChange={(e) => setModelForm((f) => ({ ...f, item_no: e.target.value }))} />
              <Form.Control className="mb-2" placeholder="ชื่อ item"
                value={modelForm.item_name} onChange={(e) => setModelForm((f) => ({ ...f, item_name: e.target.value }))} />
              <Row className="g-2 mb-2">
                <Col><Form.Control placeholder="เลขแบบ"
                  value={modelForm.drawing_no} onChange={(e) => setModelForm((f) => ({ ...f, drawing_no: e.target.value }))} /></Col>
                <Col xs={4}><Form.Control placeholder="Rev"
                  value={modelForm.drawing_rev} onChange={(e) => setModelForm((f) => ({ ...f, drawing_rev: e.target.value }))} /></Col>
              </Row>
              {/* ลูกค้ากำหนดเกณฑ์ Cp/Cpk ต่างกัน — เลือกลูกค้าแล้วช่องข้างล่างว่างไว้ได้ (ใช้ของลูกค้า)
                  ⚠️ ต้องมีแถว "ไม่ระบุ" จริงในลิสต์ ไม่งั้นเลือกลูกค้าไปแล้วถอยกลับไม่ได้ */}
              <div className="mb-2">
                <SearchSelect
                  id="model-customer"
                  aria-label="ลูกค้าของ item"
                  value={modelForm.customer_id === null ? '' : String(modelForm.customer_id ?? '')}
                  onChange={(value) => setModelForm((f) => ({ ...f, customer_id: value }))}
                  placeholder="-- ลูกค้า --"
                  options={[
                    { value: '', label: 'ไม่ระบุลูกค้า' },
                    ...customers.map((c) => ({
                      value: String(c.id),
                      label: c.name,
                      hint: Number(c.is_active) === 0 ? 'ปิดใช้งาน' : '',
                    })),
                  ]}
                />
                {/* ชุดกฎ OCS มากับลูกค้า ไม่มี override ราย item — บอกไว้ตรงนี้ คนเลือกลูกค้าจะได้รู้ว่ากราฟจะใช้กี่กฎ */}
                <div className="small text-muted mt-1">
                  {formCustomer?.ocs_rule_set === 'full' ? 'กฎ OCS ครบ 8 ข้อ (ตามลูกค้า)' : 'กฎ OCS ข้อ 1–4'}
                </div>
              </div>
              <div className="small text-muted mb-1">เกณฑ์ขั้นต่ำ (เว้นว่าง = ตามลูกค้า)</div>
              <Row className="g-2 mb-2">
                {MIN_FIELDS.map((f) => (
                  <Form.Group as={Col} xs={6} key={f.key} controlId={`model-${f.key}`}>
                    <Form.Label className="small mb-0">min {f.label}</Form.Label>
                    <Form.Control
                      type="number" step="0.01" min="0.01" size="sm"
                      placeholder={minPlaceholder(f.key)}
                      value={modelForm[f.key] ?? ''}
                      onChange={(e) => setModelForm((m) => ({ ...m, [f.key]: e.target.value }))}
                    />
                  </Form.Group>
                ))}
              </Row>
              <Button type="submit" className="w-100" variant={editingModel ? 'warning' : 'primary'}>
                {editingModel ? 'บันทึกการแก้ไข' : 'เพิ่ม Item'}
              </Button>
              {editingModel && <Button variant="link" className="w-100" onClick={resetModel}>ยกเลิก</Button>}
            </Form>

            <hr />
            {/* ลิสต์ item ยาวเป็นร้อยแถว เลื่อนหาช้ากว่าพิมพ์ — ค้นได้ทั้งเลข item ชื่อ และ division */}
            <Form.Control
              className="mb-2"
              placeholder="ค้นหา item — เลข / ชื่อ / division"
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
            />
            {visibleModels.length === 0 && (
              <div className="small text-muted mb-2">ไม่พบ item ที่ค้นหา</div>
            )}
            <Table size="sm" hover className="mb-0">
              <tbody>
                {visibleModels.map((m) => (
                  <tr key={m.id} className={selectedModel === String(m.id) ? 'table-primary' : ''}>
                    <td role="button" onClick={() => setSelectedModel(String(m.id))}>
                      <div className="fw-bold">{m.item_no}</div>
                      <div className="small text-muted">
                        {m.item_name} · {m.division_name}
                        {m.customer_name && ` · ${m.customer_name}`} · {toNum(m.checkpoint_count) || 0} จุด
                        {!m.is_active && <Badge bg="secondary" className="ms-1">ปิดใช้งาน</Badge>}
                      </div>
                      {/* ใบที่ยกเลิกแล้วยังกิน FK อยู่ ทำให้ลบ item ไม่ได้ — ปุ่มนี้คือทางออก */}
                      {toNum(m.voided_count) > 0 && (
                        <Button size="sm" variant="link" className="p-0 small"
                          onClick={(e) => { e.stopPropagation(); onPurgeVoided(m); }}>
                          ล้างใบที่ยกเลิกแล้ว ({toNum(m.voided_count)})
                        </Button>
                      )}
                    </td>
                    <td style={{ width: 96 }} className="text-end align-middle">
                      <Button size="sm" variant="outline-primary" className="me-1"
                        onClick={() => { setEditingModel(m.id); setModelForm({
                          division_id: m.division_id ?? '', item_no: m.item_no ?? '',
                          item_name: m.item_name ?? '', drawing_no: m.drawing_no ?? '', drawing_rev: m.drawing_rev ?? '',
                          customer_id: m.customer_id ?? '',
                          ...Object.fromEntries(MIN_FIELDS.map((f) => [f.key, m[f.key] ?? ''])),
                        }); }}>แก้</Button>
                      <Button size="sm" variant="outline-danger"
                        onClick={() => onRemove('models', m.id, m.item_no)}>ลบ</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      </Col>

      {/* จุดตรวจ */}
      <Col lg={8}>
        <Card style={{ opacity: selectedModel ? 1 : 0.6 }}>
          {/* ตอนแก้ ฟอร์มอยู่บนสุดแต่แถวอยู่ในตารางข้างล่าง ถ้าหัวการ์ดไม่บอกว่ากำลังแก้จุดไหน
              สัญญาณเดียวที่มีคือปุ่มเปลี่ยนเป็นสีเหลือง ซึ่งมองข้ามง่ายมาก */}
          <Card.Header>
            {editingCpRow
              ? <>กำลังแก้จุดที่ <b>{editingCpRow.seq_no}</b> — {editingCpRow.name}</>
              : <>จุดตรวจ {selectedModel && `— ${models.find((m) => String(m.id) === selectedModel)?.item_no ?? ''}`}</>}
          </Card.Header>
          <Card.Body>
            <Form onSubmit={submitCp}>
              <Row className="g-2 mb-2 align-items-end">
                <Form.Group as={Col} md={3} controlId="cp-name">
                  <Form.Label className="small mb-1">ชื่อจุดตรวจ</Form.Label>
                  <Form.Control placeholder="เช่น Dimension 3.1" {...cpField('name')} disabled={!selectedModel} />
                </Form.Group>
                {/* Characteristic = แถว 11 ของชีต Input (Slot / OD / Rz) แยกจากชื่อจุด
                    free text + <datalist> ตามหลักเดียวกับหน่วย/เครื่องมือวัด */}
                <Form.Group as={Col} md={2} controlId="cp-characteristic">
                  <Form.Label className="small mb-1">Characteristic</Form.Label>
                  <Form.Control list="cp-char-options" placeholder="เช่น OD"
                    {...cpField('characteristic')} disabled={!selectedModel} />
                </Form.Group>
                <Form.Group as={Col} md={2} controlId="cp-char-type">
                  <Form.Label className="small mb-1">ชนิด</Form.Label>
                  <Form.Select {...cpField('char_type')} disabled={!selectedModel}>
                    {CHAR_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Form.Select>
                </Form.Group>
                {/* ⚠️ หน่วยกับเครื่องมือวัดเป็น <input list> โดยตั้งใจ ไม่ใช่ <Form.Select>
                    ทั้งสองคอลัมน์เป็น free text มาแต่ไหนแต่ไร บังคับเลือกเมื่อไหร่ ค่าเก่าที่
                    ไม่ตรงลิสต์จะแสดงเป็นช่องว่างแล้วถูกเขียนทับตอนกดบันทึกแก้อย่างอื่น */}
                <Form.Group as={Col} md={2} controlId="cp-unit">
                  <Form.Label className="small mb-1">หน่วย</Form.Label>
                  <Form.Control list="cp-unit-options" placeholder="mm"
                    {...cpField('unit')} disabled={!selectedModel || isAttr} />
                </Form.Group>
                <Form.Group as={Col} md={3} controlId="cp-gauge">
                  <Form.Label className="small mb-1">เครื่องมือวัด</Form.Label>
                  <Form.Control list="cp-gauge-options" placeholder="เช่น Micrometer"
                    {...cpField('gauge')} disabled={!selectedModel} />
                </Form.Group>
              </Row>

              <datalist id="cp-unit-options">
                {unitOptions.map((u) => <option key={u} value={u} />)}
              </datalist>
              <datalist id="cp-gauge-options">
                {gaugeOptions.map((g) => <option key={g} value={g} />)}
              </datalist>
              <datalist id="cp-char-options">
                {charOptions.map((c) => <option key={c} value={c} />)}
              </datalist>

              {/* แบบส่วนใหญ่เขียนเป็นค่ากลาง + พิกัด (1.23 +0.5 -0.6) ไม่ใช่เลขสัมบูรณ์
                  ให้บวกลบในหัวก่อนพิมพ์คือเปิดช่องให้บวกผิด ซึ่ง judgment ถูก snapshot
                  ลงใบตรวจไปแล้วตอนตรวจ แก้ย้อนหลังไม่ได้ */}
              {!isAttr && (
                <div className="d-flex flex-wrap gap-3 mb-2" role="radiogroup" aria-label="รูปแบบการกรอกสเปก">
                  {SPEC_MODES.map((m) => (
                    <Form.Check
                      key={m.value}
                      type="radio"
                      id={`cp-spec-mode-${m.value}`}
                      name="cp-spec-mode"
                      className="small"
                      label={m.label}
                      checked={specMode === m.value}
                      disabled={!selectedModel}
                      onChange={() => switchSpecMode(m.value)}
                    />
                  ))}
                </div>
              )}

              <Row className="g-2 mb-2 align-items-end">
                {tolMode ? (
                  <>
                    <Form.Group as={Col} md={2} controlId="cp-nominal">
                      <Form.Label className="small mb-1">ค่ากลาง</Form.Label>
                      <Form.Control type="number" step="0.0001" placeholder="1.23"
                        {...tolField('nominal')} disabled={!selectedModel} />
                    </Form.Group>
                    {/* ⚠️ สองช่องนี้ต้องเป็น type="text" ห้ามเป็น type="number" —
                        input type=number ถือว่า "+0.5" เป็นค่าไม่ถูกต้องตามสเปก HTML
                        (อนุญาตแค่เครื่องหมายลบ) แล้วคืนค่าว่างเงียบ ๆ พิกัดบวกทั้งคู่
                        (งานรู เช่น 10 +0.015 +0.005) จะกรอกไม่ได้เลย
                        เหตุผลเดียวกับช่องกรอกค่าวัดใน InspectionSheet.js */}
                    <Form.Group as={Col} md={2} controlId="cp-tol-upper">
                      <Form.Label className="small mb-1">พิกัดบน</Form.Label>
                      <Form.Control type="text" inputMode="decimal" placeholder="+0.5"
                        {...tolField('tolUpper')} disabled={!selectedModel} />
                    </Form.Group>
                    <Form.Group as={Col} md={2} controlId="cp-tol-lower">
                      <Form.Label className="small mb-1">พิกัดล่าง</Form.Label>
                      <Form.Control type="text" inputMode="decimal" placeholder="-0.6"
                        {...tolField('tolLower')} disabled={!selectedModel} />
                    </Form.Group>
                  </>
                ) : (
                  <>
                    <Form.Group as={Col} md={2} controlId="cp-lsl">
                      <Form.Label className="small mb-1">LSL</Form.Label>
                      <Form.Control type="number" step="0.0001" {...cpField('lsl')} disabled={!selectedModel || isAttr} />
                    </Form.Group>
                    <Form.Group as={Col} md={2} controlId="cp-target">
                      <Form.Label className="small mb-1">Target</Form.Label>
                      <Form.Control type="number" step="0.0001" {...cpField('target')} disabled={!selectedModel || isAttr} />
                    </Form.Group>
                    <Form.Group as={Col} md={2} controlId="cp-usl">
                      <Form.Label className="small mb-1">USL</Form.Label>
                      <Form.Control type="number" step="0.0001" {...cpField('usl')} disabled={!selectedModel || isAttr} />
                    </Form.Group>
                  </>
                )}
                <Form.Group as={Col} md={2} controlId="cp-sample-size">
                  {/* n = 1 → กราฟ I-MR · n >= 2 → กราฟ X-bar R (ตาราง A2/D3/D4 มีถึง 10) */}
                  <Form.Label className="small mb-1">ชิ้น/ครั้ง</Form.Label>
                  <Form.Control type="number" min="1" max="10"
                    {...cpField('sample_size')} disabled={!selectedModel || isAttr} />
                </Form.Group>
                <Form.Group as={Col} md={2} controlId="cp-frequency">
                  <Form.Label className="small mb-1">ความถี่</Form.Label>
                  <Form.Select {...cpField('frequency')} disabled={!selectedModel}>
                    {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </Form.Select>
                </Form.Group>
                <Col md="auto" className="d-flex align-items-center gap-3">
                  <Form.Check label="SC point" checked={cpForm.is_critical} disabled={!selectedModel}
                    onChange={(e) => setCpForm((f) => ({ ...f, is_critical: e.target.checked }))} />
                  <Form.Check label="ใช้งาน" checked={cpForm.is_active} disabled={!selectedModel}
                    onChange={(e) => setCpForm((f) => ({ ...f, is_active: e.target.checked }))} />
                </Col>
                <Col md="auto">
                  <Button type="submit" variant={editingCp ? 'warning' : 'primary'} disabled={!selectedModel}>
                    {editingCp ? 'บันทึก' : 'เพิ่มจุดตรวจ'}
                  </Button>
                  {editingCp && <Button variant="link" onClick={resetCp}>ยกเลิก</Button>}
                </Col>
              </Row>

              {/* ⚠️ ห้ามเป็น <Alert> — ของ react-bootstrap มี role="alert" ติดมา แล้วจะกลายเป็น
                  "คำเตือน" ทั้งที่เป็นแค่ผลลัพธ์ที่คำนวณได้ (มีเทสล็อกไว้ว่าสเปกด้านเดียว
                  ต้องไม่มี alert สักตัว) */}
              {tolMode && (
                <div className="small text-muted mb-2 d-flex align-items-center gap-2">
                  <span>จะบันทึกเป็น</span>
                  <SpecValue checkpoint={specPreview} />
                </div>
              )}

              {!isAttr && (
                <div className="small text-muted mb-2">
                  ชิ้น/ครั้ง 1 = กราฟ I-MR · ตั้งแต่ 2 = กราฟ X̄-R · เว้น LSL หรือ USL ว่างได้ถ้าแบบคุมด้านเดียว
                  {tolMode && ' · ไม่ใส่เครื่องหมาย = พิกัดบนขึ้น พิกัดล่างลง · ใส่ + หรือ - เองได้ถ้าแบบเขียนไว้แบบนั้น (เช่น 10 -0.005 -0.015)'}
                </div>
              )}
              {issues.blocking && (
                <Alert variant="danger" className="py-2 px-3 mb-2 small">{issues.blocking}</Alert>
              )}
              {issues.warnings.map((w) => (
                <Alert key={w} variant="warning" className="py-2 px-3 mb-2 small">{w}</Alert>
              ))}
            </Form>

            <Table striped bordered hover responsive size="sm" className="mb-0">
              <thead className="table-dark">
                <tr>
                  <th style={{ width: 70 }}>ลำดับ</th><th>จุดตรวจ</th><th>ชนิด</th>
                  <th>LSL ~ USL</th><th>n / ความถี่</th><th>Control limit</th>
                  <th>Set up / Last Piece</th><th style={{ width: 260 }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.length === 0
                  ? <tr><td colSpan="8" className="text-center text-muted">ยังไม่มีจุดตรวจ</td></tr>
                  : checkpoints.map((cp, i) => (
                    <tr
                      key={cp.id}
                      className={[
                        editingCp === cp.id ? 'table-warning' : '',
                        !cp.is_active ? 'text-muted' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <td>
                        {cp.seq_no}
                        <Button size="sm" variant="link" className="p-0 ms-1" disabled={i === 0}
                          aria-label={`ย้าย ${cp.name} ขึ้น`} title="ย้ายขึ้น"
                          onClick={() => onMove(cp.id, 'up')}><Caret dir="up" /></Button>
                        <Button size="sm" variant="link" className="p-0" disabled={i === checkpoints.length - 1}
                          aria-label={`ย้าย ${cp.name} ลง`} title="ย้ายลง"
                          onClick={() => onMove(cp.id, 'down')}><Caret dir="down" /></Button>
                      </td>
                      <td>
                        {cp.name}
                        {cp.is_critical && (
                          <span className="badge bg-light text-dark ms-1" title="จุดวิกฤต — SC point">SC point</span>
                        )}
                        {cp.characteristic && <div className="small text-muted">{cp.characteristic}</div>}
                      </td>
                      <td className="small">{cp.char_type === 'attribute' ? 'ตรวจด้วยตา' : 'วัดค่า'}</td>
                      <td className="small">
                        {cp.char_type === 'attribute' ? '—' : `${cp.lsl ?? '-'} ~ ${cp.usl ?? '-'}`}
                      </td>
                      <td className="num text-nowrap">
                        {cp.char_type === 'attribute' ? 1 : cp.sample_size} / {freqShort(cp.frequency)}
                      </td>
                      <td className="small">
                        {cp.char_type === 'attribute' ? '—'
                          /* ⚠️ ของเดิมสลับกันอยู่: ล็อกแล้ว = เขียวเด่น · provisional = เทาจาง
                             ทั้งที่ provisional คือสถานะที่ต้องไปทำอะไรสักอย่าง (เส้นลิมิตยังขยับ
                             ตามข้อมูล จับความผิดปกติไม่ได้) ส่วนล็อกแล้วคือปกติ
                             ตามหลักของทั้งระบบ: เงียบเมื่อปกติ มีสีเมื่อต้องดู
                             ⚠️ ตอนนี้มีได้หลายชุด (รวมทุกเครื่อง + รายเครื่อง) ต้องลิสต์ให้ครบ
                                โชว์แค่ "ล็อกแล้ว" เฉย ๆ = ไม่รู้ว่าเครื่องไหนยังไม่ได้ล็อก */
                          : cp.baselines?.length > 0
                            ? (
                              <ul className="baseline-scopes num">
                                {cp.baselines.map((b) => (
                                  <li key={b.machineId}>
                                    {scopeName(b.machineId)} — n={b.n}, {b.subgroups} subgroup
                                    <Button
                                      size="sm" variant="link" className="p-0 ms-1"
                                      onClick={() => onClearBaseline(cp, b.machineId)}
                                    >ล้าง</Button>
                                  </li>
                                ))}
                              </ul>
                            )
                            : <Badge bg="warning">provisional</Badge>}
                      </td>
                      <td className="small text-nowrap">
                        {/* PD 5 · QC 5 ต่อหมวด — ว่าง = ไม่ตรวจในหมวดนั้น */}
                        {categories.map((c) => {
                          const pd = cp.category_settings?.find((x) => x.category_id === c.id && x.stage === 'pd');
                          const qc = cp.category_settings?.find((x) => x.category_id === c.id && x.stage === 'qc');
                          if (!pd && !qc) return null;
                          return (
                            <div key={c.id}>
                              {c.name}: {pd ? `PD ${pd.sample_qty}` : 'PD —'} · {qc ? `QC ${qc.sample_qty}` : 'QC —'}
                            </div>
                          );
                        })}
                        {!cp.category_settings?.length && <span className="text-muted">—</span>}
                      </td>
                      <td>
                        <Button size="sm" variant="primary" className="me-1" onClick={() => startEditCp(cp)}>แก้</Button>
                        {categories.length > 0 && (
                          <Button size="sm" variant="outline-primary" className="me-1"
                            onClick={() => onEditCategories(cp)}>หมวด</Button>
                        )}
                        {/* ⚠️ ปุ่มเดียวเสมอ ไม่สลับเป็น "ล้าง" อีกแล้ว — จุดหนึ่งมี baseline ได้
                            หลายชุด กล่องที่เปิดขึ้นมาเป็นที่เลือกเองว่าจะล็อกของขอบเขตไหน
                            (ปุ่มล้างของแต่ละชุดอยู่ในช่อง Control limit) */}
                        {cp.char_type !== 'attribute' && (
                          <Button size="sm" variant="outline-primary" className="me-1"
                            onClick={() => onPreviewBaseline(cp)}>Baseline</Button>
                        )}
                        <Button size="sm" variant="danger" onClick={() => onRemove('checkpoints', cp.id, cp.name)}>ลบ</Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
};

// ── ยืนยันก่อน freeze control limit ────────────────────────────────────────
//
// ⚠️ ขอบเขตเลือกในกล่องนี้ แล้วตัวเลขพรีวิวโหลดใหม่ตามทุกครั้ง — ตัวเลขที่เห็นต้องเป็นของ
//    ขอบเขตที่กำลังจะล็อกเสมอ ไม่งั้นคนอ่านเลขของชุดรวมแล้วกดล็อกให้เครื่องเดียว
//
// ⚠️ ชุด "รวมทุกเครื่อง" คิดจากใบตรวจของทุกเครื่องปนกัน ซึ่งแต่ละเครื่องคือคนละ process
//    ต้องเขียนบอกไว้ตรง ๆ ไม่ใช่ให้ไปรู้ทีหลังจากกราฟที่ไม่เคยเตือนอะไรเลย
const BaselineModal = ({ info, machines = [], scopeName, onScopeChange, onClose, onConfirm }) => {
  const p = info?.preview;

  return (
    <Modal show={Boolean(info)} onHide={onClose}>
      <Modal.Header closeButton><Modal.Title>ล็อก Control Limit</Modal.Title></Modal.Header>
      {info && (
        <Modal.Body>
          <p className="mb-2">จุดตรวจ: <strong>{info.checkpoint.name}</strong></p>

          <Form.Group className="mb-3">
            <Form.Label className="small mb-1" htmlFor="baseline-scope">ล็อกให้ขอบเขตไหน</Form.Label>
            <Form.Select
              id="baseline-scope"
              size="sm"
              value={info.machineId}
              onChange={(e) => onScopeChange(e.target.value)}
            >
              <option value="">รวมทุกเครื่อง</option>
              {machines.map((mc) => (
                <option key={mc.id} value={String(mc.id)}>{mc.code} — {mc.name}</option>
              ))}
            </Form.Select>
            {/* ⚠️ ห้ามเป็น <Alert> — role="alert" ติดมาด้วย และมีเทสยืนยันว่าหน้านี้ต้องไม่มี
                alert เกินที่ตั้งใจ · ใช้ <Form.Text> ตามกฎของ AppDialog */}
            <Form.Text muted>
              {info.machineId
                ? 'คิดจากใบตรวจของเครื่องนี้เท่านั้น — เป็นลิมิตของเครื่องนี้จริง ๆ'
                : 'คิดจากใบตรวจของทุกเครื่องปนกัน — ใช้เป็นเส้นอ้างอิงของกระบวนการรวม ไม่ใช่ลิมิตของเครื่องใดเครื่องหนึ่ง'}
            </Form.Text>
          </Form.Group>

          {info.loading && <div className="text-muted small">กำลังคำนวณ…</div>}

          {info.error && (
            <div className="small" style={{ color: 'var(--amber-text)' }}>
              {info.error} — เลือกขอบเขตอื่น หรือเก็บข้อมูลของ {scopeName(info.machineId)} ก่อน
            </div>
          )}

          {p && !info.loading && (
            <>
              <Table size="sm" bordered>
                <tbody>
                  <tr><td>ขอบเขต</td><td>{scopeName(info.machineId)}</td></tr>
                  <tr><td>ขนาด subgroup (n)</td><td>{p.n}</td></tr>
                  <tr><td>จำนวน subgroup</td><td>{p.subgroupCount}</td></tr>
                  <tr><td>X̿ (ค่ากลาง)</td><td>{p.xbarbar?.toFixed(4)}</td></tr>
                  <tr><td>R̄</td><td>{p.rbar?.toFixed(4)}</td></tr>
                  <tr>
                    <td>UCL / LCL ที่จะได้</td>
                    <td>{p.limits?.ucl?.toFixed(4)} / {p.limits?.lcl?.toFixed(4)}</td>
                  </tr>
                </tbody>
              </Table>
              {!p.enoughSubgroups && (
                <Alert variant="warning" className="mb-0 small">
                  มีแค่ {p.subgroupCount} subgroup — มาตรฐานแนะนำอย่างน้อย {p.minSubgroups} subgroup
                  ที่กระบวนการนิ่งแล้ว ล็อกตอนนี้ได้แต่ลิมิตจะยังไม่น่าเชื่อถือ กด Re-baseline ใหม่ได้ทีหลัง
                </Alert>
              )}
            </>
          )}
        </Modal.Body>
      )}
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        {/* ยังไม่มีตัวเลขให้ดู = ยังไม่มีอะไรให้ยืนยัน */}
        <Button variant="primary" onClick={onConfirm} disabled={!p || info?.loading}>
          ยืนยันล็อก
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default MasterSetup;
