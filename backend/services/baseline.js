// backend/services/baseline.js — คำนวณและ freeze control limit ของจุดตรวจ
//
// ทำไมต้อง freeze: ถ้าคำนวณ UCL/LCL ใหม่จากข้อมูลทั้งหมดทุกครั้งที่เปิดกราฟ เส้นลิมิตจะ
// วิ่งตาม process ที่ค่อย ๆ drift ไปด้วย แล้วจะไม่มีวันจับความผิดปกติได้เลย — กราฟดูสวย
// ทุกวันแต่ไม่เคยเตือนอะไรสักครั้ง เป็นกับดักคลาสสิกของ SPC ที่เขียนเอง
//
// ขั้นตอนที่ถูก: เก็บข้อมูลช่วงที่ process นิ่ง 20-25 subgroup → กด Set baseline → ลิมิตถูกล็อก
// → หลังจากนั้นกราฟอ่านจากค่าที่ล็อกไว้ ไม่คำนวณสดอีก
//
// ⚠️ baseline แยก "รายเครื่อง" ตั้งแต่เวอร์ชันนี้ — เก็บที่ตาราง checkpoint_baselines
//    (เดิมเป็นคอลัมน์ baseline_* บน checkpoints = 1 ชุดต่อจุดตรวจ) เหตุผลอยู่ใน schema.sql
//    แต่ละเครื่องคือคนละ process เส้นลิมิตของเครื่อง A ใช้ตัดสินเครื่อง B ไม่ได้
//
// ⚠️ ขอบเขตของ baseline กับตัวกรองข้อมูลเป็นค่าเดียวกันเสมอ (filter.machine_id) — ล็อก
//    baseline ของ MC-01 คือคำนวณจากใบตรวจของ MC-01 เท่านั้น แยกสองค่านี้ออกจากกันเมื่อไหร่
//    จะเปิดทางให้ล็อกลิมิตของเครื่องหนึ่งด้วยข้อมูลของอีกเครื่อง
'use strict';

const { execute } = require('../db/pool');
const { fetchCheckpointRows, fetchCheckpoint } = require('../db/queries');
const { buildSubgroups, computeLimits, MIN_BASELINE_SUBGROUPS } = require('./spcStats');
const { AppError } = require('../middleware/errorHandler');

// computeBaseline(checkpointId, filter) — ลองคำนวณดูว่าจะได้ baseline เท่าไร (ยังไม่เขียน DB)
// ใช้ทั้งตอนพรีวิวก่อนกดยืนยัน และตอนบันทึกจริง
const computeBaseline = async (checkpointId, filter = {}) => {
  const checkpoint = await fetchCheckpoint(checkpointId);
  if (!checkpoint) throw new AppError('ไม่พบจุดตรวจนี้', 404);
  if (checkpoint.char_type === 'attribute') {
    throw new AppError('จุดตรวจแบบ attribute ไม่มีค่าตัวเลข จึงทำ baseline ไม่ได้', 400);
  }

  const rows = await fetchCheckpointRows(checkpointId, filter);
  const { subgroups, n, mixedN } = buildSubgroups(rows);

  if (mixedN) {
    throw new AppError(
      `ช่วงที่เลือกมี subgroup ขนาดไม่เท่ากัน (n = ${mixedN.sizes.join(', ')}) — เลือกช่วงที่ n เท่ากันทั้งหมดก่อน`,
      400
    );
  }
  if (subgroups.length === 0) {
    throw new AppError('ช่วงที่เลือกไม่มีข้อมูลค่าวัด', 400);
  }

  // ⚠️ n ที่ทำ baseline ต้องตรงกับ sample_size ปัจจุบัน ไม่งั้นค่า A2/D3/D4 ที่ใช้คนละตัว
  const currentN = Number(checkpoint.sample_size) || 1;
  if (n !== currentN) {
    throw new AppError(
      `ข้อมูลในช่วงนี้เป็น n = ${n} แต่จุดตรวจตั้ง sample_size = ${currentN} อยู่ — แก้ให้ตรงกันก่อน`,
      400
    );
  }

  const limits = computeLimits(subgroups, n, null);
  const times = subgroups.map((s) => new Date(s.meta.inspectedAt)).filter((d) => !Number.isNaN(d.getTime()));

  return {
    checkpoint,
    // ขอบเขตที่คำนวณมา — 0 = รวมทุกเครื่อง · หน้าจอต้องบอกให้ชัดว่ากำลังจะล็อกของใคร
    machineId: scopeOf(filter),
    n,
    subgroupCount: subgroups.length,
    // ไม่บล็อกถ้าน้อยกว่า 20 แต่บอกให้รู้ตัว — หน้างานบางทีต้องเริ่มใช้ก่อนเก็บครบจริง ๆ
    enoughSubgroups: subgroups.length >= MIN_BASELINE_SUBGROUPS,
    minSubgroups: MIN_BASELINE_SUBGROUPS,
    xbarbar: limits.xbarbar,
    rbar: limits.rbar,
    limits,
    from: times.length ? new Date(Math.min(...times)) : null,
    to: times.length ? new Date(Math.max(...times)) : null,
  };
};

// toMysqlDateTime — mysql2 รับ Date object ได้ แต่แปลงตาม timezone ของ connection
// ตรงนี้ format เองให้เป็นเวลาท้องถิ่นแบบเดียวกับที่ inspected_at เก็บไว้ กันเลื่อนไปมา
const toMysqlDateTime = (d) => {
  if (!d) return null;
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// scopeOf(filter) — แปลงตัวกรองเป็นรหัสขอบเขตของ baseline
//
// ⚠️ 0 คือชุด "รวมทุกเครื่อง" ไม่ใช่รหัสเครื่องจริง (machines.id เริ่มที่ 1 เสมอ)
//    ที่ไม่ใช้ NULL เพราะ MySQL/MariaDB ถือว่า NULL แต่ละตัวไม่ซ้ำกัน UNIQUE จึงกัน
//    ชุดรวมซ้ำไม่ได้ — ดูคอมเมนต์เต็มที่ schema.sql
const AGGREGATE = 0;
const scopeOf = (filter = {}) => Number(filter.machine_id) || AGGREGATE;

// setBaseline — คำนวณแล้ว upsert ลง checkpoint_baselines ตามขอบเขตที่กรองมา
const setBaseline = async (checkpointId, filter = {}) => {
  const result = await computeBaseline(checkpointId, filter);

  // ล็อกซ้ำที่ขอบเขตเดิม = เขียนทับค่าเดิม ไม่ใช่เพิ่มแถวใหม่ (UNIQUE checkpoint_id + machine_id)
  await execute(
    `INSERT INTO checkpoint_baselines
       (checkpoint_id, machine_id, xbarbar, rbar, n, subgroups, baseline_from, baseline_to, locked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       xbarbar = VALUES(xbarbar), rbar = VALUES(rbar), n = VALUES(n),
       subgroups = VALUES(subgroups), baseline_from = VALUES(baseline_from),
       baseline_to = VALUES(baseline_to), locked_at = NOW()`,
    [
      Number(checkpointId),
      result.machineId,
      result.xbarbar,
      result.rbar,
      result.n,
      result.subgroupCount,
      toMysqlDateTime(result.from),
      toMysqlDateTime(result.to),
    ]
  );

  return result;
};

// clearBaseline — ลบชุดของขอบเขตนั้นทิ้ง กลับไปคำนวณสด (provisional)
//
// ⚠️ ลบเฉพาะขอบเขตที่สั่งเท่านั้น ล้างของ MC-01 ต้องไม่ไปแตะชุดรวมหรือชุดของ MC-02
//    ลบแถวทิ้งได้เพราะ baseline คำนวณใหม่ได้เสมอ ไม่ใช่หลักฐานการตรวจ (ต่างจาก inspections
//    ที่ใช้ voided_at แทน DELETE)
const clearBaseline = async (checkpointId, machineId = AGGREGATE) => {
  await execute(
    'DELETE FROM checkpoint_baselines WHERE checkpoint_id = ? AND machine_id = ?',
    [Number(checkpointId), Number(machineId) || AGGREGATE]
  );
};

// pickBaseline(rows, machineId) — เลือกชุดที่ตรงกับเครื่องที่กำลังดูอยู่
//
// ⚠️ ไม่มี fallback โดยตั้งใจ — เครื่องที่ยังไม่ได้ล็อก baseline ของตัวเอง ต้องได้เส้น
//    provisional ที่คำนวณสดจากข้อมูลของเครื่องนั้น ไม่ใช่ยืมลิมิตของชุดรวมมาใช้
//    ยืมเมื่อไหร่ เครื่องที่ค่ากลางเบี่ยงจากกลุ่มจะติดกฎ OCS shift 7 จุด ค้างตลอดโดยไม่มีอะไร
//    ผิดจริง แล้วคนจะเลิกเชื่อคำเตือนทั้งหมด (เส้น provisional อย่างน้อยก็บอกตัวเองว่ายังไม่ล็อก)
const pickBaseline = (rows = [], machineId = AGGREGATE) => {
  const want = Number(machineId) || AGGREGATE;
  return rows.find((r) => Number(r.machine_id) === want) ?? null;
};

// baselineOf(row) — แปลงแถวจาก checkpoint_baselines เป็นรูปที่ spcStats.computeLimits รับ
const baselineOf = (row) =>
  (row === null || row === undefined
    ? null
    : {
        xbarbar: row.xbarbar,
        rbar: row.rbar,
        n: row.n,
        machineId: Number(row.machine_id) || AGGREGATE,
        lockedAt: row.locked_at,
        subgroups: row.subgroups,
        from: row.baseline_from,
        to: row.baseline_to,
      });

module.exports = {
  AGGREGATE,
  scopeOf,
  computeBaseline,
  setBaseline,
  clearBaseline,
  pickBaseline,
  baselineOf,
  toMysqlDateTime,
};
