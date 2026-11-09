// components/table/Pager.js — แบ่งหน้าตารางรายการ (ใช้คู่กับ useDataTable)
//
//   const dt = useDataTable(rows, COLS);
//   const pg = usePager(dt.rows, dt.resetKey);          // เรียง/กรองหัวคอลัมน์แล้วกลับหน้า 1 เอง
//   {pg.rows.map(...)}                                  // แถวของหน้านี้เท่านั้น
//   <Pager pg={pg} />                                   // ใต้ตาราง — แถวน้อยกว่าหน้าเดียวไม่แสดงปุ่มหน้า
//
// ขนาดหน้าเครื่องจำไว้ (localStorage `mechaspc.pageSize` ห่อ try/catch — โหมด private throw ได้)
// ⚠️ ส่ง resetKey ที่เปลี่ยนเมื่อชุดข้อมูลเปลี่ยนความหมาย (กรอง/เรียง) — ไม่งั้นอยู่หน้า 7 ของชุดที่เหลือ 2 หน้า = ตารางว่าง
//    และ page ถูกหนีบไว้ที่หน้าสุดท้ายเสมอเป็นตาข่ายชั้นสอง (ลบแถวสุดท้ายของหน้าสุดท้ายแล้วไม่ค้างหน้าว่าง)
import React, { useEffect, useMemo, useState } from 'react';
import { Form, Pagination } from 'react-bootstrap';

export const PAGE_SIZES = [25, 50, 100];
const KEY = 'mechaspc.pageSize';

const readSize = (fallback) => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return PAGE_SIZES.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

export const usePager = (rows, resetKey, initialSize = 25) => {
  const [size, setSizeState] = useState(() => readSize(initialSize));
  const [page, setPage] = useState(1);
  const total = Array.isArray(rows) ? rows.length : 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);

  useEffect(() => { setPage(1); }, [resetKey]);

  const setSize = (n) => {
    setSizeState(n);
    setPage(1);
    try { localStorage.setItem(KEY, String(n)); } catch { /* จำไม่ได้ก็ใช้ได้ */ }
  };

  const slice = useMemo(
    () => (Array.isArray(rows) ? rows.slice((current - 1) * size, current * size) : []),
    [rows, current, size]
  );

  return { rows: slice, page: current, pages, size, total, setPage, setSize };
};

// ปุ่มหน้าแบบย่อ: 1 … 4 5 [6] 7 8 … 20
const pageList = (page, pages) => {
  const set = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2]);
  const list = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out = [];
  list.forEach((p, i) => {
    if (i > 0 && p - list[i - 1] > 1) out.push(`gap-${p}`);
    out.push(p);
  });
  return out;
};

const Pager = ({ pg, className = '' }) => {
  if (!pg || pg.total === 0) return null;
  const from = (pg.page - 1) * pg.size + 1;
  const to = Math.min(pg.total, pg.page * pg.size);
  return (
    <div className={`mc-pager ${className}`}>
      <span className="mc-pager__info num">
        {from.toLocaleString()}–{to.toLocaleString()} จาก {pg.total.toLocaleString()} แถว
      </span>
      {pg.pages > 1 && (
        <Pagination size="sm" className="mb-0">
          <Pagination.Prev disabled={pg.page === 1} onClick={() => pg.setPage(pg.page - 1)} aria-label="หน้าก่อน" />
          {pageList(pg.page, pg.pages).map((p) => (typeof p === 'string'
            ? <Pagination.Ellipsis key={p} disabled />
            : <Pagination.Item key={p} active={p === pg.page} onClick={() => pg.setPage(p)}>{p}</Pagination.Item>))}
          <Pagination.Next disabled={pg.page === pg.pages} onClick={() => pg.setPage(pg.page + 1)} aria-label="หน้าถัดไป" />
        </Pagination>
      )}
      <Form.Select
        size="sm"
        className="mc-pager__size"
        aria-label="จำนวนแถวต่อหน้า"
        value={pg.size}
        onChange={(e) => pg.setSize(Number(e.target.value))}
      >
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} แถว/หน้า</option>)}
      </Form.Select>
    </div>
  );
};

export default Pager;
