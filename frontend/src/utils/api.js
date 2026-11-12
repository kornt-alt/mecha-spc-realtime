// frontend/src/utils/api.js — ตัวเรียก API ตัวเดียวของแอป
//
// ย้ายออกมาจาก App.js เพราะ component ต้อง import จาก '../App' ซึ่งเป็นวงกลม
//
// แนบ Bearer token เมื่อ login หน้า Master อยู่ (utils/auth.js) — backend กั้นเฉพาะเส้นที่แก้ master
//
// ⚠️ 401 = ล้าง session อย่างเดียว **ห้าม redirect / เตะออกจากหน้า** (ของเดิมติดมาจากเทมเพลตอื่น
//    แล้วถอดทิ้งไปรอบหนึ่งแล้ว) · หน้าที่เหลือไม่ต้อง login เลย และ <RequireLogin> ของหน้า Master
//    จะเปิดกล่อง login ทับให้เองโดยไม่ทำฟอร์มที่กรอกค้างหาย
// ⚠️ IPBASS ยังยิง raw fetch ไม่ผ่านไฟล์นี้ — token IPBASS หมดอายุต้องไม่ไปล้าง session ตรงนี้
import { API_ORIGIN, APP_BASE } from './config';
import { clearSession, getToken } from './auth';

export const API_BASE = `${API_ORIGIN}${APP_BASE}/api`;

const parseBody = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

// backend ตอบ error มาในรูป { error: "..." } เสมอ (errorHandler.js)
// ถ้าอ่านผิด key จะได้ "[object Object]" แทนข้อความจริง — เคยเป็นบั๊กมาแล้ว
const messageOf = (data, status) =>
  data?.error || data?.message || (typeof data === 'string' && data ? data : `คำขอล้มเหลว (${status})`);

export const apiCall = async (endpoint, options = {}) => {
  const { body, ...rest } = options;
  const token = getToken();

  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...rest,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await parseBody(response);
  if (!response.ok) {
    if (response.status === 401) clearSession();
    const err = new Error(messageOf(data, response.status));
    err.status = response.status;
    throw err;
  }
  return data;
};

// apiDownload — ใช้กับ endpoint ที่ตอบเป็นไฟล์ (Excel) ไม่ใช่ JSON
// แยกจาก apiCall เพราะ apiCall บังคับ parse body เป็น JSON ใช้รับ blob ไม่ได้
// ⚠️ แนบ Bearer ด้วย — เส้นที่กั้นด้วย requireMenu (เช่นแม่แบบจุดตรวจ หรือ Excel ตอน ADMIN ปิด GUEST ของรายงาน) ต้องรู้ว่าใครขอ
// options = { method: 'POST', body } — body ส่งเป็น JSON (ดาวน์โหลด master ตามแถวที่กรอง: POST /master/export)
export const apiDownload = async (endpoint, fallbackName = 'export.xlsx', { method = 'GET', body } = {}) => {
  const token = getToken();
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401) clearSession();
    throw new Error(messageOf(await parseBody(response), response.status));
  }

  // ชื่อไฟล์เป็นภาษาไทยได้ — server ส่งมาในรูป filename*=UTF-8''...
  const disposition = response.headers.get('Content-Disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const plain = /filename="([^"]+)"/i.exec(disposition);
  const name = encoded ? decodeURIComponent(encoded[1]) : plain ? plain[1] : fallbackName;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// apiUpload — ส่งไฟล์ดิบ (File/Blob) เป็น body ตรง ๆ แล้วรับ JSON กลับ · กติกา token/401 เดียวกับ apiCall
export const apiUpload = async (endpoint, file) => {
  const token = getToken();
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  const data = await parseBody(response);
  if (!response.ok) {
    if (response.status === 401) clearSession();
    const err = new Error(messageOf(data, response.status));
    err.status = response.status;
    throw err;
  }
  return data;
};
