// เทสกฎที่อันตรายที่สุดของฟีเจอร์นี้ — mock utils/ipbass ทิ้งไปเลย
// จะได้ทดสอบได้โดยไม่ต้องมี token และไม่ต้องอยู่ในเครือข่ายภายใน
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MoLookupBar from './MoLookupBar';
import { fetchMoPlan, IpbassError } from '../utils/ipbass';

jest.mock('../utils/ipbass', () => {
  class IpbassError extends Error {
    constructor(message, { kind }) { super(message); this.kind = kind; }
  }
  return {
    __esModule: true,
    IpbassError,
    fetchMoPlan: jest.fn(),
    // ของจริงเป็น pure function ใช้ตัวจริงได้เลย ไม่ต้อง mock
    moRowToItem: (row) => ({
      moNo: row.MO_NO || '', itemNo: row.ITEM_NO || '', itemName: row.ITEM_NAME || '',
      draw: row.DRAW || '', modelGroup: row.MODEL_GROUP || '', planQty: 0, dept: row._dept || '',
    }),
  };
});

const DIVISIONS = [
  { id: 2, name: 'Mecha 1', ipbass_dept: 'T47563' },
  { id: 3, name: 'Mecha 2', ipbass_dept: 'T47183' },
];
const MODELS = [
  { id: 4, division_id: 3, item_no: 'AAB-1001-01', item_name: 'Shaft', division_name: 'Mecha 2', drawing_no: 'DWG-1001' },
  { id: 9, division_id: 3, item_no: 'AAB-9999', item_name: 'Other', division_name: 'Mecha 2', drawing_no: 'DWG-9999' },
];
const ROW = { MO_NO: 'MO1', ITEM_NO: 'AAB-1001-01', ITEM_NAME: 'Shaft', DRAW: 'DWG-1001', _dept: 'T47183' };

// ห่อด้วย state จริง เพราะ component คุม moNo แบบ controlled
// MemoryRouter จำเป็น — ปุ่ม "ไปตั้งค่า master" เป็น <Link>
const Harness = ({ divisions = DIVISIONS, currentModelId = '', onPickModel = jest.fn(), onInfoChange = jest.fn() }) => {
  const [mo, setMo] = useState('');
  return (
    <MemoryRouter>
      <MoLookupBar
        moNo={mo} onMoNoChange={setMo} divisions={divisions} models={MODELS}
        currentModelId={currentModelId} onPickModel={onPickModel} onInfoChange={onInfoChange}
      />
    </MemoryRouter>
  );
};

const scan = (value) => {
  const input = screen.getByPlaceholderText(/สแกน\/พิมพ์ MO/);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

beforeEach(() => jest.clearAllMocks());

test('ยังไม่ได้เลือก item → เติมให้เอง', async () => {
  fetchMoPlan.mockResolvedValue({ rows: [ROW], errors: [] });
  const onPickModel = jest.fn();
  render(<Harness onPickModel={onPickModel} />);
  scan('MO1');

  await waitFor(() => expect(onPickModel).toHaveBeenCalledWith(expect.objectContaining({ id: 4 })));
  expect(await screen.findByText(/ตั้งเป็น AAB-1001-01/)).toBeInTheDocument();
});

// ⚠️ กฎที่สำคัญที่สุดของไฟล์นี้ — สลับเองแล้วค่าที่กรอกไว้ทั้งใบหายหมด
test('เลือก item ไว้แล้วแต่ MO ไม่ตรง → ห้ามสลับเอง ต้องกดยืนยันก่อน', async () => {
  fetchMoPlan.mockResolvedValue({ rows: [ROW], errors: [] });
  const onPickModel = jest.fn();
  render(<Harness currentModelId="9" onPickModel={onPickModel} />);
  scan('MO1');

  expect(await screen.findByText(/ไม่ตรงกับ item ที่เลือกไว้/)).toBeInTheDocument();
  expect(onPickModel).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /เปลี่ยนเป็น AAB-1001-01/ }));
  expect(onPickModel).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
});

test('MO ตรงกับ item ที่เลือกอยู่แล้ว → ไม่ทำอะไร', async () => {
  fetchMoPlan.mockResolvedValue({ rows: [ROW], errors: [] });
  const onPickModel = jest.fn();
  render(<Harness currentModelId="4" onPickModel={onPickModel} />);
  scan('MO1');

  expect(await screen.findByText(/ตรงกับ item ที่เลือกไว้/)).toBeInTheDocument();
  expect(onPickModel).not.toHaveBeenCalled();
});

// ⚠️ สามเคสนี้ห้ามยุบรวมกัน ผู้ใช้ต้องทำคนละอย่าง
test('ยิงผ่านแต่ไม่มี MO นี้ → "ไม่พบ" (errors ว่าง)', async () => {
  fetchMoPlan.mockResolvedValue({ rows: [], errors: [] });
  render(<Harness />);
  scan('MO-MUA');
  expect(await screen.findByText(/ไม่พบ MO MO-MUA/)).toBeInTheDocument();
});

test('ยิงไม่ผ่าน → "ตรวจสอบไม่ได้" ห้ามบอกว่าไม่พบ', async () => {
  fetchMoPlan.mockResolvedValue({ rows: [], errors: [{ dept: 'T47183', message: 'x', kind: 'network' }] });
  render(<Harness />);
  scan('MO1');
  expect(await screen.findByText(/ตรวจสอบ MO กับ IPBASS ไม่ได้/)).toBeInTheDocument();
  expect(screen.queryByText(/ไม่พบ MO/)).not.toBeInTheDocument();
});

test('ยังไม่ได้ตั้ง ipbass_dept → ไม่ยิงเลย และขึ้นข้อความของตัวเอง', async () => {
  render(<Harness divisions={[{ id: 2, name: 'Mecha 1' }]} />);
  scan('MO1');
  expect(await screen.findByText(/ยังไม่ได้ตั้ง IPBASS dept/)).toBeInTheDocument();
  expect(fetchMoPlan).not.toHaveBeenCalled();
  expect(screen.queryByText(/ไม่พบ MO/)).not.toBeInTheDocument();
});

test('token หาย → ขึ้นข้อความบอกว่าต้องตั้ง env ตัวไหน', async () => {
  fetchMoPlan.mockRejectedValue(new IpbassError('ไม่พบ IPBASS token ของ T47183 — ตั้งค่า REACT_APP_X', { kind: 'missing-token' }));
  render(<Harness />);
  scan('MO1');
  expect(await screen.findByText(/REACT_APP_X/)).toBeInTheDocument();
});

// ผลค้นหาผูกกับ MO ตัวที่ค้นไป ติดไปกับใบถัดไปไม่ได้ เพราะมันจะกลายเป็นหลักฐานที่ผิด
test('แก้ MO แล้วผลค้นหาเดิมต้องหายทันที', async () => {
  fetchMoPlan.mockResolvedValue({ rows: [ROW], errors: [] });
  const onInfoChange = jest.fn();
  render(<Harness onInfoChange={onInfoChange} />);
  scan('MO1');
  await screen.findByText(/ตั้งเป็น AAB-1001-01/);

  fireEvent.change(screen.getByPlaceholderText(/สแกน\/พิมพ์ MO/), { target: { value: 'MO2' } });
  await waitFor(() => expect(screen.queryByText(/ตั้งเป็น AAB-1001-01/)).not.toBeInTheDocument());
  expect(onInfoChange).toHaveBeenLastCalledWith(null);
});

// IPBASS บอกครบแล้วว่าเป็น item อะไร ปล่อยให้คนไปพิมพ์ใหม่เอง = เปิดช่องให้พิมพ์ผิด
// ตรงคีย์ที่ใช้จับคู่ MO พอดี ต้องหิ้วของไปให้ถึงหน้า Master
test('ไม่มี item นี้ในระบบ → ชวนไปตั้ง master พร้อมหิ้วข้อมูลจาก IPBASS ไปให้', async () => {
  fetchMoPlan.mockResolvedValue({
    rows: [{ ...ROW, ITEM_NO: 'AAB-NEW/1', ITEM_NAME: 'ของใหม่', DRAW: 'DWG-NEW' }],
    errors: [],
  });
  const onPickModel = jest.fn();
  render(<Harness onPickModel={onPickModel} />);
  scan('MO1');

  expect(await screen.findByText(/ต้องการตั้งค่า master ไหมจ๊ะ/)).toBeInTheDocument();
  expect(onPickModel).not.toHaveBeenCalled();

  const link = screen.getByRole('link', { name: /ไปตั้งค่า master/ });
  const url = new URL(link.getAttribute('href'), 'http://x');
  expect(url.pathname).toBe('/master');
  expect(url.searchParams.get('item_no')).toBe('AAB-NEW/1');   // '/' ต้องรอดผ่าน encode
  expect(url.searchParams.get('item_name')).toBe('ของใหม่');
  expect(url.searchParams.get('drawing_no')).toBe('DWG-NEW');
  expect(url.searchParams.get('division_id')).toBe('3');       // แมพจาก dept T47183
});

test('แมพ dept เป็น division ไม่ได้ → ลิงก์ยังไปได้ แค่ไม่มี division_id ให้', async () => {
  fetchMoPlan.mockResolvedValue({
    rows: [{ ...ROW, ITEM_NO: 'AAB-NEW/1', _dept: 'T99999' }],
    errors: [],
  });
  render(<Harness />);
  scan('MO1');

  const link = await screen.findByRole('link', { name: /ไปตั้งค่า master/ });
  const url = new URL(link.getAttribute('href'), 'http://x');
  expect(url.searchParams.get('item_no')).toBe('AAB-NEW/1');
  expect(url.searchParams.has('division_id')).toBe(false);
});
