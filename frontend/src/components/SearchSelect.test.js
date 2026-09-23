// เทส SearchSelect — ช่องเลือกที่พิมพ์ค้นหาได้
//
// สามเรื่องที่ต้องไม่พลาด:
//   1. ค่าที่ส่งออกไปเป็น id เสมอ ไม่ใช่ข้อความบนจอ (ชื่อผู้ตรวจซ้ำกันได้)
//   2. พิมพ์ค้างแล้วออกจากช่อง ต้องกลับไปโชว์ตัวที่เลือกไว้ ไม่ใช่ทิ้งข้อความที่ไม่ตรงกับอะไรเลย
//   3. เลือกด้วยคีย์บอร์ดได้ทั้งหมด — หน้างานใช้เครื่องสแกนและคีย์บอร์ดเป็นหลัก
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SearchSelect from './SearchSelect';

const OPTIONS = [
  { value: '1', label: 'สมชาย ใจดี', hint: 'Mecha 1' },
  { value: '2', label: 'สมหญิง รักงาน', hint: 'Mecha 2' },
  { value: '3', label: 'สมชาย ใจดี', hint: 'Mecha 2' },
];

// controlled component — ต้องมี state จริงครอบ ไม่งั้นเลือกแล้วค่าไม่ขยับ
const Harness = ({ initial = '', ...props }) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="ss">ผู้ตรวจ</label>
      <SearchSelect id="ss" value={value} options={OPTIONS} onChange={setValue} {...props} />
      <span data-testid="value">{value}</span>
    </>
  );
};

const box = () => screen.getByRole('combobox', { name: 'ผู้ตรวจ' });
const valueOf = () => screen.getByTestId('value').textContent;

test('ปิดอยู่ = โชว์ชื่อของตัวที่เลือกไว้ และยังไม่มีลิสต์', () => {
  render(<Harness initial="2" />);
  expect(box()).toHaveValue('สมหญิง รักงาน');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(box()).toHaveAttribute('aria-expanded', 'false');
});

test('โฟกัสแล้วลิสต์เปิด และเห็นทุกตัวเลือก', () => {
  render(<Harness />);
  fireEvent.focus(box());
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  expect(screen.getAllByRole('option')).toHaveLength(3);
});

test('พิมพ์แล้วกรองตามชื่อ และกรองตาม hint ได้ด้วย', () => {
  render(<Harness />);
  fireEvent.focus(box());

  fireEvent.change(box(), { target: { value: 'สมหญิง' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);

  // hint คือ division — ใช้แยกคนชื่อซ้ำกัน จึงต้องค้นเจอด้วย
  fireEvent.change(box(), { target: { value: 'Mecha 2' } });
  expect(screen.getAllByRole('option')).toHaveLength(2);
});

// ชื่อซ้ำกันได้จริงในโรงงาน ถ้าส่งข้อความกลับไปจะแยกไม่ออกว่าคนไหน
test('คลิกเลือกแล้วส่งออกเป็น id ไม่ใช่ข้อความ', () => {
  render(<Harness />);
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: 'สมชาย' } });

  // สองคนชื่อเดียวกัน ต่างกันที่ division
  const opts = screen.getAllByRole('option');
  expect(opts).toHaveLength(2);
  fireEvent.mouseDown(opts[1]);

  expect(valueOf()).toBe('3');
  expect(box()).toHaveValue('สมชาย ใจดี');
});

test('เลือกด้วยคีย์บอร์ด: ลูกศรลง + Enter', () => {
  render(<Harness />);
  fireEvent.keyDown(box(), { key: 'ArrowDown' });
  fireEvent.keyDown(box(), { key: 'ArrowDown' });
  fireEvent.keyDown(box(), { key: 'Enter' });

  expect(valueOf()).toBe('2');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('Esc ปิดลิสต์โดยไม่เปลี่ยนค่า', () => {
  render(<Harness initial="1" />);
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: 'สมหญิง' } });
  fireEvent.keyDown(box(), { key: 'Escape' });

  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(valueOf()).toBe('1');
  expect(box()).toHaveValue('สมชาย ใจดี');
});

// ข้อความที่ไม่ตรงกับตัวเลือกไหนเลยแต่ยังค้างในช่อง = ช่องที่โกหกว่าเลือกอะไรไว้
test('พิมพ์ค้างแล้วคลิกที่อื่น = กลับไปโชว์ตัวที่เลือกไว้เดิม', () => {
  render(<Harness initial="1" />);
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: 'ไม่มีคนนี้' } });
  fireEvent.mouseDown(document.body);

  expect(box()).toHaveValue('สมชาย ใจดี');
  expect(valueOf()).toBe('1');
});

test('ค้นไม่เจอและไม่มีปุ่มเพิ่ม = บอกว่าไม่พบ', () => {
  render(<Harness />);
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: 'zzz' } });

  expect(screen.getByText('ไม่พบรายการที่ค้นหา')).toBeInTheDocument();
  expect(screen.queryAllByRole('option')).toHaveLength(0);
});

test('มี onAddNew: ค้นไม่เจอแล้วยังไปต่อได้ ไม่ใช่ทางตัน', () => {
  const onAddNew = jest.fn();
  render(<Harness onAddNew={onAddNew} addNewLabel="เพิ่มผู้ตรวจใหม่" />);
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: 'zzz' } });

  const add = screen.getByRole('option', { name: /เพิ่มผู้ตรวจใหม่/ });
  fireEvent.mouseDown(add);
  expect(onAddNew).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('มี onAddNew: กดจากคีย์บอร์ดได้ด้วย (อยู่ท้ายลิสต์)', () => {
  const onAddNew = jest.fn();
  render(<Harness onAddNew={onAddNew} addNewLabel="เพิ่มผู้ตรวจใหม่" />);
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: 'สมหญิง' } });

  // เหลือตัวเลือกเดียว → ลูกศรลงหนึ่งครั้งไปที่แถว "เพิ่มใหม่"
  fireEvent.keyDown(box(), { key: 'ArrowDown' });
  fireEvent.keyDown(box(), { key: 'Enter' });
  expect(onAddNew).toHaveBeenCalledTimes(1);
});

test('disabled แล้วเปิดลิสต์ไม่ได้', () => {
  render(<Harness disabled />);
  expect(box()).toBeDisabled();
  fireEvent.focus(box());
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('id ที่จำไว้ไม่มีในลิสต์แล้ว = โชว์ placeholder ไม่ใช่ค้างชื่อเก่า', () => {
  render(<Harness initial="99" placeholder="— เลือกผู้ตรวจ —" />);
  expect(box()).toHaveValue('');
  expect(box()).toHaveAttribute('placeholder', '— เลือกผู้ตรวจ —');
});
