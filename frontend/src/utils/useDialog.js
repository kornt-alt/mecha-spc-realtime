// frontend/src/utils/useDialog.js — สเตตของกล่องยืนยัน/แจ้งเตือนในแอป
//
// แทนที่ window.confirm / window.alert / window.prompt ทั้งระบบ เหตุผลที่ต้องเลิกใช้ของเบราว์เซอร์:
//   1. หน้าตาคนละอย่างกับทั้งระบบ ตัดบรรทัดเองไม่ได้ ใส่สีเน้นอันตรายไม่ได้ —
//      ปุ่ม "ลบถาวร" หน้าตาเหมือนปุ่ม "ตกลง" เป๊ะ
//   2. Chrome มีช่อง "ไม่ต้องแสดงกล่องนี้อีก" ติ๊กแล้ว **การยืนยันครั้งต่อ ๆ ไปถูกข้ามเงียบ ๆ
//      ทั้งแท็บ** ซึ่งอันตรายมากกับปุ่มอย่าง "ล้างใบตรวจออกจาก DB จริง กู้คืนไม่ได้"
//
// ⚠️ window.confirm เป็น synchronous แต่ modal ไม่ใช่ — ของเดิมที่เขียนว่า
//    `if (!window.confirm(x)) return;` แล้วทำงานต่อบรรทัดถัดไป ต้องยกงานที่เหลือทั้งก้อน
//    ไปไว้ใน onConfirm ห้ามพยายามทำให้มันกลับมา "รอคำตอบ" ได้เหมือนเดิม
//
// ⚠️ ทั้งสาม show* ต้องคืน undefined (ปีกกาครอบ ไม่ใช่ arrow แบบ expression)
//    เพราะจุดเรียกหลายที่เขียนเป็น `return showAlert(...)` เพื่อออกจากฟังก์ชันทันที
//    แบบเดียวกับที่เคยเขียน `return window.alert(...)`
import { useCallback, useState } from 'react';

// รับสตริงเปล่า ๆ ก็ได้ — จุดที่แค่บอกข้อความสั้น ๆ จะได้ไม่ต้องห่อ object ทุกครั้ง
const asOptions = (o) => (typeof o === 'string' ? { body: o } : (o ?? {}));

/**
 * คืน { dialog, showAlert, showConfirm, showPrompt, closeDialog }
 *
 * dialog เป็น object เดียวหรือ null — ช่องเดียว ไม่ใช่คิว โดยตั้งใจ
 * ที่เดียวที่ขอกล่องใหม่จากใน onConfirm คือ InspectionList.send() ซึ่งตอนนั้นกล่องแรก
 * ปิดไปแล้ว (AppDialog ปิดก่อนเรียก onConfirm เสมอ) จึงไม่มีทางซ้อนกัน
 *
 * ฟิลด์ที่ AppDialog อ่าน:
 *   kind        'alert' | 'confirm' | 'prompt'
 *   title       หัวกล่อง
 *   body        เนื้อความ (ขึ้นบรรทัดด้วย \n ได้ AppDialog ใส่ pre-line ให้)
 *   variant     สีปุ่มยืนยัน — 'danger' ของที่กู้ไม่ได้ · 'warning' เรื่อง control limit
 *   confirmLabel / cancelLabel
 *   inputLabel / inputHint   เฉพาะ kind === 'prompt'
 *   fields                   เฉพาะ kind === 'form' — [{ name, label, type, options, required }]
 *   onConfirm   (value) => void — prompt ได้ค่าที่ trim แล้ว
 */
export const useDialog = () => {
  const [dialog, setDialog] = useState(null);

  const closeDialog = useCallback(() => setDialog(null), []);

  const showAlert = useCallback((options) => {
    setDialog({ kind: 'alert', ...asOptions(options) });
  }, []);

  // ค่าเริ่มต้นเป็น danger เพราะแทบทุกจุดที่ต้องยืนยันในระบบนี้คือของที่ลบแล้วลบเลย
  // จุดที่กลับคืนได้ (คืนค่าใบตรวจ / ล้าง baseline) ส่ง variant มาทับเอง
  const showConfirm = useCallback((options) => {
    setDialog({ kind: 'confirm', variant: 'danger', ...asOptions(options) });
  }, []);

  const showPrompt = useCallback((options) => {
    setDialog({ kind: 'prompt', variant: 'danger', ...asOptions(options) });
  }, []);

  // กล่องที่มีหลายช่อง — fields: [{ name, label, type?, options?, required?, placeholder? }]
  // onConfirm ได้ object ที่ key ตรงกับ name และค่าถูก trim แล้ว
  const showForm = useCallback((options) => {
    setDialog({ kind: 'form', variant: 'primary', confirmLabel: 'บันทึก', ...asOptions(options) });
  }, []);

  return { dialog, showAlert, showConfirm, showPrompt, showForm, closeDialog };
};

export default useDialog;
