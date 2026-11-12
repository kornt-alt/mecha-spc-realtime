// frontend/src/utils/auth.js — session ของการ login หน้า Master
//
// ขอบเขต: login มีไว้สำหรับหน้า Master เท่านั้น หน้าอื่นไม่เช็คอะไรเลย (หน้าไลน์ห้ามติด login)
// token ถูกแนบไปกับทุก request ที่ผ่าน apiCall เมื่อมี session — backend สนใจเฉพาะเส้นที่แก้ master
//
// ⚠️ อ่านและเขียน localStorage ห่อ try/catch ทั้งคู่ (กฎเดียวกับ utils/station.js) —
//    โหมด private / นโยบายบล็อกคุกกี้ throw ได้ ต้องแปลว่า "ยังไม่ได้ login" ไม่ใช่หน้าขาว
const KEY = 'spc.auth';
const listeners = new Set();

// อ่าน exp จาก payload ของ token (ส่วนแรกก่อนจุด) — แค่ไว้ไม่ต้องยิง request ที่รู้อยู่แล้วว่าไม่ผ่าน
// ตัวตัดสินจริงคือ server (services/auth.js) ไม่ใช่ตรงนี้
const expOf = (token) => {
  try {
    const head = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(head)).exp ?? null;
  } catch {
    return null;
  }
};

export const getSession = () => {
  let s;
  try {
    s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
  if (!s?.token) return null;
  const exp = expOf(s.token);
  if (typeof exp !== 'number' || exp * 1000 <= Date.now()) return null;
  return s;
};

export const getToken = () => getSession()?.token ?? null;

const notify = () => listeners.forEach((fn) => fn(getSession()));

export const setSession = (session) => {
  try { localStorage.setItem(KEY, JSON.stringify(session)); } catch { /* จำไม่ได้ก็ใช้ต่อในแท็บนี้ไม่ได้ ต้อง login ใหม่ */ }
  notify();
};

export const clearSession = () => {
  try { localStorage.removeItem(KEY); } catch { /* ไม่มีอะไรให้ลบ */ }
  notify();
};

// ออกจากระบบโดยตั้งใจ (ปุ่มบน header) — ต่างจาก session หมดอายุ/401 ที่ต้องเปิดกล่อง login ทับหน้า
// (ฟอร์มที่กรอกค้างต้องไม่หาย) · RequireLogin ฟัง event นี้แล้วกลับไปหน้า login เต็มแทน
export const LOGOUT_EVENT = 'spc:logout';
export const logout = () => {
  try { window.dispatchEvent(new Event(LOGOUT_EVENT)); } catch { /* เบราว์เซอร์เก่า — ได้กล่องทับแทน */ }
  clearSession();
};

// คืนฟังก์ชัน cleanup ใส่ใน useEffect ได้ตรง ๆ (แพตเทิร์นเดียวกับ on() ของ utils/socket.js)
export const onSessionChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// role ของ session (ADMIN / PD / QC) — ใช้ซ่อน/โชว์ของบนจอเท่านั้น ตัวกั้นจริงคือ requireRole ฝั่ง backend
// session เก่าที่ login ก่อนมี role ไม่มี roles → ถือว่าไม่มีสิทธิ์อะไร (RequireLogin เรียก /auth/me เติมให้)
export const rolesOf = (session) => (Array.isArray(session?.user?.roles) ? session.user.roles : []);
// ⚠️ ADMIN ผ่านทุก role (ADMIN ตรวจได้ทั้ง PD และ QC) — ตัวเดียวกับ userHasRole ฝั่ง backend
export const hasRole = (session, ...roles) => {
  const mine = rolesOf(session);
  return mine.includes('ADMIN') || mine.some((r) => roles.includes(r));
};
