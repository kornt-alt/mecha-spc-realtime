// components/layout/Icon.js — ไอคอนเส้น (SVG inline) ที่ธีมใช้
//
// ⚠️ แอปนี้ไม่มี lucide-react / bootstrap-icons โดยตั้งใจ — เครื่อง server ไม่มีเน็ตออก ลง dependency ใหม่ยาก
//    ไฟล์ของ skill korn-ui-theme ที่ก๊อปมา (ThemeToggle / ColumnFilter / FilterBar) จึงเปลี่ยนมาใช้ตัวนี้แทน
//    เพิ่มไอคอน = เพิ่ม path ใน PATHS (เส้นแบบ lucide: viewBox 24, stroke 2)
import React from 'react';

const PATHS = {
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
  login: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5M15 12H3" /></>,
  funnel: <path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z" />,
  sortAsc: <path d="M3 6h7M3 12h11M3 18h15M18 3v12M15 6l3-3 3 3" />,
  sortDesc: <path d="M3 6h15M3 12h11M3 18h7M18 9v12M15 18l3 3 3-3" />,
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
};

const Icon = ({ name, size = 16, filled = false, className = '', title }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"
    className={`mc-icon ${className}`} aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}
  >
    {title && <title>{title}</title>}
    {PATHS[name]}
  </svg>
);

export default Icon;
