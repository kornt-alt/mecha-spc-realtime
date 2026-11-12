// services/drawingSync.js — ดึงเครื่องจักร / item / เครื่อง↔item ที่รันได้ จากระบบ Drawing Digital (MECHA1)
//
// Korn สั่ง (2026-11): "พวกเครื่องพวกอะไรไปอิงกับระบบนี้ก็ได้" — D:\SCRIPT\WEB\DIGITAL_DRAWING_MECHA1
// DB ของระบบนั้น (env DRAWING_DB_NAME เช่น mecha1_drawing_digital) อยู่ server เดียวกัน user เดียวกันอ่านได้
//
// ⚠️ ทางเดียว Drawing → SPC และ **อ่านอย่างเดียว** — ห้ามมีคำสั่งเขียนไปที่ DB ของ Drawing ในไฟล์นี้เด็ดขาด
// ⚠️ เก็บสำเนาใน SPC (ไม่อ่านสด) — ใบตรวจมี FK RESTRICT ไป machines/models · Mecha 2 ไม่อยู่ใน Drawing · Drawing ล่ม หน้าไลน์ต้องใช้ได้ต่อ
// ⚠️ ไม่ทับของที่คนตั้งไว้ใน SPC: ชื่อเครื่อง/ชื่อ item ที่มีอยู่แล้วไม่เปลี่ยน (เติมเฉพาะ drawing_no ที่ว่าง) · ไม่แตะลูกค้า/เกณฑ์/จุดตรวจ
//    SPC ปิดใช้งานเอง แต่ Drawing ยังเปิด = ไม่เปิดคืนให้ · Drawing ปิด = SPC ปิดตาม (เฉพาะแถวที่ผูกกับ Drawing แล้ว · ไม่ลบ)
// ⚠️ จับคู่ด้วยคีย์ธรรมชาติ: เครื่อง = code · item = division + item_no — ของที่ไม่มีใน Drawing (Mecha 2 / TEST) ไม่ถูกแตะ
//
// computePlan() เป็น pure (เทสด้วย node ได้) · loadSources()/applyPlan() คุยกับ DB
'use strict';

const env = require('../config/env');

// division ของ Drawing เป็นข้อความ ("M/P 1") → ipbass_dept ของ SPC (ตามกฎ IPBASS: M/P1 = T47563 · M/P2 = T47183)
const DEPT_BY_DIVISION = { MP1: 'T47563', MP2: 'T47183' };
const divisionKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const dbName = () => {
  const n = env.DRAWING_DB_NAME;
  return n && /^[A-Za-z0-9_]+$/.test(n) ? n : null;
};
const enabled = () => Boolean(dbName());

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());
const itemKey = (divisionId, itemNo) => `${divisionId}|${clean(itemNo).toLowerCase()}`;
// รหัสเครื่องเทียบแบบไม่สน # - เว้นวรรค ตัวพิมพ์ — SPC ตั้งมือเป็น "CGM#18" ส่วน Drawing เป็น "CGM-18" = เครื่องเดียวกัน
const codeKey = (code) => clean(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

// ── pure ─────────────────────────────────────────────────────────────────
// src = { drawing: { machines, models, links }, spc: { divisions, machines, models, links } }
// คืนแผน: อะไรจะถูกเพิ่ม / ผูก / เติม / ปิด / ข้าม (พร้อมเหตุผล) + ชุดคู่เครื่อง↔item ที่ควรเป็น
const computePlan = ({ drawing, spc }) => {
  const warnings = [];
  const divByDept = new Map(spc.divisions.filter((d) => d.ipbass_dept).map((d) => [String(d.ipbass_dept).trim(), d]));
  const mapDivision = (text) => divByDept.get(DEPT_BY_DIVISION[divisionKey(text)] ?? '') ?? null;
  // เครื่องที่ Drawing ไม่ได้ใส่ division — ถ้าเครื่องที่ใส่ทั้งหมดเป็น division เดียว (ระบบนี้คือ MECHA1) ใช้อันนั้น
  const namedDivs = new Map();
  for (const dm of drawing.machines) { const d = clean(dm.division) && mapDivision(dm.division); if (d) namedDivs.set(d.id, d); }
  const fallbackDiv = namedDivs.size === 1 ? [...namedDivs.values()][0] : null;
  let usedFallback = 0;

  // ── เครื่อง ──
  const spcMachineByCode = new Map(spc.machines.map((m) => [codeKey(m.code), m]));
  const machines = { add: [], link: [], deactivate: [], skip: [], unchanged: 0 };
  const machineDivision = new Map(); // drawing machine id → SPC division
  for (const dm of drawing.machines) {
    const code = clean(dm.code);
    if (!code) continue;
    const existing = spcMachineByCode.get(codeKey(code));
    let div = mapDivision(dm.division);
    if (!div && !clean(dm.division) && fallbackDiv) { div = fallbackDiv; if (Number(dm.active)) usedFallback += 1; }
    if (!div) {
      if (Number(dm.active)) machines.skip.push({ code, reason: `division "${clean(dm.division) || '—'}" แมปกับ division ของ SPC ไม่ได้ (ต้องตั้ง IPBASS dept)` });
      continue;
    }
    if (existing && existing.division_id !== div.id) {
      machines.skip.push({ code, reason: `มีใน SPC แล้วแต่อยู่ division อื่น (${div.name} ใน Drawing)` });
      continue;
    }
    machineDivision.set(dm.id, div);
    const allowAll = Number(dm.allow_all_models) ? 1 : 0;
    if (!existing) {
      if (Number(dm.active)) machines.add.push({ code, name: clean(dm.name) || code, division_id: div.id, division_name: div.name, allow_all_items: allowAll });
      continue;
    }
    if (!Number(dm.active)) {
      if (existing.is_active && existing.synced_at) machines.deactivate.push({ id: existing.id, code, name: existing.name });
      continue;
    }
    const changes = [];
    if (!existing.synced_at) changes.push(existing.code === code ? 'ผูกกับ Drawing' : `ผูกกับ Drawing (${code})`);
    if (Number(existing.allow_all_items ?? 1) !== allowAll) changes.push(allowAll ? 'รันได้ทุก item' : 'รันได้เฉพาะ item ที่ผูก');
    if (!existing.is_active) warnings.push(`เครื่อง ${code} ถูกปิดใช้งานใน SPC แต่ยังเปิดใน Drawing — ไม่เปิดคืนให้`);
    if (changes.length) machines.link.push({ id: existing.id, code, name: existing.name, allow_all_items: allowAll, changes });
    else machines.unchanged += 1;
  }

  if (usedFallback) warnings.push(`เครื่อง ${usedFallback} เครื่องใน Drawing ไม่ได้ระบุ division — ใช้ ${fallbackDiv.name} (division เดียวของเครื่องที่ระบุไว้)`);

  // ── item: division เอาจากเครื่องที่รันมัน · ไม่มีเครื่อง = division เดียวของเครื่องทั้งหมดใน Drawing (ถ้ามีแบบเดียว)
  const allDivs = new Set([...machineDivision.values()].map((d) => d.id));
  const soleDiv = allDivs.size === 1 ? [...machineDivision.values()][0] : null;
  const allowAllMachines = drawing.machines.filter((m) => Number(m.allow_all_models) && Number(m.active) && machineDivision.has(m.id));
  const divsOfModel = new Map();
  for (const l of drawing.links) {
    const d = machineDivision.get(l.machine_id);
    if (!d) continue;
    if (!divsOfModel.has(l.model_id)) divsOfModel.set(l.model_id, new Map());
    divsOfModel.get(l.model_id).set(d.id, d);
  }
  const spcItemByKey = new Map(spc.models.map((m) => [itemKey(m.division_id, m.item_no), m]));
  const items = { add: [], link: [], deactivate: [], skip: [], unchanged: 0 };
  const modelDivision = new Map(); // drawing model id → SPC division
  for (const dmo of drawing.models) {
    const itemNo = clean(dmo.item_no);
    if (!itemNo) continue;
    let divs = [...(divsOfModel.get(dmo.id)?.values() ?? [])];
    for (const am of allowAllMachines) {
      const d = machineDivision.get(am.id);
      if (!divs.some((x) => x.id === d.id)) divs.push(d);
    }
    if (divs.length === 0 && soleDiv) divs = [soleDiv];
    if (divs.length !== 1) {
      if (Number(dmo.active)) {
        items.skip.push({ item_no: itemNo, reason: divs.length ? `รันบนเครื่องหลาย division (${divs.map((d) => d.name).join(', ')}) — เลือก division เองที่ Master` : 'ไม่รู้ division (ไม่มีเครื่องไหนรัน)' });
      }
      continue;
    }
    const div = divs[0];
    modelDivision.set(dmo.id, div);
    const existing = spcItemByKey.get(itemKey(div.id, itemNo));
    const drawingNo = clean(dmo.drawing_no);
    if (!existing) {
      if (Number(dmo.active)) {
        items.add.push({ division_id: div.id, division_name: div.name, item_no: itemNo, item_name: (clean(dmo.name) || drawingNo || itemNo).slice(0, 150), drawing_no: drawingNo || null });
      }
      continue;
    }
    if (!Number(dmo.active)) {
      if (existing.is_active && existing.synced_at) items.deactivate.push({ id: existing.id, item_no: itemNo, item_name: existing.item_name });
      continue;
    }
    const changes = [];
    const set = {};
    if (!existing.synced_at) changes.push('ผูกกับ Drawing');
    if (!clean(existing.drawing_no) && drawingNo) { changes.push(`เติมเลขแบบ ${drawingNo}`); set.drawing_no = drawingNo; }
    if (!existing.is_active) warnings.push(`item ${itemNo} ถูกปิดใช้งานใน SPC แต่ยังเปิดใน Drawing — ไม่เปิดคืนให้`);
    if (changes.length) items.link.push({ id: existing.id, item_no: itemNo, item_name: existing.item_name, set, changes });
    else items.unchanged += 1;
  }

  // ── คู่เครื่อง↔item: เฉพาะเครื่องที่ผูก Drawing และไม่ได้ "รันได้ทุก item" · ปลายทางเป็นคีย์ (id ของของใหม่ยังไม่มี)
  const desired = new Map(); // machine code → Set(itemKey)
  for (const dm of drawing.machines) {
    if (!Number(dm.active) || Number(dm.allow_all_models) || !machineDivision.has(dm.id)) continue;
    const code = codeKey(dm.code);
    if (machines.skip.some((s) => codeKey(s.code) === code)) continue;
    desired.set(code, new Set());
  }
  const modelById = new Map(drawing.models.map((m) => [m.id, m]));
  const machineById = new Map(drawing.machines.map((m) => [m.id, m]));
  for (const l of drawing.links) {
    const dm = machineById.get(l.machine_id);
    const dmo = modelById.get(l.model_id);
    if (!dm || !dmo || !Number(dmo.active)) continue;
    const set = desired.get(codeKey(dm.code));
    const div = modelDivision.get(dmo.id);
    if (!set || !div || div.id !== machineDivision.get(dm.id)?.id) continue;
    set.add(itemKey(div.id, dmo.item_no));
  }
  // เทียบกับที่มีใน SPC ตอนนี้ (นับ เพิ่ม/ลบ ให้ preview)
  const spcMachineById = new Map(spc.machines.map((m) => [m.id, m]));
  const spcModelById = new Map(spc.models.map((m) => [m.id, m]));
  const current = new Map();
  for (const l of spc.links) {
    const m = spcMachineById.get(l.machine_id);
    const mo = spcModelById.get(l.model_id);
    if (!m || !mo) continue;
    const code = codeKey(m.code);
    if (!current.has(code)) current.set(code, new Set());
    current.get(code).add(itemKey(mo.division_id, mo.item_no));
  }
  let linkAdd = 0;
  let linkRemove = 0;
  for (const [code, want] of desired) {
    const have = current.get(code) ?? new Set();
    for (const k of want) if (!have.has(k)) linkAdd += 1;
    for (const k of have) if (!want.has(k)) linkRemove += 1;
  }
  const links = {
    machines: [...desired].map(([code, set]) => ({ code, itemKeys: [...set] })),
    add: linkAdd,
    remove: linkRemove,
    total: [...desired.values()].reduce((n, s) => n + s.size, 0),
  };

  const changed = machines.add.length + machines.link.length + machines.deactivate.length
    + items.add.length + items.link.length + items.deactivate.length + linkAdd + linkRemove;
  return { machines, items, links, warnings, changed };
};

// ── DB ───────────────────────────────────────────────────────────────────
// q = (sql, params) => [rows] — pool.query หรือ conn.query (ใน transaction)
const tryQuery = async (q, sql, fallbackSql) => {
  try {
    const [rows] = await q(sql);
    return rows;
  } catch (e) {
    // ยังไม่ได้รัน db:apply (คอลัมน์/ตารางใหม่ยังไม่มี) — preview ยังดูได้
    if (fallbackSql !== undefined && (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_TABLE')) {
      if (fallbackSql === null) return [];
      const [rows] = await q(fallbackSql);
      return rows;
    }
    throw e;
  }
};

const loadSources = async (q) => {
  const db = dbName();
  if (!db) throw new Error('ยังไม่ได้ตั้ง DRAWING_DB_NAME ใน backend/.env');
  const [[dMachines], [dModels], [dLinks], [divisions], spcModels] = await Promise.all([
    q(`SELECT id, code, name, division, active, allow_all_models FROM \`${db}\`.machines`),
    q(`SELECT id, item_no, drawing_no, name, active FROM \`${db}\`.models`),
    q(`SELECT machine_id, model_id FROM \`${db}\`.machine_models`),
    q('SELECT id, name, ipbass_dept FROM divisions'),
    tryQuery(q,
      'SELECT id, division_id, item_no, item_name, drawing_no, is_active, synced_at FROM models',
      'SELECT id, division_id, item_no, item_name, drawing_no, is_active, NULL AS synced_at FROM models'),
  ]);
  const spcMachines = await tryQuery(q,
    'SELECT id, division_id, code, name, is_active, allow_all_items, synced_at FROM machines',
    'SELECT id, division_id, code, name, is_active, 1 AS allow_all_items, NULL AS synced_at FROM machines');
  const spcLinks = await tryQuery(q, 'SELECT machine_id, model_id FROM machine_items', null);
  return {
    drawing: { machines: dMachines, models: dModels, links: dLinks },
    spc: { divisions, machines: spcMachines, models: spcModels, links: spcLinks },
  };
};

// แผนสด (ใช้ทั้ง preview และใน transaction ตอน apply — ไม่เชื่อแผนที่ client ส่งมา)
const buildPlan = async (q) => computePlan(await loadSources(q));

// เขียนตามแผนลง SPC — conn ต้องอยู่ใน transaction (withTransaction) · คืนสรุปตัวเลข
const applyPlan = async (conn, plan) => {
  const q = (sql, p) => conn.query(sql, p);
  for (const m of plan.machines.add) {
    await q('INSERT INTO machines (division_id, code, name, is_active, allow_all_items, synced_at) VALUES (?, ?, ?, 1, ?, NOW())',
      [m.division_id, m.code, m.name.slice(0, 100), m.allow_all_items]);
  }
  for (const m of plan.machines.link) {
    await q('UPDATE machines SET allow_all_items = ?, synced_at = NOW() WHERE id = ?', [m.allow_all_items, m.id]);
  }
  for (const m of plan.machines.deactivate) await q('UPDATE machines SET is_active = 0, synced_at = NOW() WHERE id = ?', [m.id]);
  for (const it of plan.items.add) {
    await q('INSERT INTO models (division_id, item_no, item_name, drawing_no, is_active, synced_at) VALUES (?, ?, ?, ?, 1, NOW())',
      [it.division_id, it.item_no, it.item_name, it.drawing_no]);
  }
  for (const it of plan.items.link) {
    await q(`UPDATE models SET synced_at = NOW()${it.set.drawing_no ? ', drawing_no = ?' : ''} WHERE id = ?`,
      it.set.drawing_no ? [it.set.drawing_no, it.id] : [it.id]);
  }
  for (const it of plan.items.deactivate) await q('UPDATE models SET is_active = 0, synced_at = NOW() WHERE id = ?', [it.id]);

  // คู่เครื่อง↔item: แทนทั้งชุดของเครื่องที่ผูก Drawing (id ของของที่เพิ่งเพิ่มหาจากคีย์)
  if (plan.links.machines.length) {
    const [mrows] = await q('SELECT id, code FROM machines');
    const [irows] = await q('SELECT id, division_id, item_no FROM models');
    const machineId = new Map(mrows.map((m) => [codeKey(m.code), m.id]));
    const itemId = new Map(irows.map((i) => [itemKey(i.division_id, i.item_no), i.id]));
    const ids = plan.links.machines.map((m) => machineId.get(m.code)).filter(Boolean);
    if (ids.length) await q('DELETE FROM machine_items WHERE machine_id IN (?)', [ids]);
    const rows = plan.links.machines.flatMap((m) => {
      const mid = machineId.get(m.code);
      return mid ? m.itemKeys.map((k) => itemId.get(k)).filter(Boolean).map((iid) => [mid, iid]) : [];
    });
    for (let i = 0; i < rows.length; i += 500) {
      await q('INSERT INTO machine_items (machine_id, model_id) VALUES ?', [rows.slice(i, i + 500)]);
    }
  }
  return {
    machinesAdded: plan.machines.add.length,
    machinesLinked: plan.machines.link.length,
    machinesDeactivated: plan.machines.deactivate.length,
    itemsAdded: plan.items.add.length,
    itemsLinked: plan.items.link.length,
    itemsDeactivated: plan.items.deactivate.length,
    links: plan.links.total,
  };
};

module.exports = { enabled, computePlan, buildPlan, applyPlan, loadSources, DEPT_BY_DIVISION };
