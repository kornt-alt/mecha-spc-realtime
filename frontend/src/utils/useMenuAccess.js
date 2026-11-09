// frontend/src/utils/useMenuAccess.js — เมนูที่คนนี้ใช้ได้ (ADMIN ตั้งที่ Master › ผู้ใช้ & สิทธิ์)
//
// GET /auth/menu → { keys, guestKeys, userId } · ใช้ร่วมกันทั้งแอป (โหลดครั้งเดียว แชร์ทุก component)
// โหลดใหม่เมื่อ: login/logout (session เปลี่ยน) · socket master_updated (ADMIN แก้สิทธิ์)
//
// ⚠️ ซ่อนเมนูฝั่งหน้าเว็บเป็นแค่ความสะดวก — ตัวกั้นจริงคือ requireMenu() ฝั่ง server
// ⚠️ โหลดไม่สำเร็จ (backend ล่ม / backend รุ่นก่อนมี /auth/menu) = ใช้ค่าเริ่มต้นเดิมของระบบ
//    (หน้าใบตรวจ/กราฟเปิดได้ ไม่ต้อง login) — หน้าไลน์ต้องไม่ล็อกตัวเองเพราะเรียก endpoint นี้ไม่ได้
import { useSyncExternalStore } from 'react';
import { apiCall } from './api';
import { getSession, onSessionChange, rolesOf } from './auth';
import { on } from './socket';

export const MENU = {
  inspect: 'inspect',
  setup: 'setup',
  dashboard: 'dashboard',
  sc: 'sc',
  report: 'report',
  masterItems: 'master.items',
  masterBase: 'master.base',
  masterCategories: 'master.categories',
  masterUsers: 'master.users',
};
export const MASTER_KEYS = [MENU.masterItems, MENU.masterBase, MENU.masterCategories, MENU.masterUsers];

// ค่าเริ่มต้นเท่ากับ seed ใน schema.sql — ใช้ตอนยังโหลดไม่ได้
const PUBLIC = [MENU.inspect, MENU.dashboard, MENU.sc, MENU.report];
const fallbackFor = (session) => {
  const roles = rolesOf(session);
  const keys = [...PUBLIC];
  if (roles.some((r) => ['ADMIN', 'PD', 'QC'].includes(r))) keys.push(MENU.setup);
  if (roles.includes('ADMIN')) keys.push(...MASTER_KEYS);
  return { keys, guestKeys: PUBLIC, userId: session?.user?.id ?? null, loaded: true, fallback: true };
};

let state = { keys: [], guestKeys: [], userId: null, loaded: false };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
let reqNo = 0;

const reload = async () => {
  const my = ++reqNo;
  const session = getSession();
  try {
    const r = await apiCall('/auth/menu');
    if (my !== reqNo) return;
    state = { keys: r.keys ?? [], guestKeys: r.guestKeys ?? [], userId: r.userId ?? null, loaded: true, token: session?.token ?? null };
  } catch {
    if (my !== reqNo) return;
    state = { ...fallbackFor(session), token: session?.token ?? null };
  }
  emit();
};

let started = false;
const start = () => {
  if (started) return;
  started = true;
  reload();
  onSessionChange(() => reload());
  on('master_updated', reload); // ADMIN แก้สิทธิ์ — ฟังที่เดียว ไม่ใช่ทุก component
};

const subscribe = (fn) => { listeners.add(fn); start(); return () => listeners.delete(fn); };
const snapshot = () => state;

// { keys, guestKeys, userId, loaded, can(key|[keys]), canGuest(key|[keys]) }
const useMenuAccess = () => {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const any = (list, keys) => (Array.isArray(keys) ? keys : [keys]).some((k) => list.includes(k));
  // ผลยังเป็นของ session ก่อนหน้า (เพิ่ง login/logout) = ถือว่ายังโหลดไม่เสร็จ — เทียบ token ที่ใช้ถาม
  // (token หมดอายุ: server ตอบแบบ GUEST แต่ token ตรงกัน = เสร็จแล้ว ไม่ค้างหมุน)
  const fresh = s.loaded && s.token === (getSession()?.token ?? null);
  return {
    ...s,
    loaded: fresh,
    can: (keys) => any(s.keys, keys),
    canGuest: (keys) => any(s.guestKeys, keys),
  };
};

export default useMenuAccess;
