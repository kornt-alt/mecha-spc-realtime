// frontend/src/components/MasterSetup.js — ตั้งค่า master ทั้งหมด
//
// ของเดิมมีปุ่มแก้/ลบให้เฉพาะ spec ส่วน division/machine/part เพิ่มได้อย่างเดียว
// (จะแก้ต้องเข้าไปทำที่ DB ตรง ๆ) รอบนี้ทำให้ครบทุกชั้น + จัดลำดับจุดตรวจ + baseline
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Row, Col, Card, Form, Button, Table, Badge, Alert, Nav, Modal, Dropdown, Spinner } from 'react-bootstrap';
import { apiCall, apiDownload } from '../utils/api';
import { PREFILL_KEYS } from '../utils/useModelParam';
import { on } from '../utils/socket';
import { normalizeRows, normalizeCheckpoints, numOrNull, toNum } from '../utils/normalize';
import {
  UNIT_OPTIONS, mergeOptions, specIssues, readCpMemory, rememberCp,
  limitsFromTolerance, toleranceFromLimits, pointsForCategory, ROUTINE_CATEGORY_ID,
} from '../utils/checkpointForm';
import SpecValue from './SpecValue';
import AppDialog from './AppDialog';
import UsersTab from './UsersTab';
import CategoryMatrix from './master/CategoryMatrix';
import CategoriesTab from './master/CategoriesTab';
import PermissionsTab from './master/PermissionsTab';
import CheckpointBulkModal, { importCheckpointFile } from './master/CheckpointBulkModal';
import CopyFromItemModal from './master/CopyFromItemModal';
import DrawingSyncModal from './master/DrawingSyncModal';
import useMenuAccess, { MENU } from '../utils/useMenuAccess';
import { useUrlParam } from '../utils/useModelParam';
import SearchSelect from './SearchSelect';
import { useDataTable, FilterBar } from './table/useDataTable';
import Pager, { usePager } from './table/Pager';
import { useDialog } from '../utils/useDialog';

// แท็บของหน้า Master ↔ สิทธิ์เมนู (backend/services/menuAccess.js) — ข้อมูลพื้นฐาน 4 ตารางรวมเป็นแท็บเดียว มีแท็บย่อย
const MASTER_TABS = [
  { key: 'models', label: 'Item & จุดตรวจ', menu: MENU.masterItems },
  { key: 'categories', label: 'หมวดการตรวจ', menu: MENU.masterCategories },
  { key: 'base', label: 'ข้อมูลพื้นฐาน', menu: MENU.masterBase },
  { key: 'users', label: 'ผู้ใช้ & สิทธิ์', menu: MENU.masterUsers },
];
const BASE_TABS = [
  { key: 'divisions', label: 'Division' },
  { key: 'machines', label: 'เครื่อง' },
  { key: 'inspectors', label: 'ผู้ตรวจ' },
  { key: 'customers', label: 'ลูกค้า' },
];

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
  // ส่วน "หมวดการตรวจ" ของฟอร์ม — in_routine = อยู่ในใบตรวจตามรอบ · settings = { '<catId>:<stage>': 'จำนวนชิ้น' }
  in_routine: true,
  settings: {},
});

// ขั้นที่หมวดใช้ตาม flow — ชุดเดียวกับ CategoryMatrix.js / utils/checkpointBulk.js
const FLOW_STAGES = { pd_qc: ['pd', 'qc'], pd: ['pd'], qc: ['qc'] };
const STAGE_LABEL = { pd: 'PD', qc: 'QC' };
const isFileDrag = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

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
  // กล่อง pop-up ของสองฟอร์ม — ยกขึ้นมาด้วยเหตุผลเดียวกัน (สลับแท็บแล้วกลับมา กล่องยังเปิด ของที่พิมพ์ยังอยู่)
  // ⚠️ prefill จาก MO (?item_no=…) = เปิดกล่องเพิ่ม item ให้เลยตั้งแต่ mount
  const [modelModal, setModelModal] = useState(() => Boolean(prefill));
  const [cpModal, setCpModal] = useState(false);
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

  // แท็บตามสิทธิ์เมนู — ไม่มีสิทธิ์แท็บไหนก็ไม่ขึ้น (server กั้นเส้นเขียนของแต่ละแท็บอีกชั้น)
  const access = useMenuAccess();
  const visibleTabs = MASTER_TABS.filter((t) => !access.loaded || access.can(t.menu));
  const [tabParam, setTabParam] = useUrlParam('tab');
  const tab = visibleTabs.some((t) => t.key === tabParam) ? tabParam : (visibleTabs[0]?.key ?? 'models');
  const setTab = (k) => setTabParam(k === MASTER_TABS[0].key ? '' : k);
  const [baseTabParam, setBaseTabParam] = useUrlParam('sub');
  const baseTab = BASE_TABS.some((t) => t.key === baseTabParam) ? baseTabParam : BASE_TABS[0].key;
  const setBaseTab = (k) => setBaseTabParam(k === BASE_TABS[0].key ? '' : k);
  const [lookups, setLookups] = useState({ divisions: [], machines: [], inspectors: [] });
  const [models, setModels] = useState([]);
  // ?model= = item ที่หน้าใบตรวจอยากให้เปิดค้างไว้ (ชื่อ param เดียวกับ Dashboard/ReportPage)
  const [selectedModel, setSelectedModel] = useState(() => params.get('model') ?? '');
  const [checkpoints, setCheckpoints] = useState([]);
  const [msg, setMsg] = useState(null);
  const [baselineInfo, setBaselineInfo] = useState(null);
  // กล่อง "ดึงจาก Drawing Digital" (components/master/DrawingSyncModal.js)
  const [syncShow, setSyncShow] = useState(false);

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
  useEffect(() => { resetCp(); setCpModal(false); }, [selectedModel, resetCp]);

  // ── CRUD กลาง ─────────────────────────────────────────────────────────
  // { inline: true } = เรียกจากกล่อง pop-up → คืน { ok, id, error } ให้กล่องโชว์ error เอง
  //   (แถบข้อความหัวหน้าอยู่หลัง backdrop มองไม่เห็น) · ไม่ส่ง = คืน true/false แบบเดิม (SimpleTab)
  const save = async (table, data, id, { inline = false } = {}) => {
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
      return inline ? { ok: true, id: res.id } : true;
    } catch (e) {
      if (inline) return { ok: false, error: e.message };
      fail(e); return false;
    }
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

  // ลากเรียงทั้งชุด — ล้ม = โหลดลำดับจริงกลับมา (จอเรียงไปก่อนแล้ว)
  const reorderCheckpoints = async (ids) => {
    try {
      await apiCall(`/master/models/${selectedModel}/checkpoints/order`, { method: 'PUT', body: { ids } });
    } catch (e) { fail(e); }
    await loadCheckpoints(selectedModel);
  };

  // เพิ่มหลายจุด (วาง Excel / นำเข้าไฟล์ / คัดลอกจาก item อื่น) บันทึกสำเร็จ
  const bulkSaved = async (res) => {
    const parts = [
      res.added ? `เพิ่ม ${res.added} จุด` : null,
      res.updated ? `อัปเดต ${res.updated} จุด` : null,
      res.deactivated ? `ปิดใช้งานจุดเดิม ${res.deactivated} จุด` : null,
    ].filter(Boolean);
    const stale = res.baselineMayBeStale ?? [];
    say(stale.length ? 'warning' : 'success', `บันทึกจุดตรวจแล้ว: ${parts.join(' · ') || 'ไม่มีอะไรเปลี่ยน'}${stale.length
      ? ` — เปลี่ยนชิ้น/ครั้งของ ${stale.map((s) => s.name).join(', ')} baseline เดิมอาจใช้ไม่ได้ ตรวจที่ปุ่ม Baseline` : ''}`);
    await loadAll();
    await loadCheckpoints(selectedModel);
  };

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

  // หมวดการตรวจทั้งหมด (รวมตรวจตามรอบ) — คอลัมน์ของตารางจุดตรวจ × หมวด (components/master/CategoryMatrix.js)
  const allCategories = (lookups.categories ?? []).filter((c) => Number(c.is_active ?? 1));
  const workflowCategories = allCategories.filter((c) => Number(c.has_workflow));
  const matrixSaved = async (text) => {
    say('success', text);
    await loadCheckpoints(selectedModel);
  };

  return (
    <Container fluid className="page">
      <div className="page-head">
        <h1>ตั้งค่า Master</h1>
      </div>
      {msg && <Alert variant={msg.variant} dismissible onClose={() => setMsg(null)}>{msg.text}</Alert>}

      {/* 4 แท็บตามสิทธิ์เมนู (Master › ผู้ใช้ & สิทธิ์) — แท็บที่ไม่มีสิทธิ์ไม่ขึ้น · แท็บที่เปิดอยู่จำใน ?tab= */}
      <Nav variant="tabs" activeKey={tab} onSelect={setTab} className="mb-3">
        {visibleTabs.map((t) => (
          <Nav.Item key={t.key}><Nav.Link eventKey={t.key}>{t.label}</Nav.Link></Nav.Item>
        ))}
      </Nav>
      {tab === 'base' && (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <Nav variant="pills" activeKey={baseTab} onSelect={setBaseTab} className="master-subtabs">
            {BASE_TABS.map((t) => (
              <Nav.Item key={t.key}><Nav.Link eventKey={t.key}>{t.label}</Nav.Link></Nav.Item>
            ))}
          </Nav>
          {/* เครื่อง / item / เครื่อง↔item อิงระบบ Drawing Digital — ขึ้นเมื่อ backend ตั้ง DRAWING_DB_NAME
              ⚠️ แตะ item ด้วย → ต้องมีสิทธิ์ master.items (server เช็คทั้งสองเมนู) */}
          {lookups.drawingSync && (!access.loaded || access.can(MENU.masterItems)) && (
            <Button size="sm" variant="outline-primary" className="ms-auto" onClick={() => setSyncShow(true)}>
              ดึงจาก Drawing Digital
            </Button>
          )}
        </div>
      )}

      {tab === 'models' && (
        <ModelsTab
          fromMo={Boolean(prefill)}
          modelForm={modelForm} setModelForm={setModelForm}
          editingModel={editingModel} setEditingModel={setEditingModel}
          cpForm={cpForm} setCpForm={setCpForm}
          editingCp={editingCp} setEditingCp={setEditingCp}
          modelModal={modelModal} setModelModal={setModelModal}
          cpModal={cpModal} setCpModal={setCpModal}
          resetCp={resetCp} onRemember={rememberMeasurement} gaugeMemory={gaugeMemory}
          specMode={specMode} setSpecMode={setSpecMode} tolForm={tolForm} setTolForm={setTolForm}
          models={models} divisions={lookups.divisions} customers={lookups.customers ?? []}
          selectedModel={selectedModel} setSelectedModel={setSelectedModel}
          checkpoints={checkpoints}
          onSave={save} onRemove={remove} onMove={moveCheckpoint} onPurgeVoided={purgeVoided}
          onReorder={reorderCheckpoints} onBulkSaved={bulkSaved}
          reloadCheckpoints={() => loadCheckpoints(selectedModel)}
          onPreviewBaseline={previewBaseline} onClearBaseline={clearBaseline}
          categories={workflowCategories} allCategories={allCategories} onMatrixSaved={matrixSaved}
          scopeName={scopeName}
          onAlert={showAlert}
        />
      )}
      {tab === 'base' && baseTab === 'divisions' && (
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
      {tab === 'base' && baseTab === 'machines' && (
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
      {tab === 'base' && baseTab === 'inspectors' && (
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
      {tab === 'base' && baseTab === 'customers' && (
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
      {tab === 'categories' && (
        <CategoriesTab showForm={showForm} say={say} fail={fail} />
      )}
      {tab === 'users' && (
        // บัญชี login — ไม่มีหน้าสมัครสาธารณะ คนที่มีสิทธิ์เมนูนี้เพิ่มให้คนอื่น (ดู UsersTab.js) + ตารางสิทธิ์เมนู
        <>
          <UsersTab say={say} fail={fail} showForm={showForm} showConfirm={showConfirm} onAlert={showAlert} />
          <PermissionsTab say={say} fail={fail} />
        </>
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
      <DrawingSyncModal
        show={syncShow}
        onHide={() => setSyncShow(false)}
        onDone={async (res) => {
          setSyncShow(false);
          const s = res.summary;
          say('success', `ดึงจาก Drawing Digital แล้ว — เครื่องเพิ่ม ${s.machinesAdded} · ผูก ${s.machinesLinked} · item เพิ่ม ${s.itemsAdded} · ผูก ${s.itemsLinked} · คู่เครื่อง↔item ${s.links}`
            + (s.machinesDeactivated || s.itemsDeactivated ? ` · ปิดใช้งาน ${s.machinesDeactivated + s.itemsDeactivated}` : ''));
          await loadAll();
          await loadCheckpoints(selectedModel);
        }}
      />
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

  // เรียง/กรองหัวคอลัมน์ + แบ่งหน้า — คอลัมน์มาจาก prop (ตัวที่ผู้เรียกเขียน inline) จึงสร้างจาก columns ทุกครั้ง
  const cellText = (c, r) => (c.type === 'check'
    ? (Number(r[c.key]) ? 'ใช่' : '—')
    : c.type === 'select'
      ? (c.options ?? []).find((o) => String(o.id) === String(r[c.key]))?.name ?? '—'
      : r[c.key] ?? '—');
  const cols = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, {
    get: (r) => (c.type === 'number' ? Number(r[c.key]) : cellText(c, r)),
    text: (r) => String(cellText(c, r)),
  }])), [columns]); // eslint-disable-line react-hooks/exhaustive-deps
  const dt = useDataTable(rows, cols);
  const pg = usePager(dt.rows, dt.resetKey);

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

        <FilterBar dt={dt} className="mb-2" />
        <div className="mc-freeze">
          <Table striped bordered hover size="sm" className="mb-0 text-nowrap">
            <thead>
              <tr>
                {columns.map((c, i) => dt.th(c.key, c.label, i === 0 ? { className: 'mc-sticky-start' } : {}))}
                <th className="mc-sticky-end" style={{ width: 130 }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0
                ? <tr><td colSpan={columns.length + 1} className="text-center text-muted">ยังไม่มีข้อมูล</td></tr>
                : pg.rows.map((r) => (
                  <tr key={r.id} className={Number(r.is_active) === 0 ? 'text-muted' : ''}>
                    {columns.map((c, i) => (
                      <td key={c.key} className={i === 0 ? 'mc-sticky-start' : undefined}>{cellText(c, r)}</td>
                    ))}
                    <td className="mc-sticky-end">
                      <Button size="sm" variant="primary" className="me-1" onClick={() => startEdit(r)}>แก้</Button>
                      <Button size="sm" variant="danger" onClick={() => onRemove(table, r.id, labelOf(r))}>ลบ</Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </div>
        <Pager pg={pg} />
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
  modelModal, setModelModal, cpModal, setCpModal,
  specMode, setSpecMode, tolForm, setTolForm,
  models, divisions, customers, selectedModel, setSelectedModel, checkpoints,
  onSave, onRemove, onMove, onPurgeVoided, onPreviewBaseline, onClearBaseline,
  onReorder, onBulkSaved, reloadCheckpoints,
  categories = [], allCategories = [], onMatrixSaved,
  scopeName,
  onAlert,
}) => {
  // error ของกล่อง — ชั่วคราว หายตอนสลับแท็บได้ (ของที่พิมพ์ไม่หาย อยู่ที่ <MasterSetup>)
  const [modelErr, setModelErr] = useState(null);
  const [cpErr, setCpErr] = useState(null);
  const resetModel = () => { setModelForm(blankModel()); setEditingModel(null); setModelErr(null); };
  const closeModel = () => { resetModel(); setModelModal(false); };
  const openAddModel = () => { resetModel(); setModelModal(true); };
  const closeCp = () => { resetCp(); setCpErr(null); setCpModal(false); };
  const openAddCp = () => { resetCp(); setCpErr(null); setCpModal(true); };

  // ค้นหา item ในตารางข้างล่าง — เป็นสเตตชั่วคราวของการมอง ไม่ใช่ของที่กรอกค้างไว้
  // จึงปล่อยให้หายตอนสลับแท็บได้ ต่างจาก modelForm/cpForm ที่ถูกยกขึ้นไปไว้ที่ <MasterSetup>
  const [modelQuery, setModelQuery] = useState('');

  // ── เพิ่มหลายจุด / นำเข้า / คัดลอก ── สเตตชั่วคราว (กล่องเป็น backdrop static สลับแท็บระหว่างเปิดไม่ได้)
  const [bulk, setBulk] = useState({ show: false, initial: null });
  const [copyShow, setCopyShow] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef(null);
  const bulkDefaults = useMemo(() => {
    const m = readCpMemory();
    return { unit: m.unit, gauge: m.gauge, sample_size: m.sampleSize };
  }, [bulk.show]); // eslint-disable-line react-hooks/exhaustive-deps -- อ่านวิธีวัดล่าสุดใหม่ทุกครั้งที่เปิดกล่อง
  // จุดที่เปิดอยู่ (object เต็ม + category_settings) — กล่องเพิ่มหลายจุดจับคู่ชื่อเพื่ออัปเดตทับ
  const activePoints = useMemo(() => checkpoints.filter((c) => c.is_active), [checkpoints]);
  const openBulk = (initial = null) => setBulk({ show: true, initial });
  const importFile = async (file) => {
    if (!file || !selectedModel) return;
    setImportBusy(true);
    try {
      openBulk(await importCheckpointFile(selectedModel, file, categories));
    } catch (e) {
      onAlert({ title: 'นำเข้าไฟล์ไม่ได้', body: e.message });
    } finally { setImportBusy(false); }
  };
  const downloadTemplate = () => apiDownload('/master/checkpoint-template', 'แม่แบบจุดตรวจ.xlsx')
    .catch((e) => onAlert({ title: 'ดาวน์โหลดแม่แบบไม่ได้', body: e.message }));

  // ลากไฟล์พลาดนอกการ์ด เบราว์เซอร์จะเปิดไฟล์แทนหน้าเว็บ (ฟอร์มที่กรอกค้างหาย) — กันไว้ทั้งหน้าตอนอยู่แท็บนี้
  useEffect(() => {
    const block = (e) => { if (isFileDrag(e)) e.preventDefault(); };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => { window.removeEventListener('dragover', block); window.removeEventListener('drop', block); };
  }, []);

  // ── กรองตามหมวด + ลากเรียง ──
  // ⚠️ กรองอยู่ = ปิดลากเรียง/▲▼ — ลำดับคือ seq_no ของทั้งใบ ย้ายในมุมมองที่ซ่อนบางจุดไว้จะดูผิดที่
  const [catFilter, setCatFilter] = useState('all');
  useEffect(() => { setCatFilter('all'); }, [selectedModel]);
  const [orderOverride, setOrderOverride] = useState(null);
  useEffect(() => { setOrderOverride(null); }, [checkpoints]);
  const [dragId, setDragId] = useState(null);
  const [dropAt, setDropAt] = useState(null); // { id, after }
  const ordered = useMemo(() => {
    if (!orderOverride) return checkpoints;
    const byId = new Map(checkpoints.map((c) => [c.id, c]));
    return orderOverride.map((id) => byId.get(id)).filter(Boolean);
  }, [checkpoints, orderOverride]);
  const filterTabs = [
    { key: 'all', label: 'ทั้งหมด', rows: ordered },
    { key: String(ROUTINE_CATEGORY_ID), label: 'ตรวจตามรอบ', rows: pointsForCategory(ordered, ROUTINE_CATEGORY_ID) },
    ...categories.map((c) => ({ key: String(c.id), label: c.name, rows: pointsForCategory(ordered, c.id) })),
  ];
  const shownRows = (filterTabs.find((t) => t.key === catFilter) ?? filterTabs[0]).rows;
  const canReorder = catFilter === 'all' && ordered.length > 1;

  const dropOnRow = (target, after) => {
    const from = dragId;
    setDragId(null); setDropAt(null);
    if (from === null || from === target) return;
    const ids = ordered.map((c) => c.id).filter((id) => id !== from);
    ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, from);
    if (ids.every((id, i) => id === ordered[i].id)) return;
    setOrderOverride(ids);
    onReorder(ids);
  };

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
      return setModelErr('กรอก Division / Item No. / ชื่อ item ให้ครบ');
    }
    const bad = MIN_FIELDS.find((f) => badMin(modelForm[f.key]));
    if (bad) {
      return setModelErr(`min ${bad.label} ต้องเป็นตัวเลขมากกว่า 0 และน้อยกว่า 100 — หรือเว้นว่างเพื่อใช้เกณฑ์ของลูกค้า`);
    }
    // ⚠️ ช่องว่างต้องเป็น null — '' ลงคอลัมน์ INT/DECIMAL ไม่ได้ และ NULL คือ "ตามลูกค้า"
    const data = {
      ...modelForm,
      customer_id: modelForm.customer_id || null,
      ...Object.fromEntries(MIN_FIELDS.map((f) => [f.key, numOrNull(modelForm[f.key])])),
    };
    setModelErr(null);
    const r = await onSave('models', data, editingModel, { inline: true });
    if (!r.ok) return setModelErr(r.error);
    const newId = editingModel ? null : r.id;
    closeModel();
    // เพิ่ม item ใหม่แล้วเลือกให้เลย — ขั้นต่อไปคือเพิ่มจุดตรวจของมัน (item ไม่มีจุดตรวจ = กรอกใบตรวจไม่ได้)
    if (newId) setSelectedModel(String(newId));
  };

  // ช่องเกณฑ์ที่เว้นว่างบอกว่าจะได้ค่าอะไร — คนกรอกต้องเห็นว่าไม่ override แล้วได้เลขไหน
  const formCustomer = customers.find((c) => String(c.id) === String(modelForm.customer_id)) ?? null;
  const minPlaceholder = (key) => (formCustomer
    ? `ตามลูกค้า ${Number(formCustomer[key]).toFixed(2)}`
    : 'ค่าระบบ');

  const submitCp = async (e) => {
    e.preventDefault();
    if (!selectedModel) return setCpErr('เลือก item ก่อน');
    if (!cpForm.name) return setCpErr('กรอกชื่อจุดตรวจ');
    // สเปกกลับหัวบันทึกไปแล้วทุกชิ้นที่วัดจะเป็น NG และ judgment ถูก snapshot ไปแล้ว
    if (issues.blocking) return setCpErr(issues.blocking);
    const isAttrForm = cpForm.char_type === 'attribute';
    const badSetting = Object.entries(cpForm.settings ?? {}).find(([, q]) => {
      const n = Number(q);
      return !Number.isInteger(n) || n < 1 || n > (isAttrForm ? 1 : 10);
    });
    if (badSetting) return setCpErr(isAttrForm ? 'จุดตรวจด้วยตาตรวจได้ 1 ชิ้นต่อขั้น' : 'จำนวนชิ้นของหมวดต้องเป็น 1-10');

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
      in_routine: cpForm.in_routine ? 1 : 0,
    };
    // seq_no ต่อท้ายอัตโนมัติตอนเพิ่มใหม่ — ลำดับปรับด้วยปุ่มลูกศรทีหลัง
    if (!editingCp) data.seq_no = (checkpoints.reduce((m, c) => Math.max(m, c.seq_no), 0) || 0) + 1;

    setCpErr(null);
    const r = await onSave('checkpoints', data, editingCp, { inline: true });
    if (!r.ok) return setCpErr(r.error);
    // ⚠️ ต้องจำก่อน resetCp (ใน closeCp) เพราะ resetCp เติมฟอร์มจากสิ่งที่จำไว้
    onRemember(data);
    // ส่วน "หมวดการตรวจ" — คนละ endpoint (แทนทั้งชุดของจุดนี้) · ล้ม = จุดถูกบันทึกแล้ว บอกในกล่องแล้วให้กดซ้ำ
    const cpId = editingCp ?? r.id;
    try {
      await apiCall(`/master/checkpoints/${cpId}/categories`, {
        method: 'PUT',
        body: {
          settings: Object.entries(cpForm.settings ?? {}).map(([k, q]) => {
            const [categoryId, stage] = k.split(':');
            return { category_id: Number(categoryId), stage, sample_qty: Number(q) };
          }),
        },
      });
      await reloadCheckpoints();
    } catch (e) {
      setEditingCp(cpId);
      return setCpErr(`บันทึกจุดตรวจแล้ว แต่ตั้งหมวดการตรวจไม่สำเร็จ: ${e.message} — กดบันทึกอีกครั้ง`);
    }
    closeCp();
  };

  const startEditCp = (cp) => {
    setEditingCp(cp.id);
    setCpErr(null);
    setCpModal(true);
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
      in_routine: cp.in_routine === undefined || cp.in_routine === null ? true : Number(cp.in_routine) === 1,
      settings: Object.fromEntries((cp.category_settings ?? []).map((x) => [`${x.category_id}:${x.stage}`, String(x.sample_qty)])),
    });
  };

  // ทำซ้ำ = กล่องเพิ่มจุดที่เติมค่าของจุดนั้นไว้ (ยังไม่บันทึกจนกด) — baseline ไม่ติดมา
  const startDuplicateCp = (cp) => {
    startEditCp(cp);
    setEditingCp(null);
    setCpForm((f) => ({ ...f, name: `${cp.name} (สำเนา)`, is_active: true }));
  };

  const setSetting = (key, value) => setCpForm((f) => {
    const settings = { ...(f.settings ?? {}) };
    const v = String(value).replace(/\D/g, '');
    if (v === '' || v === '0') delete settings[key]; else settings[key] = v;
    return { ...f, settings };
  });

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
  // ลิสต์ item ยาวเป็นร้อย — แบ่งหน้า · พิมพ์ค้นหาแล้วกลับหน้า 1
  const modelPg = usePager(visibleModels, modelQuery);

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

  // "แก้จุดนี้" จากตารางหมวด → เปิดกล่องแก้จุดตรวจตัวเดียวกับปุ่ม "แก้" ในตาราง
  const editFromMatrix = startEditCp;

  return (
    <>
    <Row>
      {/* รุ่น */}
      <Col lg={4}>
        <Card className="mb-3">
          <Card.Header className="d-flex align-items-center gap-2">
            <span>Item</span>
            <Button size="sm" className="ms-auto" onClick={openAddModel}>+ เพิ่ม Item</Button>
          </Card.Header>
          <Card.Body>
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
            <div className="mc-freeze model-list">
            <Table size="sm" hover className="mb-0">
              <tbody>
                {modelPg.rows.map((m) => (
                  <tr key={m.id} className={selectedModel === String(m.id) ? 'table-primary' : ''}>
                    <td role="button" onClick={() => setSelectedModel(String(m.id))}>
                      <div className="fw-bold">{m.item_no}</div>
                      <div className="small text-muted">
                        {m.item_name} · {m.division_name}
                        {m.customer_name && ` · ${m.customer_name}`} · {toNum(m.checkpoint_count) || 0} จุด
                        {!m.is_active && <Badge bg="secondary" className="ms-1">ปิดใช้งาน</Badge>}
                        {m.synced_at && <span className="sync-badge" title="ผูกกับระบบ Drawing Digital">Drawing</span>}
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
                        onClick={() => { setEditingModel(m.id); setModelErr(null); setModelModal(true); setModelForm({
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
            </div>
            <Pager pg={modelPg} className="mc-pager--compact" />
          </Card.Body>
        </Card>
      </Col>

      {/* จุดตรวจ */}
      <Col lg={8}>
        {/* ลากไฟล์ Excel มาวางที่การ์ดนี้ = นำเข้าจุดตรวจ (ใบ SET UP / แม่แบบ) → ตารางเพิ่มหลายจุดให้ตรวจก่อนบันทึก */}
        <Card
          style={{ opacity: selectedModel ? 1 : 0.6 }}
          className={`cp-card${dropActive ? ' cp-card--drop' : ''}`}
          onDragEnter={(e) => { if (selectedModel && isFileDrag(e)) { e.preventDefault(); setDropActive(true); } }}
          onDragOver={(e) => { if (selectedModel && isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropActive(false); }}
          onDrop={(e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            setDropActive(false);
            if (selectedModel) importFile(e.dataTransfer.files?.[0]);
          }}
        >
          {dropActive && <div className="cp-card__drop" aria-hidden="true">วางไฟล์ Excel ที่นี่ เพื่อนำเข้าจุดตรวจ</div>}
          <Card.Header className="d-flex flex-wrap align-items-center gap-2">
            <span>
              จุดตรวจ {selectedModel
                ? `— ${models.find((m) => String(m.id) === selectedModel)?.item_no ?? ''}`
                : <span className="small text-muted fw-normal">— เลือก item ทางซ้ายก่อน</span>}
            </span>
            <div className="ms-auto d-flex gap-2">
              <Button size="sm" disabled={!selectedModel} onClick={openAddCp}>+ เพิ่มจุดตรวจ</Button>
              <Dropdown align="end">
                <Dropdown.Toggle size="sm" variant="outline-primary" disabled={!selectedModel || importBusy}>
                  {importBusy && <Spinner size="sm" className="me-1" />}เพิ่มหลายจุด
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  <Dropdown.Item onClick={() => openBulk()}>
                    วางจาก Excel <small className="d-block text-muted">ก๊อปหลายแถวแล้วกด Ctrl+V ในตาราง</small>
                  </Dropdown.Item>
                  <Dropdown.Item onClick={() => fileRef.current?.click()}>
                    นำเข้าไฟล์ Excel <small className="d-block text-muted">ใบ SET UP หรือไฟล์แม่แบบ · ลากไฟล์มาวางที่การ์ดนี้ก็ได้</small>
                  </Dropdown.Item>
                  <Dropdown.Item onClick={() => setCopyShow(true)}>
                    คัดลอกจาก item อื่น <small className="d-block text-muted">ดึงจุดตรวจที่ตั้งไว้แล้วมาแก้ต่อ</small>
                  </Dropdown.Item>
                  <Dropdown.Divider />
                  <Dropdown.Item onClick={downloadTemplate}>ดาวน์โหลดแม่แบบ (.xlsx)</Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
              <input ref={fileRef} type="file" accept=".xlsx" hidden
                onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </Card.Header>
          <Card.Body>
            {/* กรองตามหมวด — ดูทีละหมวดว่าจุดไหนตรวจบ้าง (ตัวเลข = จำนวนจุด) */}
            {selectedModel && checkpoints.length > 0 && (
              <Nav variant="pills" activeKey={catFilter} onSelect={(k) => setCatFilter(k)} className="mb-2 cp-filter">
                {filterTabs.map((t) => (
                  <Nav.Item key={t.key}>
                    <Nav.Link eventKey={t.key}>{t.label} <span className="cp-filter__n">{t.rows.length}</span></Nav.Link>
                  </Nav.Item>
                ))}
              </Nav>
            )}
            {catFilter !== 'all' && (
              <div className="small text-muted mb-2">กำลังกรองอยู่ — ลากเรียง/ย้ายลำดับได้ที่ "ทั้งหมด"</div>
            )}
            {/* ⚠️ ไม่มีเรียงตามคอลัมน์/แบ่งหน้าโดยตั้งใจ — ลำดับแถว = seq_no ของใบตรวจ (ลากเรียง / ▲▼ ย้ายตามลำดับนี้)
                กรองตามหมวดได้ แต่ระหว่างกรองปิดการย้ายลำดับ · ตรึงหัว + คอลัมน์ลำดับ/จัดการ */}
            <div className="mc-freeze">
            <Table striped bordered hover size="sm" className="mb-0">
              <thead>
                <tr>
                  <th className="mc-sticky-start" style={{ width: 70 }}>ลำดับ</th><th>จุดตรวจ</th><th>ชนิด</th>
                  <th>LSL ~ USL</th><th>n / ความถี่</th><th>Control limit</th>
                  <th>หมวดการตรวจ</th><th className="mc-sticky-end" style={{ width: 320 }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.length === 0
                  ? (
                    <tr><td colSpan="8" className="text-center text-muted">
                      {checkpoints.length === 0
                        ? (selectedModel ? 'ยังไม่มีจุดตรวจ — กด "+ เพิ่มจุดตรวจ" หรือ "เพิ่มหลายจุด" (วางจาก Excel / นำเข้าไฟล์ / คัดลอกจาก item อื่น)' : 'ยังไม่มีจุดตรวจ')
                        : 'ไม่มีจุดตรวจในหมวดนี้'}
                    </td></tr>
                  )
                  : shownRows.map((cp, i) => (
                    <tr
                      key={cp.id}
                      className={[
                        editingCp === cp.id ? 'table-warning' : '',
                        !cp.is_active ? 'text-muted' : '',
                        dragId === cp.id ? 'cp-row--dragging' : '',
                        dropAt?.id === cp.id ? (dropAt.after ? 'cp-row--drop-after' : 'cp-row--drop-before') : '',
                      ].filter(Boolean).join(' ')}
                      onDragOver={(e) => {
                        if (dragId === null) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY > r.top + r.height / 2;
                        if (dropAt?.id !== cp.id || dropAt.after !== after) setDropAt({ id: cp.id, after });
                      }}
                      onDrop={(e) => {
                        if (dragId === null) return;
                        e.preventDefault();
                        e.stopPropagation();
                        dropOnRow(cp.id, dropAt?.id === cp.id ? dropAt.after : false);
                      }}
                    >
                      <td className="mc-sticky-start text-nowrap">
                        {/* ด้ามลาก (เมาส์) · ▲▼ ยังอยู่สำหรับคีย์บอร์ด/จอสัมผัส (HTML5 drag ไม่ทำงานบนจอสัมผัส) */}
                        {canReorder && (
                          <span
                            className="cp-drag" draggable title="ลากเพื่อย้ายลำดับ" aria-hidden="true"
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', String(cp.id));
                              const row = e.currentTarget.closest('tr');
                              if (row) e.dataTransfer.setDragImage(row, 16, 16);
                              setDragId(cp.id);
                            }}
                            onDragEnd={() => { setDragId(null); setDropAt(null); }}
                          >⠿</span>
                        )}
                        {cp.seq_no}
                        <Button size="sm" variant="link" className="p-0 ms-1" disabled={!canReorder || i === 0}
                          aria-label={`ย้าย ${cp.name} ขึ้น`} title="ย้ายขึ้น"
                          onClick={() => onMove(cp.id, 'up')}><Caret dir="up" /></Button>
                        <Button size="sm" variant="link" className="p-0" disabled={!canReorder || i === shownRows.length - 1}
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
                        {/* สรุปอ่านอย่างเดียว — แก้ที่ "ตารางหมวดการตรวจ" ใต้การ์ดนี้ */}
                        <div className={Number(cp.in_routine ?? 1) ? '' : 'text-muted'}>
                          ตามรอบ: {Number(cp.in_routine ?? 1) ? `${cp.char_type === 'attribute' ? 1 : cp.sample_size} / ${freqShort(cp.frequency)}` : 'ไม่ตรวจ'}
                        </div>
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
                      </td>
                      <td className="mc-sticky-end text-nowrap">
                        <Button size="sm" variant="primary" className="me-1" onClick={() => startEditCp(cp)}>แก้</Button>
                        <Button size="sm" variant="outline-primary" className="me-1" onClick={() => startDuplicateCp(cp)}
                          title="เพิ่มจุดใหม่ที่ค่าเหมือนจุดนี้">ทำซ้ำ</Button>
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
            </div>
          </Card.Body>
        </Card>
      </Col>
    </Row>

    {/* ตารางจุดตรวจ × หมวด (แถว = จุด เรียงตามใบ · คอลัมน์ = หมวด) — Korn เลือกรูปนี้ 2026-11 */}
    {selectedModel && (
      <CategoryMatrix
        modelId={selectedModel}
        checkpoints={checkpoints}
        categories={allCategories}
        onSaved={onMatrixSaved}
        onEditPoint={editFromMatrix}
        onAlert={onAlert}
      />
    )}

    {/* ── เพิ่มหลายจุด (วาง Excel / ไฟล์ / คัดลอก) — components/master/CheckpointBulkModal.js ── */}
    <CheckpointBulkModal
      show={bulk.show && Boolean(selectedModel)}
      onHide={() => setBulk({ show: false, initial: null })}
      modelId={selectedModel}
      itemLabel={models.find((m) => String(m.id) === selectedModel)?.item_no ?? ''}
      categories={categories}
      existingPoints={activePoints}
      initial={bulk.initial}
      defaults={bulkDefaults}
      onSaved={(res) => { setBulk({ show: false, initial: null }); onBulkSaved(res); }}
    />
    <CopyFromItemModal
      show={copyShow}
      onHide={() => setCopyShow(false)}
      models={models}
      currentModelId={selectedModel}
      onPick={(initial) => { setCopyShow(false); openBulk(initial); }}
    />

    {/* ── กล่องเพิ่ม/แก้ item ── animation={false} ตามกฎ AppDialog · ไม่ใช้ scrollable (ลิสต์ของ SearchSelect โดนตัด) */}
    <Modal show={modelModal} onHide={closeModel} animation={false} backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>{editingModel ? `แก้ Item ${modelForm.item_no}` : 'เพิ่ม Item'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* ⚠️ ในกล่องห้ามใช้ <Alert> (role="alert") — ใช้ .form-note */}
        {fromMo && !editingModel && (
          <div className="form-note form-note--info mb-2">
            ข้อมูลจาก MO เติมไว้ให้แล้ว — ตรวจดูแล้วกด <b>เพิ่ม Item</b> จากนั้นเพิ่มจุดตรวจ
            (เพิ่ม item เฉย ๆ ยังกรอกใบตรวจไม่ได้ ต้องมีจุดตรวจด้วย)
          </div>
        )}
        <Form id="model-form" onSubmit={submitModel}>
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
        </Form>
        {modelErr && <div className="form-note form-note--danger mt-2" role="status">{modelErr}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={closeModel}>ยกเลิก</Button>
        <Button type="submit" form="model-form">{editingModel ? 'บันทึกการแก้ไข' : 'เพิ่ม Item'}</Button>
      </Modal.Footer>
    </Modal>

    {/* ── กล่องเพิ่ม/แก้จุดตรวจ ── backdrop static: คลิกพลาดนอกกล่องต้องไม่ทิ้งสเปกที่พิมพ์ไว้ */}
    <Modal show={cpModal && Boolean(selectedModel)} onHide={closeCp} animation={false} backdrop="static" size="xl">
      <Modal.Header closeButton>
        <Modal.Title>
          {editingCpRow
            ? <>แก้จุดที่ {editingCpRow.seq_no} — {editingCpRow.name}</>
            : <>เพิ่มจุดตรวจ — {models.find((m) => String(m.id) === selectedModel)?.item_no ?? ''}</>}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* ฟอร์มแบ่ง 4 ส่วน (Korn สั่ง 2026-11 "แยกหมวดหมู่ของการ set แต่ละจุด") — เรียงต่อกัน ไม่ใช้แท็บ
            ⚠️ คำเตือนสเปก/error ต้องไม่ถูกซ่อนอยู่หลังแท็บที่ไม่ได้เปิด */}
        <Form id="cp-form" onSubmit={submitCp}>
          <div className="cp-section">① ข้อมูลจุด</div>
          <Row className="g-2 mb-2 align-items-end">
            <Form.Group as={Col} md={4} controlId="cp-name">
              <Form.Label className="small mb-1">ชื่อจุดตรวจ</Form.Label>
              <Form.Control placeholder="เช่น Dimension 3.1" {...cpField('name')} disabled={!selectedModel} />
            </Form.Group>
            {/* Characteristic = แถว 11 ของชีต Input (Slot / OD / Rz) แยกจากชื่อจุด
                free text + <datalist> ตามหลักเดียวกับหน่วย/เครื่องมือวัด */}
            <Form.Group as={Col} md={3} controlId="cp-characteristic">
              <Form.Label className="small mb-1">Characteristic</Form.Label>
              <Form.Control list="cp-char-options" placeholder="เช่น OD"
                {...cpField('characteristic')} disabled={!selectedModel} />
            </Form.Group>
            <Form.Group as={Col} md={3} controlId="cp-char-type">
              <Form.Label className="small mb-1">ชนิด</Form.Label>
              <Form.Select {...cpField('char_type')} disabled={!selectedModel}>
                {CHAR_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Form.Select>
            </Form.Group>
            <Col md={2} className="d-flex flex-column gap-1 pb-1">
              <Form.Check id="cp-critical" label="SC point" checked={cpForm.is_critical} disabled={!selectedModel}
                onChange={(e) => setCpForm((f) => ({ ...f, is_critical: e.target.checked }))} />
              <Form.Check id="cp-active" label="ใช้งาน" checked={cpForm.is_active} disabled={!selectedModel}
                onChange={(e) => setCpForm((f) => ({ ...f, is_active: e.target.checked }))} />
            </Col>
          </Row>

          <div className="cp-section">② วิธีวัด</div>
          <Row className="g-2 mb-2 align-items-end">
            {/* ⚠️ หน่วยกับเครื่องมือวัดเป็น <input list> โดยตั้งใจ ไม่ใช่ <Form.Select>
                ทั้งสองคอลัมน์เป็น free text มาแต่ไหนแต่ไร บังคับเลือกเมื่อไหร่ ค่าเก่าที่
                ไม่ตรงลิสต์จะแสดงเป็นช่องว่างแล้วถูกเขียนทับตอนกดบันทึกแก้อย่างอื่น */}
            <Form.Group as={Col} md={5} controlId="cp-gauge">
              <Form.Label className="small mb-1">เครื่องมือวัด</Form.Label>
              <Form.Control list="cp-gauge-options" placeholder="เช่น Micrometer"
                {...cpField('gauge')} disabled={!selectedModel} />
            </Form.Group>
            <Form.Group as={Col} md={2} controlId="cp-unit">
              <Form.Label className="small mb-1">หน่วย</Form.Label>
              <Form.Control list="cp-unit-options" placeholder="mm"
                {...cpField('unit')} disabled={!selectedModel || isAttr} />
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
          <div className="cp-section">③ สเปก</div>
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
              เว้น LSL หรือ USL ว่างได้ถ้าแบบคุมด้านเดียว
              {tolMode && ' · ไม่ใส่เครื่องหมาย = พิกัดบนขึ้น พิกัดล่างลง · ใส่ + หรือ - เองได้ถ้าแบบเขียนไว้แบบนั้น (เช่น 10 -0.005 -0.015)'}
            </div>
          )}
          {isAttr && <div className="small text-muted mb-2">ตรวจด้วยตา — ไม่มีสเปกตัวเลข ผลเป็น OK / NG</div>}
          {issues.blocking && (
            <div className="form-note form-note--danger mb-2">{issues.blocking}</div>
          )}
          {issues.warnings.map((w) => (
            <div key={w} className="form-note form-note--warning mb-2">{w}</div>
          ))}

          {/* ④ ตรวจในหมวดไหนบ้าง — ตรวจตามรอบ = in_routine + ชิ้น/ครั้ง + ความถี่ (คอลัมน์ของ checkpoints)
              หมวดอื่น = checkpoint_category_settings (PUT /checkpoints/:id/categories หลังบันทึกจุด) · ว่าง = ไม่ตรวจ */}
          <div className="cp-section">④ หมวดการตรวจ</div>
          <div className="cp-cats">
            <div className="cp-cats__row">
              <Form.Check id="cp-in-routine" className="cp-cats__name" label="ตรวจตามรอบ (Inspection Record)"
                checked={Boolean(cpForm.in_routine)} disabled={!selectedModel}
                onChange={(e) => setCpForm((f) => ({ ...f, in_routine: e.target.checked }))} />
              <Form.Group controlId="cp-sample-size" className="cp-cats__field">
                {/* n = 1 → กราฟ I-MR · n >= 2 → กราฟ X-bar R (ตาราง A2/D3/D4 มีถึง 10) */}
                <Form.Label className="small mb-0">ชิ้น/ครั้ง</Form.Label>
                <Form.Control size="sm" type="number" min="1" max="10"
                  {...cpField('sample_size')} disabled={!selectedModel || isAttr} />
              </Form.Group>
              <Form.Group controlId="cp-frequency" className="cp-cats__field">
                <Form.Label className="small mb-0">ความถี่</Form.Label>
                <Form.Select size="sm" {...cpField('frequency')} disabled={!selectedModel}>
                  {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </Form.Select>
              </Form.Group>
              {!isAttr && <span className="small text-muted">1 ชิ้น = กราฟ I-MR · 2 ขึ้นไป = X̄-R</span>}
            </div>
            {categories.map((c) => (
              <div className="cp-cats__row" key={c.id}>
                <span className="cp-cats__name">{c.name}</span>
                {(FLOW_STAGES[c.flow] ?? FLOW_STAGES.pd_qc).map((st) => {
                  const key = `${c.id}:${st}`;
                  return (
                    <Form.Group key={st} controlId={`cp-cat-${key}`} className="cp-cats__field">
                      <Form.Label className="small mb-0">{STAGE_LABEL[st]} (ชิ้น)</Form.Label>
                      <Form.Control size="sm" className="num" inputMode="numeric" placeholder="ไม่ตรวจ"
                        value={cpForm.settings?.[key] ?? ''} disabled={!selectedModel}
                        onChange={(e) => setSetting(key, e.target.value)} />
                    </Form.Group>
                  );
                })}
              </div>
            ))}
            <div className="small text-muted">เว้นว่าง = ไม่ตรวจจุดนี้ในขั้นนั้น{isAttr ? ' · ตรวจด้วยตาใส่ได้แค่ 1' : ''}</div>
          </div>
        </Form>
        {cpErr && <div className="form-note form-note--danger mt-2" role="status">{cpErr}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={closeCp}>ยกเลิก</Button>
        <Button type="submit" form="cp-form" disabled={Boolean(issues.blocking)}>
          {editingCp ? 'บันทึก' : 'เพิ่มจุดตรวจ'}
        </Button>
      </Modal.Footer>
    </Modal>
    </>
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
