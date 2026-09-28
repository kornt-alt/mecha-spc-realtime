// frontend/src/utils/ipbass.js — IPBASS API client (transport layer ล้วน ๆ)
//
// ⚠️ กฎเหล็ก: ห้าม import อะไรจาก utils/api.js
//    apiCall() อ่าน key `error` แล้วโยนต่อเป็น Error ของแอป · token ของ IPBASS
//    หมดอายุต้องไม่กลายเป็น error ของระบบตรวจสอบ จึงใช้ raw fetch เท่านั้น
//    (กฎเดียวกับ ENG_MECHA2 / MC_MECHA2 / mecha-ps-chemical-system)
//
// ⚠️ ทุกอย่างที่ออกจากไฟล์นี้เป็น advisory — การค้นหา MO ล้มเหลวต้องไม่ทำให้
//    บันทึกใบตรวจไม่ได้ ผู้เรียกต้องเลือก item เองต่อได้เสมอ

const IPBASS_BASE  = process.env.REACT_APP_IPBASS_BASE_URL || 'http://wbp5.bp.minebea.local/pbass_api';
const IPBASS_PLANT = process.env.REACT_APP_IPBASS_PLANT    || 'A32LB';

const TIMEOUT_MS = 15000;

// token ผูกกับทั้ง endpoint family และ dept — คนละ dept ต้องคนละใบ
const MOPLAN_TOKEN = {
  T47563: process.env.REACT_APP_IPBASS_TOKEN_MO_PLAN_MP1,
  T47183: process.env.REACT_APP_IPBASS_TOKEN_MO_PLAN_MP2,
};
// ชื่อ env var จริง ไว้ใส่ในข้อความ error ให้ผู้ใช้ไปตั้งค่าถูกใบ
const MOPLAN_TOKEN_ENV = {
  T47563: 'REACT_APP_IPBASS_TOKEN_MO_PLAN_MP1',
  T47183: 'REACT_APP_IPBASS_TOKEN_MO_PLAN_MP2',
};

/**
 * error ทุกตัวที่ออกจากไฟล์นี้เป็นชนิดนี้เสมอ
 *
 * @property {'missing-token'|'http'|'network'|'timeout'|'parse'} kind
 * @property {string}      dept     dept ที่ยิงไป เช่น 'T47183'
 * @property {number|null} status   HTTP status (null ถ้าไม่ใช่ kind 'http')
 * @property {string|null} urlPath  ⚠️ สำหรับ console.error / debug เท่านั้น **ห้ามเอาไปแสดงบน UI**
 */
export class IpbassError extends Error {
  constructor(message, { kind, dept, status = null, urlPath = null }) {
    super(message);
    this.name    = 'IpbassError';
    this.kind    = kind;
    this.dept    = dept;
    this.status  = status;
    this.urlPath = urlPath;
  }
}

/**
 * ยิง GET ไป IPBASS แล้วคืนผลเป็น array เสมอ
 *
 * envelope ของ IPBASS ไม่คงที่ — บางที `{ Data: [...] }` บางที array เปล่า บางที object เดี่ยว
 * จึง normalize ให้เหลือรูปเดียวตรงนี้ที่เดียว ผู้เรียกไม่ต้องเดา
 */
const ipbassFetch = async (urlPath, dept, token) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // ⚠️ timer ต้องครอบถึงตอนอ่าน body เสร็จ ไม่ใช่แค่ตอนได้ response header
  //    gateway ที่ตอบ header แล้วค้างตอนส่ง body จะแขวนตลอดไปถ้า clearTimeout เร็วเกินไป
  let json;
  try {
    const res = await fetch(`${IPBASS_BASE}${urlPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new IpbassError(
        `IPBASS ตอบกลับผิดพลาด (${res.status}) — ตรวจสอบ token ของ ${dept} หรือการเชื่อมต่อเครือข่าย`,
        { kind: 'http', dept, status: res.status, urlPath }
      );
    }
    try {
      json = await res.json();
    } catch (err) {
      throw new IpbassError('IPBASS ตอบกลับมาในรูปที่อ่านไม่ได้', { kind: 'parse', dept, urlPath });
    }
  } catch (err) {
    if (err instanceof IpbassError) throw err;
    if (err.name === 'AbortError') {
      throw new IpbassError(`IPBASS ไม่ตอบกลับภายใน ${TIMEOUT_MS / 1000} วินาที`, { kind: 'timeout', dept, urlPath });
    }
    // fetch โยน TypeError ทั้ง CORS, DNS, cert และเน็ตหลุด แยกจากกันไม่ได้จากฝั่ง browser
    throw new IpbassError('ติดต่อ IPBASS ไม่ได้ — ตรวจสอบว่าเครื่องนี้อยู่ในเครือข่ายภายใน', { kind: 'network', dept, urlPath });
  } finally {
    clearTimeout(timer);
  }

  if (Array.isArray(json))       return json;
  if (Array.isArray(json?.Data)) return json.Data;
  if (json?.Data)                return [json.Data];
  // object เดี่ยวที่ไม่มีคีย์ Data — ถ้าไม่ดักไว้แถวนี้จะหายเงียบ
  if (json && typeof json === 'object') return [json];
  return [];
};

// ⚠️ encode "ค่า" เท่านั้น — encodeURIComponent('*') = '%2A' ซึ่ง IPBASS ไม่ถือเป็น wildcard
//    และค่าที่มี '/' ต้องเป็น %2F ไม่งั้นกลายเป็น filter ตัวใหม่
const enc = (v) => encodeURIComponent(String(v ?? '').trim());

/**
 * แผนการผลิตของ MO หนึ่งใบ จาก dept เดียว
 * GET /MOPLAN/{PLANT}/{DEPT}/F/ALL/ALL/{MO_NO}/ALL/ALL/ALL/ALL   (MODE = F)
 *
 * ⚠️ MO อยู่ filter ตัวที่ 3 · ENG_MECHA2 กับ MC_MECHA2 ใช้เส้นเดียวกันแต่มี /ALL ท้ายแค่ 2 ตัว
 *    ถ้าเส้นนี้คืนค่าว่างทั้งที่ MO มีจริง ให้ลองตัด '/ALL/ALL' ท้ายออกก่อนไปหาสาเหตุอื่น
 */
export const fetchMoPlanByDept = (dept, moNo) => {
  const token = MOPLAN_TOKEN[dept];
  if (!token) {
    throw new IpbassError(
      `ไม่พบ IPBASS token ของ ${dept} — ตั้งค่า ${MOPLAN_TOKEN_ENV[dept] || `token ของ ${dept}`} ใน frontend/.env แล้ว restart npm start`,
      { kind: 'missing-token', dept }
    );
  }
  return ipbassFetch(`/MOPLAN/${IPBASS_PLANT}/${dept}/F/ALL/ALL/${enc(moNo)}/ALL/ALL/ALL/ALL`, dept, token);
};

/**
 * ค้นหา MO จากทุก dept พร้อมกัน — ยังไม่รู้ว่า MO อยู่ division ไหนจนกว่าจะเจอ
 *
 * @param {string}   moNo
 * @param {string[]} depts  dept ที่จะยิง (จาก divisions.ipbass_dept)
 * @returns {Promise<{rows: Array, errors: Array<{dept, message, kind}>}>}
 *   rows   = แถวจากทุก dept รวมกัน แต่ละแถวแปะ `_dept` ไว้
 *   errors = dept ที่ยิงไม่ผ่าน
 *
 * ⚠️ **ผู้เรียกต้องเช็ค errors** — `rows` ว่างแต่ `errors` ไม่ว่าง แปลว่า "เช็คไม่ได้"
 *    ไม่ใช่ "ไม่มี MO นี้" ห้ามบอกผู้ใช้ว่าไม่พบ
 *
 * ⚠️ `depts` ว่างจะคืน `{rows: [], errors: []}` ซึ่งหน้าตาเหมือน "ยิงแล้วไม่เจอ" เป๊ะ
 *    ทั้งที่ยังไม่ได้ยิงอะไรเลย — ผู้เรียกต้องดัก `depts.length === 0` ก่อนเรียกฟังก์ชันนี้
 *    (ดู MoLookupBar) จึง throw ทิ้งไว้ตรงนี้เป็นตาข่ายชั้นสอง
 */
export const fetchMoPlan = async (moNo, depts) => {
  if (!Array.isArray(depts) || depts.length === 0) {
    throw new IpbassError(
      'ยังไม่ได้ตั้ง IPBASS dept ของ Division ไหนเลย — ตั้งที่หน้า Master Setup › Division ก่อน',
      { kind: 'missing-token', dept: '-' }
    );
  }

  const settled = await Promise.allSettled(
    depts.map((dept) => Promise.resolve().then(() => fetchMoPlanByDept(dept, moNo)))
  );

  const rows = [];
  const errors = [];
  settled.forEach((r, i) => {
    const dept = depts[i];
    if (r.status === 'fulfilled') {
      r.value.forEach((row) => rows.push({ ...row, _dept: dept }));
    } else {
      const err = r.reason;
      console.error('[ipbass] MOPLAN', dept, err?.urlPath ?? '', err);
      errors.push({ dept, message: err?.message || 'เรียกไม่สำเร็จ', kind: err?.kind || 'network' });
    }
  });

  return { rows, errors };
};

/**
 * แปลงแถว MOPLAN → รูปที่หน้าใบตรวจใช้ได้เลย
 *
 * ⚠️ ใส่ default ทุก field — IPBASS **ตัดฟิลด์ที่ว่างทิ้ง ไม่ได้ส่ง null มา**
 *    และตัวเลขมาเป็น string
 *
 * ⚠️ MODEL_GROUP ยังไม่ได้ยืนยันว่ามีจริง (ไม่มีโปรเจกต์ไหนในเครือใช้อยู่)
 *    จึงเป็น display อย่างเดียว ไม่มีตรรกะไหนพึ่งพามัน
 */
export const moRowToItem = (row) => ({
  moNo:       String(row.MO_NO || '').trim(),
  itemNo:     String(row.ITEM_NO || '').trim(),
  itemName:   row.ITEM_NAME   || '',
  draw:       row.DRAW        || '',
  modelGroup: row.MODEL_GROUP || '',
  planQty:    Number(row.PLAN_QTY) || 0,
  dept:       row._dept       || '',
});
