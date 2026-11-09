// frontend/src/utils/checkpointForm.js — ตัวช่วยของฟอร์มจุดตรวจที่หน้า Master Setup
//
// รวมสองเรื่องที่ไม่ใช่ UI ไว้ที่เดียวกันแบบเดียวกับ utils/station.js:
//   1. ตรรกะตรวจสเปกที่ pure ล้วน (เทสได้โดยไม่ต้อง render อะไรเลย)
//   2. การจำ "วิธีวัด" ของจุดตรวจล่าสุดไว้ใน localStorage
//
// ⚠️ อ่าน/เขียน localStorage ต้องห่อ try/catch ทั้งคู่เสมอ
//    โหมด private / นโยบายบล็อกคุกกี้ / โควตาเต็ม throw ได้ทั้งตอนอ่านและตอนเขียน
//    จำไม่ได้ก็แค่ต้องพิมพ์ใหม่ — ห้ามปล่อยให้หน้าตั้งค่าพัง

// ── หน่วย ─────────────────────────────────────────────────────────────────
//
// ⚠️ 'μ' ในไฟล์นี้คือ U+03BC (GREEK SMALL LETTER MU) ห้ามปนกับ U+00B5 (MICRO SIGN)
//    สองตัวนี้หน้าตาเหมือนกันเป๊ะแต่เป็นคนละอักขระ ถ้าปนกันเมื่อไหร่ 'μm' สองแบบจะ
//    กลายเป็นคนละหน่วยในสายตาระบบ ซึ่งคือความไม่สม่ำเสมอที่ dropdown นี้ตั้งใจกำจัด
//
// ลิสต์นี้เป็นแค่ "ตัวตั้งต้น" ไม่ใช่ข้อบังคับ — ช่องหน่วยเป็น <input list> พิมพ์เองได้เสมอ
// เพราะ checkpoints.unit เป็น VARCHAR free text มาแต่ไหนแต่ไร บังคับเลือกเมื่อไหร่
// จุดตรวจเก่าที่หน่วยไม่ตรงลิสต์จะโดนเขียนทับด้วยค่าว่างตอนกดบันทึกแก้อย่างอื่น
export const UNIT_OPTIONS = ['mm', 'μm'];

// รวมลิสต์ตัวเลือกจากหลายแหล่งให้เหลือชุดเดียว — ตัดช่องว่างหัวท้าย ทิ้งค่าว่าง
// ตัดตัวซ้ำแบบไม่สนตัวพิมพ์ (mm กับ MM คือหน่วยเดียวกัน) แต่**เก็บการสะกดที่เจอก่อน**
// และคงลำดับที่ส่งเข้ามา ตัวตั้งต้นจึงอยู่บนสุดเสมอ
export const mergeOptions = (...lists) => {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const v = String(raw ?? '').trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
};

// ── ตรวจสเปกก่อนบันทึก ────────────────────────────────────────────────────
//
// คืน { blocking, warnings }
//   blocking = string เดียวหรือ null — เรื่องที่ห้ามบันทึกผ่าน
//   warnings = array of string — เรื่องที่น่าสงสัยแต่บันทึกได้
//
// ⚠️ สเปกด้านเดียว (กรอกแค่ USL หรือแค่ LSL) **ไม่ใช่ข้อผิดพลาด**
//    เป็นรูปที่ระบบรองรับมาตลอด SpecValue.js วาดเป็น "≤ U" / "≥ L" อยู่แล้ว
//    เตือนเมื่อไหร่คนจะเลิกอ่านคำเตือนทั้งหมด
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const specIssues = ({ char_type: charType, lsl, usl } = {}) => {
  // จุด attribute ไม่มีค่าตัวเลขเลย (submitCp ส่ง null ทั้งหมด) ไม่มีอะไรให้ตรวจ
  if (charType === 'attribute') return { blocking: null, warnings: [] };

  const L = num(lsl);
  const U = num(usl);
  const warnings = [];

  if (L !== null && U !== null) {
    if (L > U) {
      return {
        blocking: 'LSL มากกว่า USL — สลับกันหรือเปล่า? บันทึกแบบนี้แล้วทุกชิ้นที่วัดจะเป็น NG',
        warnings,
      };
    }
    if (L === U) {
      warnings.push('LSL เท่ากับ USL — มีค่าเดียวเท่านั้นที่ผ่าน วัดจริงแทบไม่มีทางได้ OK');
    }
  }

  // ⚠️ **ไม่เตือนเมื่อ target อยู่นอกช่วง LSL~USL** เคยเตือน แล้วเอาออกโดยตั้งใจ
  //    แบบที่พิกัดเป็นทิศเดียวกัน (0.24 -0.01 -0.02 → 0.22 ~ 0.23) ค่ากลางอยู่นอกช่วง
  //    **โดยโครงสร้าง** ไม่ใช่ความผิดพลาด — งานเพลา/รูเขียนแบบนี้เป็นปกติ คำเตือนเดิมจึงยิงใส่
  //    แบบที่ถูกต้องทุกใบ ซึ่งคือวิธีสอนให้คนเลิกอ่านคำเตือนทั้งหมด (เหตุผลเดียวกับสเปกด้านเดียว)
  //    และ target ไม่ถูกใช้ตัดสินอะไรเลย — judge() ไม่อ่าน ไม่มี target_used ไม่อยู่ใน Excel
  return { blocking: null, warnings };
};

// ── แปลงระหว่าง "ค่ากลาง + พิกัด" กับ LSL/Target/USL ───────────────────────
//
// แบบ (drawing) เขียนสเปกเป็นค่ากลางกับพิกัด ไม่ใช่เลขสัมบูรณ์ — 1.23 +0.5 -0.6
// หรืองานเพลาที่พิกัดติดลบทั้งคู่อย่าง 10 -0.005 -0.015 · ให้คนตั้ง master พิมพ์ตามแบบ
// ได้ตรง ๆ แทนที่จะต้องบวกลบในหัวก่อน (บวกผิดครั้งเดียว = ใบตรวจทุกใบหลังจากนั้น
// ตัดสินด้วยสเปกผิด และ usl_used/lsl_used ถูก snapshot ไปแล้ว แก้ย้อนหลังไม่ได้)
//
// ⚠️ สิ่งที่บันทึกลง DB ยังเป็น LSL/Target/USL สัมบูรณ์ชุดเดิมเสมอ พิกัดเป็นแค่ "วิธีพิมพ์"
//    ไม่มีคอลัมน์ไหนเก็บรูปที่พิมพ์มา
//
// ⚠️ **เคารพเครื่องหมายที่พิมพ์เสมอ** ไม่มีเครื่องหมายถึงจะเดาให้ และเดาคนละทางตามช่อง:
//    ช่องบนเปล่า ๆ = ขึ้น · ช่องล่างเปล่า ๆ = **ลง** เพราะคนอ่านมาจากแบบที่เขียน -0.6
//    แล้วมักพิมพ์แต่ตัวเลข · อยากได้ LSL เหนือค่ากลางจริง ๆ ให้พิมพ์ + นำหน้า
//    (ตาข่ายกันพลาดคือ preview ที่โชว์ผลจริง กับกฎ LSL > USL ใน specIssues ข้างบน)

// ตรงกับ DECIMAL(12,4) ของคอลัมน์ usl/lsl/target — และกัน float noise ไปในตัว
// (1.23 + 0.5 ใน JS ได้ 1.7300000000000002)
const DP = 4;

// ปัดแล้วตัดศูนย์ท้ายทิ้ง คืนเป็น "สตริง" เพราะปลายทางคือ cpForm ที่เก็บค่าดิบจาก DOM
// เป็นสตริงทั้งหมด แล้ว submitCp แปลงด้วย numOrNull() ทีเดียวตอนบันทึก
const fixed = (n) => String(Number(n.toFixed(DP)));

// พิกัดต้องมีเครื่องหมายเสมอตอนแสดงกลับ ไม่งั้นอ่านไม่ออกว่าเป็นพิกัดหรือค่าสัมบูรณ์
// (หลักเดียวกับ signed() ใน SpecValue.js) · ศูนย์ไม่ใส่เครื่องหมาย เพราะ '±0' พิมพ์กลับเข้ามาไม่ได้
const withSign = (d) => {
  const r = Number(d.toFixed(DP));
  if (r === 0) return '0';
  return `${r > 0 ? '+' : '-'}${Math.abs(r)}`;
};

// คืน null เมื่อยังไม่เป็นตัวเลข ('' หรือพิมพ์ค้างอยู่อย่าง '-' / '+')
// explicit = ผู้ใช้พิมพ์เครื่องหมายมาเอง
const parseTol = (raw) => {
  // ขีดยาวติดมาเวลาก๊อปจากไฟล์แบบ — แปลงเป็นลบธรรมดาก่อน ไม่งั้น Number() ได้ NaN
  const s = String(raw ?? '').trim().replace(/[\u2212\u2013\u2014]/g, '-');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return { n, explicit: s[0] === '+' || s[0] === '-' };
};

const deviation = (parsed, bareMeansDown) => {
  if (parsed === null) return null;
  return !parsed.explicit && bareMeansDown ? -parsed.n : parsed.n;
};

/**
 * ค่ากลาง + พิกัด → { lsl, target, usl } เป็นสตริงพร้อมยัดลง cpForm
 * ค่ากลางยังไม่เป็นตัวเลข = ยังคำนวณอะไรไม่ได้ คืนว่างทั้งชุด
 * พิกัดด้านไหนว่าง ลิมิตด้านนั้นว่าง (คุมด้านเดียว เป็นรูปที่ระบบรองรับมาตลอด)
 */
export const limitsFromTolerance = ({ nominal, tolUpper, tolLower } = {}) => {
  const base = num(nominal);
  if (base === null) return { lsl: '', target: '', usl: '' };

  const up = deviation(parseTol(tolUpper), false);
  const lo = deviation(parseTol(tolLower), true);

  return {
    lsl: lo === null ? '' : fixed(base + lo),
    target: fixed(base),
    usl: up === null ? '' : fixed(base + up),
  };
};

/**
 * ทางกลับ ใช้ตอนสลับจากโหมด LSL/Target/USL มาเป็นโหมดพิกัด ค่าที่กรอกไว้จะได้ไม่หาย
 *
 * ⚠️ ไม่มี target และมีลิมิตด้านเดียว → คืนว่าง ให้คนพิมพ์ค่ากลางเอง
 *    เดาไม่ได้ และเดาผิดแปลว่าเขียน target ที่ไม่เคยมีลง DB เงียบ ๆ
 *    (มีลิมิตสองด้านถึงจะใช้กึ่งกลางแทนได้ ซึ่งยังโชว์ให้เห็นบน preview ก่อนกดบันทึกอยู่ดี)
 */
export const toleranceFromLimits = ({ lsl, target, usl } = {}) => {
  const L = num(lsl);
  const U = num(usl);
  const T = num(target);

  const base = T !== null ? T : (L !== null && U !== null ? (L + U) / 2 : null);
  if (base === null) return { nominal: '', tolUpper: '', tolLower: '' };

  return {
    nominal: fixed(base),
    tolUpper: U === null ? '' : withSign(U - base),
    tolLower: L === null ? '' : withSign(L - base),
  };
};

// ── จำวิธีวัดล่าสุด ────────────────────────────────────────────────────────
//
// จุดตรวจในแบบเดียวกันมักใช้เครื่องมือวัดตัวเดิมกันทั้งใบ (ไมโครมิเตอร์ตัวเดียว 15 จุด)
// พิมพ์ใหม่ทุกแถวนอกจากเสียเวลาแล้วยังทำให้สะกดไม่ตรงกันจนกลายเป็นคนละเครื่องมือ
//
// คนละก้อนกับ 'spc.station' — นั่นเป็นของหน้าใบตรวจ อันนี้เป็นของหน้าตั้งค่า
const KEY = 'spc.cpMaster';

// จำนวนเครื่องมือวัดที่เก็บไว้ให้เลือก — มากกว่านี้ลิสต์จะยาวจนเลือกช้ากว่าพิมพ์เอง
const MAX_GAUGES = 12;

const EMPTY = { gauge: '', unit: '', sampleSize: 1, gauges: [] };

const text = (v) => String(v ?? '').trim();

// ⚠️ คืน sampleSize (camelCase) แต่ rememberCp() รับ sample_size (snake_case) โดยตั้งใจ
//    rememberCp รับ cpForm ทั้งก้อนซึ่ง key ตรงชื่อคอลัมน์ DB เป๊ะ ส่วนค่าที่คืนตรงนี้
//    เป็นรูปของที่เก็บใน localStorage ซึ่งไม่ใช่แถวใน DB — ไม่ใช่การพิมพ์ผิด
export const readCpMemory = () => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };

    const n = Number(parsed.sampleSize);
    return {
      gauge: text(parsed.gauge),
      unit: text(parsed.unit),
      // sample_size มี CHECK (1..10) ที่ฝั่ง DB — ค่านอกช่วงที่หลุดมาต้องไม่ถูกเติมลงฟอร์ม
      sampleSize: Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1,
      gauges: Array.isArray(parsed.gauges) ? mergeOptions(parsed.gauges).slice(0, MAX_GAUGES) : [],
    };
  } catch {
    // JSON เสีย หรืออ่าน storage ไม่ได้ — เริ่มใหม่เงียบ ๆ
    return { ...EMPTY };
  }
};

// เรียกหลังบันทึกจุดตรวจสำเร็จเท่านั้น — สิ่งที่ยังพิมพ์ค้างอยู่ยังไม่ใช่ของที่ควรจำ
export const rememberCp = ({ gauge, unit, sample_size: sampleSize } = {}) => {
  try {
    const prev = readCpMemory();
    const g = text(gauge);
    const n = Number(sampleSize);
    window.localStorage.setItem(KEY, JSON.stringify({
      gauge: g,
      unit: text(unit),
      sampleSize: Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1,
      // ตัวล่าสุดขึ้นหน้าสุด mergeOptions ตัดตัวซ้ำให้แล้ว
      gauges: mergeOptions([g], prev.gauges).slice(0, MAX_GAUGES),
    }));
  } catch {
    // เขียนไม่ได้ก็ไม่เป็นไร แค่ต้องพิมพ์เองรอบหน้า
  }
};

export const clearCpMemory = () => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ไม่มีอะไรให้ทำต่อ */
  }
};

// ── จุดของหมวดการตรวจ ─────────────────────────────────────────────────────
//
// จุดนี้อยู่ในใบตรวจตามรอบ (Inspection Record) ไหม — checkpoints.in_routine
// ไม่มีค่า (backend รุ่นก่อนมีคอลัมน์นี้) = อยู่ ตามค่าเริ่มของคอลัมน์
// ⚠️ ฝั่ง server มีกฎเดียวกันที่ fetchModelCheckpoints({ routineOnly / category }) ใน backend/db/queries.js
export const ROUTINE_CATEGORY_ID = 1;
export const isRoutinePoint = (cp) => cp?.in_routine === undefined || cp?.in_routine === null
  || Number(cp.in_routine) === 1;

// จุดของหมวด: ตามรอบ → in_routine · หมวดอื่น → มีการตั้งใน category_settings (PD หรือ QC)
export const pointsForCategory = (checkpoints, categoryId) => {
  const cat = Number(categoryId) || ROUTINE_CATEGORY_ID;
  if (cat === ROUTINE_CATEGORY_ID) return checkpoints.filter(isRoutinePoint);
  return checkpoints.filter((c) => (c.category_settings ?? []).some((s) => Number(s.category_id) === cat));
};
