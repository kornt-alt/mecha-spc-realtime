// เทส StationBar — แถบสถานีบนหัวใบตรวจ
//
// สองเรื่องที่ต้องไม่พลาด:
//   1. เปลี่ยน item ข้าม division แล้วเครื่อง/ผู้ตรวจของ division เดิมต้องถูกล้าง
//      (ไม่งั้นใบตรวจถูกบันทึกด้วยเครื่องที่ไม่ได้อยู่สายการผลิตนั้นจริง)
//   2. ผู้ตรวจที่ยังไม่มีในระบบต้องเพิ่มได้ตรงนี้ ไม่ใช่ทางตัน — และ emp_code เป็น
//      NOT NULL + UNIQUE ใน DB จึงต้องถามด้วย ใส่แต่ชื่อบันทึกไม่ผ่าน
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import StationBar from './StationBar';

const MODELS = [
  { id: 1, item_no: 'AAB-1001-01', item_name: 'ปลอกใน', division_id: 2, division_name: 'Mecha 1' },
  { id: 2, item_no: 'AAB-2002-02', item_name: 'แกนนอก', division_id: 3, division_name: 'Mecha 2' },
];
const MACHINES = [
  { id: 10, code: 'MC-01', name: 'ไลน์ A', division_id: 2 },
  { id: 20, code: 'MC-99', name: 'ไลน์ B', division_id: 3 },
];
const INSPECTORS = [
  { id: 100, name: 'สมชาย ใจดี', emp_code: 'E001', division_id: 2 },
  { id: 200, name: 'สมหญิง รักงาน', emp_code: 'E002', division_id: 3 },
];
const DIVISIONS = [{ id: 2, name: 'Mecha 1' }, { id: 3, name: 'Mecha 2' }];

const EMPTY = { modelId: '', machineId: '', inspectorId: '', shift: '' };

const at = (station = EMPTY, props = {}) => {
  const onChange = jest.fn();
  render(
    <StationBar
      station={station}
      models={MODELS}
      machines={MACHINES}
      inspectors={INSPECTORS}
      divisions={DIVISIONS}
      onChange={onChange}
      ready={false}
      {...props}
    />
  );
  return onChange;
};

const box = (name) => screen.getByRole('combobox', { name });

test('พิมพ์ค้นหา item แล้วเลือกได้ ส่งออกเป็น id', () => {
  const onChange = at();

  fireEvent.focus(box('Item No.'));
  fireEvent.change(box('Item No.'), { target: { value: 'แกนนอก' } });
  fireEvent.mouseDown(screen.getByRole('option', { name: /AAB-2002-02/ }));

  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ modelId: '2' }));
});

// เครื่องของ Mecha 1 ไม่ได้อยู่ในสายการผลิตของ item ที่อยู่ Mecha 2
test('เปลี่ยน item ข้าม division แล้วเครื่อง/ผู้ตรวจถูกล้าง', () => {
  const onChange = at({ modelId: '1', machineId: '10', inspectorId: '100', shift: 'M' });

  fireEvent.focus(box('Item No.'));
  fireEvent.change(box('Item No.'), { target: { value: 'AAB-2002' } });
  fireEvent.mouseDown(screen.getByRole('option', { name: /AAB-2002-02/ }));

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ modelId: '2', machineId: '', inspectorId: '' })
  );
});

test('ลิสต์เครื่อง/ผู้ตรวจถูกตัดเหลือเฉพาะ division ของ item ที่เลือก', () => {
  at({ ...EMPTY, modelId: '1' });

  fireEvent.focus(box('เครื่อง'));
  // ⚠️ ต้องนับในลิสต์ของช่องนี้เท่านั้น — <option> ของช่องกะที่เป็น <select> จริง ๆ
  //    ก็มี role="option" เหมือนกัน นับทั้งหน้าจะได้ 8 ไม่ใช่ 1
  const list = within(screen.getByRole('listbox'));
  expect(list.getAllByRole('option')).toHaveLength(1);
  expect(list.getByRole('option', { name: /MC-01/ })).toBeInTheDocument();
});

// กะมี 6 ตัวจบ ยังเป็น dropdown ธรรมดา พิมพ์ค้นหาไม่ได้ช่วยอะไร
test('ช่องกะยังเป็น dropdown ธรรมดาและมีตัวเลือกว่าง', () => {
  at();
  const shift = screen.getByLabelText('กะ');
  expect(shift.tagName).toBe('SELECT');
  expect(within(shift).getByRole('option', { name: '— เลือกกะ —' })).toBeInTheDocument();
});

test('ไม่ส่ง onAddInspector มา = ไม่มีปุ่มเพิ่มผู้ตรวจ', () => {
  at(EMPTY, { onAddInspector: undefined });
  fireEvent.focus(box('ผู้ตรวจ'));
  expect(screen.queryByRole('option', { name: /เพิ่มผู้ตรวจใหม่/ })).not.toBeInTheDocument();
});

test('ค้นหาผู้ตรวจไม่เจอ → เพิ่มใหม่ได้ทันที ไม่ใช่ทางตัน', async () => {
  const onAddInspector = jest.fn().mockResolvedValue(555);
  const onChange = at({ ...EMPTY, modelId: '1' }, { onAddInspector });

  fireEvent.focus(box('ผู้ตรวจ'));
  fireEvent.change(box('ผู้ตรวจ'), { target: { value: 'สมปอง' } });
  fireEvent.mouseDown(screen.getByRole('option', { name: /เพิ่มผู้ตรวจใหม่/ }));

  const d = screen.getByRole('dialog');
  const add = within(d).getByRole('button', { name: 'เพิ่ม' });

  // emp_code กับชื่อเป็นช่องบังคับ — DB เป็น NOT NULL ทั้งคู่
  expect(add).toBeDisabled();
  fireEvent.change(within(d).getByLabelText(/รหัสพนักงาน/), { target: { value: 'E777' } });
  expect(add).toBeDisabled();
  fireEvent.change(within(d).getByLabelText(/ชื่อ/), { target: { value: '  สมปอง มาใหม่  ' } });
  expect(add).toBeEnabled();

  fireEvent.click(add);

  // division ถูกเติมจาก item ที่เลือกอยู่ และค่าที่ส่งไปถูก trim แล้ว
  await waitFor(() => expect(onAddInspector).toHaveBeenCalledWith({
    emp_code: 'E777', name: 'สมปอง มาใหม่', division_id: '2',
  }));
  // เพิ่มเสร็จต้องถูกเลือกให้เลย ไม่ใช่ให้ไปหาเองในลิสต์
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ inspectorId: '555' })
  ));
});

test('เพิ่มผู้ตรวจไม่สำเร็จ → ขึ้นกล่องบอกเหตุผลจาก server', async () => {
  const onAddInspector = jest.fn().mockRejectedValue(new Error('รหัสพนักงานนี้มีอยู่แล้ว'));
  at({ ...EMPTY, modelId: '1' }, { onAddInspector });

  fireEvent.focus(box('ผู้ตรวจ'));
  fireEvent.mouseDown(screen.getByRole('option', { name: /เพิ่มผู้ตรวจใหม่/ }));

  const d = screen.getByRole('dialog');
  fireEvent.change(within(d).getByLabelText(/รหัสพนักงาน/), { target: { value: 'E001' } });
  fireEvent.change(within(d).getByLabelText(/ชื่อ/), { target: { value: 'ซ้ำ' } });
  fireEvent.click(within(d).getByRole('button', { name: 'เพิ่ม' }));

  await waitFor(() =>
    expect(screen.getByRole('dialog')).toHaveTextContent(/รหัสพนักงานนี้มีอยู่แล้ว/));
});
