// components/layout/ThemeToggle.js — ปุ่มสลับโหมดในแถบบนของ header: อัตโนมัติ → สว่าง → มืด → อัตโนมัติ
// ค่าเริ่มต้นคือ "อัตโนมัติ" (ตามเครื่องผู้ใช้) · logic อยู่ใน utils/theme.js
import React from 'react';
import Icon from './Icon';
import { setThemePref, useThemePref } from '../../utils/theme';

const NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
const VIEW = {
  auto: { icon: 'monitor', label: 'อัตโนมัติ' },
  light: { icon: 'sun', label: 'สว่าง' },
  dark: { icon: 'moon', label: 'มืด' },
};

const ThemeToggle = () => {
  const pref = useThemePref();
  const { icon, label } = VIEW[pref];
  return (
    <button
      type="button"
      onClick={() => setThemePref(NEXT[pref])}
      title={`ธีม: ${label} — กดเพื่อเปลี่ยนเป็น${VIEW[NEXT[pref]].label}`}
      aria-label={`ธีม: ${label}`}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  );
};

export default ThemeToggle;
