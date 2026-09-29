// frontend/src/components/InspectionList.js — ตารางใบตรวจ + ปุ่มยกเลิก/คืนค่า
//
// ใช้ร่วมกันสองที่: ตารางประวัติใต้ใบตรวจ (10 ใบล่าสุด) กับหน้า Report (กรองแล้ว)
// เดิม markup นี้อยู่ใน InspectionSheet ที่เดียว ดึงออกมาเพราะสองหน้าต้องใช้ตารางเดียวกัน
// และการก๊อปไปวางแปลว่าปุ่มยกเลิกจะมีสองชุดที่หลุดจากกันได้
//
// ⚠️ ตารางนี้ **โชว์ใบที่ยกเลิกแล้วด้วย** ต่างจากกราฟ/รายงานที่ตัดทิ้ง
//    ซ่อนไปเลยแปลว่ากดคืนค่าไม่ได้ และคนจะเข้าใจว่าลบจริงไปแล้วทั้งที่แถวยังอยู่
//
// ปุ่มแก้มีสองแบบ ขึ้นตาม prop ที่หน้านั้นส่งมา (ไม่ส่ง = ไม่มีปุ่ม):
//   onReplace(row) — "แก้เป็นใบใหม่" หน้าใบตรวจ ไม่ต้อง login
//   onEdit(row)    — "แก้ค่าในใบเดิม" หน้ารายงาน ต้อง login (ตัวกล่องจัดการ login เอง)
import React, { useState } from 'react';
import { apiCall } from '../utils/api';
import { useDialog } from '../utils/useDialog';
import AppDialog from './AppDialog';
import { fmtDateTime } from '../utils/dateFormat';

const fmtTime = (v) => fmtDateTime(v);

const InspectionList = ({ rows, onChanged, onReplace, onEdit, emptyText = 'ยังไม่มีใบตรวจ' }) => {
  const [busyId, setBusyId] = useState(null);
  const { dialog, showAlert, showConfirm, showPrompt, closeDialog } = useDialog();

  // ยกเลิกต้องมีเหตุผลเสมอ — ระบบนี้ไม่มี auth เลยสักเส้น จะรู้ว่าใครกดก็ไม่ได้
  // เหตุผลที่พิมพ์เองจึงเป็นร่องรอยชิ้นเดียวที่เหลืออยู่ · ปุ่มยืนยันกดไม่ได้จนกว่าจะกรอก
  // ⚠️ cancelLabel เป็น "ปิด" ไม่ใช่ "ยกเลิก" — ปุ่มยืนยันของกล่องนี้ชื่อ "ยืนยันยกเลิกใบตรวจ"
  //    สองปุ่มที่ขึ้นต้นด้วยคำเดียวกันวางติดกันคือกับดักการกดผิด
  const askVoid = (row) => showPrompt({
    title: `ยกเลิกใบตรวจ #${row.subgroup_no}`,
    body: 'แถวจะยังอยู่ในระบบแต่ถูกตัดออกจากกราฟและรายงาน คืนค่าได้ทีหลัง',
    inputLabel: 'เหตุผลที่ยกเลิก',
    inputHint: 'จำเป็นต้องกรอก — เช่น "กรอกผิด — สมชาย"',
    confirmLabel: 'ยืนยันยกเลิกใบตรวจ',
    cancelLabel: 'ปิด',
    onConfirm: (reason) => send(row, { voided: true, reason }),
  });

  // คืนค่าไม่ใช่ของที่กู้ไม่ได้ — ปุ่มยืนยันจึงไม่ใช่สีแดง
  const askRestore = (row) => showConfirm({
    title: `คืนค่าใบตรวจ #${row.subgroup_no}?`,
    body: 'ใบนี้จะกลับเข้ากราฟและรายงานตามเดิม',
    variant: 'primary',
    confirmLabel: 'คืนค่า',
    onConfirm: () => send(row, { voided: false }),
  });

  // ⚠️ catch ครอบเฉพาะ apiCall ไม่ครอบ onChanged — ไม่งั้นการโหลดใหม่ที่ล้มจะเด้งกล่อง error
  //    ทับกล่องเตือน re-baseline ที่เพิ่งขึ้นไป ทั้งที่การยกเลิกสำเร็จไปแล้ว
  const send = async (row, body) => {
    setBusyId(row.id);

    let res;
    try {
      res = await apiCall(`/inspections/${row.id}/void`, { method: 'PUT', body });
    } catch (e) {
      showAlert({ title: 'ทำรายการไม่สำเร็จ', body: e.message });
      setBusyId(null);
      return;
    }

    // ⚠️ baseline เป็นตัวเลขที่ freeze ไว้ ไม่มีอะไรคำนวณใหม่ให้
    //    ยกเลิกใบที่อยู่ในช่วงที่ล็อกไว้แล้ว เส้น control limit จะยังมาจากข้อมูลที่เพิ่งตัดออก
    if (res.staleBaselines?.length) {
      showAlert({
        title: 'ต้อง Re-baseline',
        body:
          'ใบนี้อยู่ในช่วงที่ล็อก baseline ไว้แล้ว\n\n' +
          `จุดตรวจที่กระทบ: ${res.staleBaselines.join(', ')}\n\n` +
          'เส้น control limit ของจุดพวกนี้ยังคำนวณจากข้อมูลชุดเดิมอยู่ ' +
          'ให้ไปกด Re-baseline ที่หน้าตั้งค่า Master',
      });
    }

    try {
      await onChanged?.();
    } catch (e) {
      // โหลดตารางใหม่ไม่สำเร็จไม่ใช่ความผิดของการยกเลิกที่เพิ่งสำเร็จไป — เงียบไว้แบบ loadHistory
      console.error('โหลดใหม่หลังยกเลิก/คืนค่าไม่สำเร็จ', e);
    }
    setBusyId(null);
  };

  // ⚠️ กล่องต้องถูกเรนเดอร์ทั้งสองทาง — ตารางว่างระหว่างที่กล่องเปิดอยู่ (เช่นโหลดใหม่แล้วไม่เหลือแถว)
  //    ต้องไม่ทำให้กล่องหายไปกลางคัน
  const dialogEl = <AppDialog dialog={dialog} onHide={closeDialog} />;

  if (rows.length === 0) {
    return (
      <>
        <p className="text-muted mb-0">{emptyText}</p>
        {dialogEl}
      </>
    );
  }

  return (
    <div className="sheet-wrap" style={{ maxHeight: 'none' }}>
      <table className="sheet">
        <thead>
          <tr>
            <th scope="col">เวลา</th>
            <th scope="col">MO</th>
            <th scope="col">Lot</th>
            <th scope="col">Subgroup</th>
            <th scope="col">Shift</th>
            <th scope="col">M/C</th>
            <th scope="col">ผู้ตรวจสอบ</th>
            <th scope="col">จุด NG</th>
            <th scope="col">ผล</th>
            <th scope="col">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => {
            const voided = Boolean(h.voided_at);
            return (
              <tr key={h.id} className={voided ? 'row--voided' : ''}>
                <td className="num">{fmtTime(h.inspected_at)}</td>
                <td>{h.mo_no ?? '—'}</td>
                <td>{h.lot_no ?? '—'}</td>
                <td className="num">
                  #{h.subgroup_no}
                  {Number(h.edit_count) > 0 && (
                    <span className="badge bg-light text-dark ms-1" title="ค่าในใบนี้ถูกแก้หลังบันทึก — ดูประวัติที่ปุ่มแก้ค่า">
                      แก้ไข {h.edit_count}
                    </span>
                  )}
                </td>
                <td>{h.shift}</td>
                <td>{h.machine_name ?? '—'}</td>
                <td>{h.inspector_name ?? '—'}</td>
                <td className="num">{h.ng_count ?? 0}</td>
                <td>
                  {voided ? (
                    <span className="verdict verdict--empty" title={h.voided_reason ?? ''}>ยกเลิก</span>
                  ) : (
                    <span className={`verdict ${h.overall_result === 'NG' ? 'verdict--ng' : 'verdict--ok'}`}>
                      {h.overall_result}
                    </span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className={`btn btn-sm ${voided ? 'btn-outline-primary' : 'btn-outline-danger'}`}
                    disabled={busyId === h.id}
                    onClick={() => (voided ? askRestore(h) : askVoid(h))}
                  >
                    {voided ? 'คืนค่า' : 'ยกเลิก'}
                  </button>
                  {!voided && onReplace && (
                    <button type="button" className="btn btn-sm btn-outline-secondary ms-1"
                      disabled={busyId === h.id} onClick={() => onReplace(h)}
                      title="เปิดค่าเดิมในใบตรวจ แก้แล้วบันทึกเป็นใบใหม่ ใบเดิมถูกยกเลิกให้">
                      แก้
                    </button>
                  )}
                  {!voided && onEdit && (
                    <button type="button" className="btn btn-sm btn-outline-secondary ms-1"
                      disabled={busyId === h.id} onClick={() => onEdit(h)}
                      title="แก้ค่าในใบเดิม (ต้อง login) — จุดบนกราฟอยู่ที่เดิม เก็บประวัติการแก้">
                      แก้ค่า
                    </button>
                  )}
                  {voided && h.voided_reason && (
                    <div className="small text-muted mt-1">{h.voided_reason}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {dialogEl}
    </div>
  );
};

export default InspectionList;
