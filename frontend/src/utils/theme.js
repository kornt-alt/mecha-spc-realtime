// frontend/src/utils/theme.js — โหมดสว่าง/มืด
//
// ค่าที่เลือก: 'auto' (default = ตามเครื่องผู้ใช้) | 'light' | 'dark' · เก็บใน localStorage เครื่องใครเครื่องมัน
// ผลลัพธ์คือ <html data-bs-theme="light|dark"> — bootstrap 5.3 สลับสีเอง + theme.css สลับ token --mc-*
// ⚠️ public/index.html มีสคริปต์ตัวเดียวกันใน <head> (ตั้งค่าก่อน React โหลด ไม่งั้นจอขาวแวบตอนเปิด)
//    ชื่อ key และวิธีคำนวณต้องตรงกันทั้งสองที่
import { useEffect, useSyncExternalStore } from 'react';

const KEY = 'mechaspc.theme'; // ⚠️ เปลี่ยน mechaspc ให้ไม่ชนแอปอื่นบนโดเมนเดียวกัน + ให้ตรงกับสคริปต์ใน public/index.html
export const THEME_PREFS = ['auto', 'light', 'dark'];

const mql = () => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null);

export const getThemePref = () => {
  try {
    const v = localStorage.getItem(KEY);
    return THEME_PREFS.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
};

// สลับธีมแบบสีค่อย ๆ เปลี่ยน — คลาส mc-theme-switching ใน theme.css · ปิดเมื่อเครื่องตั้งลดการเคลื่อนไหว
const withFade = (fn) => {
  const root = document.documentElement;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { fn(); return; }
  root.classList.add('mc-theme-switching');
  fn();
  window.setTimeout(() => root.classList.remove('mc-theme-switching'), 380);
};

const resolve = (pref) => (pref === 'auto' ? (mql()?.matches ? 'dark' : 'light') : pref);

export const applyTheme = (pref = getThemePref()) => {
  document.documentElement.setAttribute('data-bs-theme', resolve(pref));
};

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const setThemePref = (pref) => {
  try { localStorage.setItem(KEY, pref); } catch { /* จำไม่ได้ก็ใช้แค่รอบนี้ */ }
  withFade(() => applyTheme(pref));
  emit();
};

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ค่าที่เลือก (auto/light/dark) — ไว้แสดงบนปุ่ม
export const useThemePref = () => useSyncExternalStore(subscribe, getThemePref, () => 'auto');

// เรียกครั้งเดียวที่ App: โหมด auto แล้วผู้ใช้เปลี่ยนธีมเครื่อง (เช่น Windows สลับกลางคืน) → เปลี่ยนตามทันที
export const useFollowSystemTheme = () => {
  useEffect(() => {
    const m = mql();
    if (!m) return undefined;
    const onChange = () => { if (getThemePref() === 'auto') withFade(() => applyTheme('auto')); };
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, []);
};
