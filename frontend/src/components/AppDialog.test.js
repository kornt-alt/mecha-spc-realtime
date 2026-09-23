// เทส AppDialog + useDialog
//
// สามเรื่องที่ต้องไม่พลาด:
//   1. กดยกเลิก / Esc / กากบาท ต้องไม่เรียก onConfirm — กล่องพวกนี้คุมของที่ลบแล้วลบเลย
//   2. prompt ที่ยังไม่กรอกต้องกดยืนยันไม่ได้ (เหตุผลการยกเลิกเป็นร่องรอยเดียวที่ระบบมี)
//   3. โฟกัสเริ่มต้นอยู่ที่ปุ่มยกเลิก ไม่ใช่ปุ่มยืนยัน
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AppDialog from './AppDialog';
import { useDialog } from '../utils/useDialog';

// ใช้ของจริงทั้งคู่ — สัญญาที่ต้องล็อกคือ "hook + กล่อง" ทำงานร่วมกัน ไม่ใช่ prop ของกล่องเฉย ๆ
const Harness = ({ open }) => {
  const api = useDialog();
  return (
    <>
      <button type="button" onClick={() => open(api)}>เปิดกล่อง</button>
      <AppDialog dialog={api.dialog} onHide={api.closeDialog} />
    </>
  );
};

const openWith = (open) => {
  render(<Harness open={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'เปิดกล่อง' }));
  return screen.getByRole('dialog');
};

test('กล่องที่ยังไม่เปิด ไม่ทิ้ง node อะไรไว้ในหน้าเลย', () => {
  render(<AppDialog dialog={null} onHide={() => {}} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  // เทสของ MasterSetup ยืนยันทั้งหน้าว่าต้องไม่มี alert สักตัว — กล่องที่ปิดอยู่ต้องไม่ทำให้พัง
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
});

test('confirm: กดยืนยันแล้วเรียก onConfirm ครั้งเดียวและกล่องปิด', () => {
  const onConfirm = jest.fn();
  const d = openWith(({ showConfirm }) => showConfirm({
    title: 'ลบจุดตรวจ', body: 'แน่ใจ?', confirmLabel: 'ลบ', onConfirm,
  }));

  fireEvent.click(within(d).getByRole('button', { name: 'ลบ' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('confirm: กดยกเลิกแล้วไม่เรียก onConfirm', () => {
  const onConfirm = jest.fn();
  const d = openWith(({ showConfirm }) => showConfirm({ title: 'ลบ', onConfirm }));

  fireEvent.click(within(d).getByRole('button', { name: 'ยกเลิก' }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('confirm: กด Esc แล้วไม่เรียก onConfirm', () => {
  const onConfirm = jest.fn();
  const d = openWith(({ showConfirm }) => showConfirm({ title: 'ลบ', onConfirm }));

  fireEvent.keyDown(d, { key: 'Escape', code: 'Escape' });
  expect(onConfirm).not.toHaveBeenCalled();
});

// กด Enter รัว ๆ ต่อจากหน้าก่อนต้องไม่ไปโดนปุ่มลบ
test('confirm: โฟกัสเริ่มต้นอยู่ที่ปุ่มยกเลิก ไม่ใช่ปุ่มยืนยัน', () => {
  const d = openWith(({ showConfirm }) => showConfirm({
    title: 'ลบถาวร', confirmLabel: 'ลบ', onConfirm: jest.fn(),
  }));
  expect(within(d).getByRole('button', { name: 'ยกเลิก' })).toHaveFocus();
});

test('confirm: ตั้งชื่อปุ่มปิดเองได้ (กันชนกับปุ่มยืนยันที่ชื่อขึ้นต้นว่า "ยกเลิก")', () => {
  const d = openWith(({ showPrompt }) => showPrompt({
    title: 'ยกเลิกใบตรวจ', confirmLabel: 'ยืนยันยกเลิกใบตรวจ', cancelLabel: 'ปิด',
    inputLabel: 'เหตุผล', onConfirm: jest.fn(),
  }));
  expect(within(d).getByRole('button', { name: 'ปิด' })).toBeInTheDocument();
  expect(within(d).queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();
});

test('prompt: ช่องว่างหรือเว้นวรรคล้วน กดยืนยันไม่ได้ · พิมพ์แล้วกดได้', () => {
  const d = openWith(({ showPrompt }) => showPrompt({
    title: 'ยกเลิกใบตรวจ', inputLabel: 'เหตุผล', inputHint: 'จำเป็นต้องกรอก',
    confirmLabel: 'ยืนยัน', onConfirm: jest.fn(),
  }));
  const input = within(d).getByLabelText('เหตุผล');
  const ok = within(d).getByRole('button', { name: 'ยืนยัน' });

  expect(ok).toBeDisabled();
  fireEvent.change(input, { target: { value: '   ' } });
  expect(ok).toBeDisabled();
  fireEvent.change(input, { target: { value: 'กรอกผิด' } });
  expect(ok).toBeEnabled();
  // ปุ่มที่กดไม่ได้ต้องมีคำอธิบายเสมอ ไม่งั้นคนไม่รู้ว่าติดอะไร
  expect(within(d).getByText('จำเป็นต้องกรอก')).toBeInTheDocument();
});

test('prompt: ส่งค่าที่ตัดช่องว่างหัวท้ายแล้ว และโฟกัสอยู่ที่ช่องกรอก', () => {
  const onConfirm = jest.fn();
  const d = openWith(({ showPrompt }) => showPrompt({
    title: 'ยกเลิกใบตรวจ', inputLabel: 'เหตุผล', confirmLabel: 'ยืนยัน', onConfirm,
  }));
  const input = within(d).getByLabelText('เหตุผล');
  expect(input).toHaveFocus();

  fireEvent.change(input, { target: { value: '  ตรวจซ้ำ  ' } });
  fireEvent.click(within(d).getByRole('button', { name: 'ยืนยัน' }));
  expect(onConfirm).toHaveBeenCalledWith('ตรวจซ้ำ');
});

test('prompt: กด Enter ในช่องกรอก = กดยืนยัน', () => {
  const onConfirm = jest.fn();
  const d = openWith(({ showPrompt }) => showPrompt({
    title: 'ยกเลิกใบตรวจ', inputLabel: 'เหตุผล', onConfirm,
  }));
  const input = within(d).getByLabelText('เหตุผล');

  fireEvent.change(input, { target: { value: 'กรอกผิด' } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  expect(onConfirm).toHaveBeenCalledWith('กรอกผิด');
});

test('prompt: กด Enter ตอนยังไม่กรอก ต้องไม่ยืนยัน', () => {
  const onConfirm = jest.fn();
  const d = openWith(({ showPrompt }) => showPrompt({
    title: 'ยกเลิกใบตรวจ', inputLabel: 'เหตุผล', onConfirm,
  }));

  fireEvent.keyDown(within(d).getByLabelText('เหตุผล'), { key: 'Enter', code: 'Enter' });
  expect(onConfirm).not.toHaveBeenCalled();
});

test('alert: มีปุ่มเดียว และรับข้อความแบบสตริงเปล่า ๆ ได้', () => {
  const d = openWith(({ showAlert }) => showAlert('โหลดข้อมูลไม่สำเร็จ'));

  expect(within(d).getByText('โหลดข้อมูลไม่สำเร็จ')).toBeInTheDocument();
  expect(within(d).getAllByRole('button', { name: 'ปิด' })).toHaveLength(1);
  // กากบาทของ Modal ไม่ถูกนับเป็นปุ่ม "ปิด" — ยืนยันว่า footer ไม่มีปุ่มยืนยันโผล่มา
  expect(within(d).queryByRole('button', { name: 'ยืนยัน' })).not.toBeInTheDocument();
});

// ข้อความเดิมหลายอันคั่นด้วย \n\n ย้ายมาแล้วต้องยังขึ้นบรรทัดเหมือนเดิม
test('ข้อความที่มี \\n ยังขึ้นบรรทัดใหม่', () => {
  const d = openWith(({ showConfirm }) => showConfirm({
    title: 'ล้างใบตรวจ',
    body: 'ล้างใบตรวจที่ยกเลิกแล้ว 12 ใบ?\n\nอันนี้ลบออกจากฐานข้อมูลจริง กู้คืนไม่ได้',
    onConfirm: jest.fn(),
  }));

  expect(within(d).getByText(/กู้คืนไม่ได้/)).toHaveStyle({ whiteSpace: 'pre-line' });
});

test('variant กำหนดสีปุ่มยืนยันได้ (แดง = ของที่กู้ไม่ได้)', () => {
  const d = openWith(({ showConfirm }) => showConfirm({
    title: 'ลบ', confirmLabel: 'ลบ', onConfirm: jest.fn(),
  }));
  // ค่าเริ่มต้นของ showConfirm คือ danger เพราะเกือบทุกจุดในระบบนี้คือของที่ลบแล้วลบเลย
  expect(within(d).getByRole('button', { name: 'ลบ' })).toHaveClass('btn-danger');
});
