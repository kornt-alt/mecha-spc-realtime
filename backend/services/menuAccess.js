// backend/services/menuAccess.js — สิทธิ์เข้าเมนูราย role (ADMIN ตั้งเองที่ Master › ผู้ใช้ & สิทธิ์)
//
// ตาราง menu_permissions (menu_key, role, allowed) · role 'GUEST' = คนที่ไม่ได้ login
// ⚠️ รายการเมนูมีที่เดียวคือ MENUS ข้างล่าง — ค่าเริ่มต้นต้องตรงกับ seed ใน schema.sql (= พฤติกรรมก่อนมีตารางนี้)
// ⚠️ ช่องที่ล็อก (LOCKED) แก้ไม่ได้ทั้ง API และหน้าเว็บ:
//    GUEST ของ setup / master.* = ปิดเสมอ (ต้องรู้ว่าใครทำ — ผู้ตรวจของใบมาจากบัญชี / log การแก้ master)
//    ADMIN ของ master.users = เปิดเสมอ (กันล็อกตัวเองออกจนไม่มีใครแก้สิทธิ์ได้)
// ⚠️ ขอบเขต: กั้นเส้นที่ "เขียน" ของแต่ละเมนูที่ server จริง · API อ่านที่หลายหน้าใช้ร่วมกัน
//    (/charts, /reports/model/:id, /master/lookups, /master/models) ไม่ได้แยกรายเมนู — ปิดหน้าไหนได้แค่ที่หน้าจอ
'use strict';

const { query } = require('../db/pool');

const ROLES = ['GUEST', 'ADMIN', 'PD', 'QC'];

const ALL = ['GUEST', 'ADMIN', 'PD', 'QC'];
const MENUS = [
  { key: 'inspect', label: 'Inspection Record (ใบตรวจตามรอบ)', defaults: ALL },
  { key: 'setup', label: 'Set up / Last Piece', defaults: ['ADMIN', 'PD', 'QC'] },
  { key: 'dashboard', label: 'Dashboard', defaults: ALL },
  { key: 'sc', label: 'SC Chart', defaults: ALL },
  { key: 'report', label: 'รายงาน', defaults: ALL },
  { key: 'master.items', label: 'Master — Item / จุดตรวจ / baseline', defaults: ['ADMIN'] },
  { key: 'master.base', label: 'Master — Division / เครื่อง / ผู้ตรวจ / ลูกค้า', defaults: ['ADMIN'] },
  { key: 'master.categories', label: 'Master — หมวดการตรวจ', defaults: ['ADMIN'] },
  { key: 'master.users', label: 'Master — ผู้ใช้ & สิทธิ์', defaults: ['ADMIN'] },
];
const MENU_KEYS = MENUS.map((m) => m.key);

// ค่าที่ล็อก: { 'key:role': true|false }
const LOCKED = {
  'setup:GUEST': false,
  'master.items:GUEST': false,
  'master.base:GUEST': false,
  'master.categories:GUEST': false,
  'master.users:GUEST': false,
  'master.users:ADMIN': true,
};

const defaultAllowed = (key, role) => {
  const lock = LOCKED[`${key}:${role}`];
  if (lock !== undefined) return lock;
  return Boolean(MENUS.find((m) => m.key === key)?.defaults.includes(role));
};

// cache สั้น ๆ — ทุก request ที่ผ่าน requireMenu อ่านตารางนี้ · PUT ล้าง cache ทันที
const TTL_MS = 30 * 1000;
let cache = null;

const loadPermissions = async () => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const [rows] = await query('SELECT menu_key, role, allowed FROM menu_permissions');
  const map = new Map();
  for (const r of rows) map.set(`${r.menu_key}:${r.role}`, Number(r.allowed) === 1);
  cache = { at: Date.now(), map };
  return map;
};
const clearPermissionCache = () => { cache = null; };

// role นี้เข้าเมนูนี้ได้ไม่ — ล็อกชนะตาราง · ไม่มีแถว (ตารางยังไม่ seed) = ค่าเริ่มต้น
const isAllowed = (map, key, role) => {
  const lock = LOCKED[`${key}:${role}`];
  if (lock !== undefined) return lock;
  const v = map.get(`${key}:${role}`);
  return v === undefined ? defaultAllowed(key, role) : v;
};

// ผู้ใช้ (หรือ null = ไม่ได้ login) เข้าเมนูนี้ได้ไม่ — GUEST เปิด = ทุกคนเข้าได้
const userAllowed = (map, key, user) => isAllowed(map, key, 'GUEST')
  || Boolean(user?.roles?.some((r) => isAllowed(map, key, r)));

const allowedKeys = (map, user) => MENU_KEYS.filter((k) => userAllowed(map, k, user));

module.exports = {
  ROLES, MENUS, MENU_KEYS, LOCKED, defaultAllowed,
  loadPermissions, clearPermissionCache, isAllowed, userAllowed, allowedKeys,
};
