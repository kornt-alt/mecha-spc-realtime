// เทสใบตรวจ — เน้นสองอย่างที่เป็นเหตุผลของการรีดีไซน์
//   1. สถานีที่จำไว้ทำให้เปิดหน้ามาแล้วกรอกได้เลย ไม่ต้องเลือกรุ่น/เครื่อง/ผู้ตรวจใหม่
//   2. กรอกทั้งใบด้วยคีย์บอร์ดอย่างเดียว Enter เลื่อนช่อง ไม่ใช่ submit ฟอร์ม
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InspectionSheet from './InspectionSheet';

// socket singleton ต่อจริงตอน import ถ้าไม่ mock — ต้องใส่ factory ไม่ใช่ automock เปล่า
jest.mock('../utils/socket', () => ({
  __esModule: true,
  default: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  on: jest.fn(() => jest.fn()),
  joinModel: jest.fn(),
  leaveModel: jest.fn(),
}));

const MODEL = { id: 1, division_id: 1, item_no: 'AAB-1', item_name: 'Shaft', division_name: 'Mecha 2', is_active: 1 };
const LOOKUPS = {
  divisions: [{ id: 1, name: 'M/P1' }],
  machines: [{ id: 2, division_id: 1, code: 'SC1-1', name: '', is_active: 1 }],
  inspectors: [{ id: 3, division_id: 1, name: 'นิตยา', is_active: 1 }],
};
// ⚠️ ค่า decimal ส่งมาเป็น string เหมือนที่ mysql2 คืนจริง normalize ต้องแปลงให้
const CHECKPOINTS = [
  {
    id: 10, seq_no: 1, name: 'OD', char_type: 'variable', unit: 'mm', gauge: 'Micrometer',
    usl: '2.0000', lsl: '1.9960', target: '1.9980', sample_size: 3, is_critical: 0, is_active: 1,
  },
  {
    id: 11, seq_no: 2, name: 'ตำหนิผิวงาน', char_type: 'attribute', unit: null, gauge: null,
    usl: null, lsl: null, target: null, sample_size: 1, is_critical: 0, is_active: 1,
  },
];

const json = (body) => Promise.resolve({
  ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)),
});

beforeEach(() => {
  localStorage.clear();
  // สถานีที่ "จำไว้" จากครั้งก่อน — จุดสำคัญของการลด work step
  localStorage.setItem('spc.station', JSON.stringify({
    modelId: '1', machineId: '2', inspectorId: '3', shift: 'M',
  }));

  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/master/lookups')) return json(LOOKUPS);
    if (u.includes('/master/models/1')) return json({ model: MODEL, checkpoints: CHECKPOINTS });
    if (u.includes('/master/models')) return json([MODEL]);
    if (u.includes('/inspections')) return json([]);
    return json([]);
  });
});

afterEach(() => jest.clearAllMocks());

const cells = () => document.querySelectorAll('input[data-cell]');

test('สถานีที่จำไว้ทำให้เปิดมาเห็นใบตรวจเลย ไม่ต้องเลือกรุ่นใหม่', async () => {
  render(<MemoryRouter><InspectionSheet /></MemoryRouter>);

  // จุดตรวจถูกโหลดมาแล้วโดยไม่ต้องแตะอะไร
  expect(await screen.findByText('OD')).toBeInTheDocument();
  expect(screen.getByText('ตำหนิผิวงาน')).toBeInTheDocument();
  // แถบสถานีโชว์ค่าที่จำไว้ ไม่ได้กางแผงให้เลือกใหม่
  expect(screen.getByText('SC1-1')).toBeInTheDocument();
  expect(screen.getByText('นิตยา')).toBeInTheDocument();
});

test('ช่องกรอกมีครบตาม sample_size และแถว attribute ไม่กินช่องตัวเลข', async () => {
  render(<MemoryRouter><InspectionSheet /></MemoryRouter>);
  await screen.findByText('OD');

  // จุด OD สุ่ม 3 ชิ้น → 3 ช่อง · จุด attribute เป็น radio ไม่ใช่ช่องตัวเลข
  expect(cells()).toHaveLength(3);
  expect(screen.getByRole('radiogroup', { name: /ผลตรวจ ตำหนิผิวงาน/ })).toBeInTheDocument();
});

test('กด Enter แล้วเลื่อนไปช่องถัดไป ไม่ใช่ submit ฟอร์ม', async () => {
  render(<MemoryRouter><InspectionSheet /></MemoryRouter>);
  await screen.findByText('OD');

  const list = cells();
  list[0].focus();
  expect(document.activeElement).toBe(list[0]);

  fireEvent.keyDown(list[0], { key: 'Enter' });
  expect(document.activeElement).toBe(list[1]);

  fireEvent.keyDown(list[1], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(list[2]);

  // ลูกศรขึ้นถอยกลับได้ ไว้แก้ค่าที่พิมพ์ผิด
  fireEvent.keyDown(list[2], { key: 'ArrowUp' });
  expect(document.activeElement).toBe(list[1]);

  // ⚠️ ห้ามมีการยิง POST ระหว่างนี้ — Enter ต้องไม่ submit
  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringContaining('/inspections'),
    expect.objectContaining({ method: 'POST' })
  );
});

test('ค่าที่หลุดสเปกขึ้นแดงทันทีที่พิมพ์ และผลรวมของแถวเป็น NG', async () => {
  render(<MemoryRouter><InspectionSheet /></MemoryRouter>);
  await screen.findByText('OD');

  const list = cells();
  // สเปก 1.9960 – 2.0000 → 2.5 หลุดบน
  fireEvent.change(list[0], { target: { value: '2.5' } });

  await waitFor(() => expect(list[0].className).toMatch(/cell--ng/));
  expect(screen.getByText('NG 1 จุด')).toBeInTheDocument();
});

test('กรอกไม่ครบ ปุ่มบันทึกยังกดไม่ได้', async () => {
  render(<MemoryRouter><InspectionSheet /></MemoryRouter>);
  await screen.findByText('OD');

  const save = screen.getByRole('button', { name: /บันทึกใบตรวจ/ });
  expect(save).toBeDisabled();

  const list = cells();
  fireEvent.change(list[0], { target: { value: '1.998' } });
  fireEvent.change(list[1], { target: { value: '1.997' } });
  // ยังเหลือช่องที่ 3 — ใบที่กรอกไม่ครบใช้เป็นหลักฐานไม่ได้ server ก็ปฏิเสธอยู่แล้ว
  expect(save).toBeDisabled();

  fireEvent.change(list[2], { target: { value: '1.999' } });
  // ครบทุกช่องแล้วแต่ยังไม่มี MO — ห้ามเปิดปุ่ม ของเดิม MO ว่างถูกจับที่ server
  // อย่างเดียว คนกรอกครบทั้งใบแล้วค่อยโดนตีกลับ
  expect(save).toBeDisabled();

  fireEvent.change(screen.getByPlaceholderText(/สแกน\/พิมพ์ MO/), { target: { value: 'MO-1' } });
  await waitFor(() => expect(save).toBeEnabled());
});
