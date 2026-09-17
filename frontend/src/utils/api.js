// frontend/src/utils/api.js — ตัวเรียก API ตัวเดียวของแอป
//
// ย้ายออกมาจาก App.js เพราะ component ต้อง import จาก '../App' ซึ่งเป็นวงกลม
// และของเดิมมี logic แนบ Bearer token + เตะออกตอน 401 ที่ติดมาจากเทมเพลตอื่น
// ทั้งที่ backend นี้ไม่มี auth เลยสักเส้น — ถอดทิ้งแล้ว
import { API_ORIGIN, APP_BASE } from './config';

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

  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...rest,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await parseBody(response);
  if (!response.ok) throw new Error(messageOf(data, response.status));
  return data;
};

// apiDownload — ใช้กับ endpoint ที่ตอบเป็นไฟล์ (Excel) ไม่ใช่ JSON
// แยกจาก apiCall เพราะ apiCall บังคับ parse body เป็น JSON ใช้รับ blob ไม่ได้
export const apiDownload = async (endpoint, fallbackName = 'export.xlsx') => {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) throw new Error(messageOf(await parseBody(response), response.status));

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
