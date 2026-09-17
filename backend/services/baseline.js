// backend/services/baseline.js — คำนวณและ freeze control limit ของจุดตรวจ
//
// ทำไมต้อง freeze: ถ้าคำนวณ UCL/LCL ใหม่จากข้อมูลทั้งหมดทุกครั้งที่เปิดกราฟ เส้นลิมิตจะ
// วิ่งตาม process ที่ค่อย ๆ drift ไปด้วย แล้วจะไม่มีวันจับความผิดปกติได้เลย — กราฟดูสวย
// ทุกวันแต่ไม่เคยเตือนอะไรสักครั้ง เป็นกับดักคลาสสิกของ SPC ที่เขียนเอง
//
// ขั้นตอนที่ถูก: เก็บข้อมูลช่วงที่ process นิ่ง 20-25 subgroup → กด Set baseline → ลิมิตถูกล็อก
// → หลังจากนั้นกราฟอ่านจากค่าที่ล็อกไว้ ไม่คำนวณสดอีก
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

// setBaseline — คำนวณแล้วเขียนลง checkpoints.baseline_* พร้อมประทับเวลาที่ล็อก
const setBaseline = async (checkpointId, filter = {}) => {
  const result = await computeBaseline(checkpointId, filter);

  await execute(
    `UPDATE checkpoints
        SET baseline_xbarbar = ?, baseline_rbar = ?, baseline_n = ?,
            baseline_subgroups = ?, baseline_from = ?, baseline_to = ?,
            baseline_locked_at = NOW()
      WHERE id = ?`,
    [
      result.xbarbar,
      result.rbar,
      result.n,
      result.subgroupCount,
      toMysqlDateTime(result.from),
      toMysqlDateTime(result.to),
      Number(checkpointId),
    ]
  );

  return result;
};

// clearBaseline — กลับไปเป็น provisional (กราฟจะคำนวณสดอีกครั้ง)
// ใช้เมื่อเปลี่ยนเครื่อง เปลี่ยนแบบ หรือแก้ sample_size แล้ว baseline เดิมใช้ไม่ได้
const clearBaseline = async (checkpointId) => {
  await execute(
    `UPDATE checkpoints
        SET baseline_xbarbar = NULL, baseline_rbar = NULL, baseline_n = NULL,
            baseline_subgroups = NULL, baseline_from = NULL, baseline_to = NULL,
            baseline_locked_at = NULL
      WHERE id = ?`,
    [Number(checkpointId)]
  );
};

// baselineOf(checkpointRow) — ดึง baseline ออกมาในรูปที่ spcStats.computeLimits รับ
const baselineOf = (checkpoint) =>
  checkpoint?.baseline_xbarbar === null || checkpoint?.baseline_xbarbar === undefined
    ? null
    : {
        xbarbar: checkpoint.baseline_xbarbar,
        rbar: checkpoint.baseline_rbar,
        n: checkpoint.baseline_n,
        lockedAt: checkpoint.baseline_locked_at,
        subgroups: checkpoint.baseline_subgroups,
        from: checkpoint.baseline_from,
        to: checkpoint.baseline_to,
      };

module.exports = { computeBaseline, setBaseline, clearBaseline, baselineOf, toMysqlDateTime };
