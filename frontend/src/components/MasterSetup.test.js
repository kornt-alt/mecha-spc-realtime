// เทสทางเข้าจาก MO — หน้าใบตรวจหิ้ว item มาให้ทาง URL แล้วฟอร์มต้องเติมให้ครบ
// (ดู masterHref ใน utils/useModelParam.js)
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import MasterSetup from './MasterSetup';

// socket singleton ต่อจริงตอน import ถ้าไม่ mock — automock เปล่า ๆ ไม่พอ ต้องใส่ factory
jest.mock('../utils/socket', () => ({
  __esModule: true,
  default: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  on: jest.fn(() => jest.fn()),
  joinModel: jest.fn(),
  leaveModel: jest.fn(),
}));

const DIVISIONS = [
  { id: 2, name: 'Mecha 1', ipbass_dept: 'T47563' },
  { id: 3, name: 'Mecha 2', ipbass_dept: 'T47183' },
];

beforeEach(() => {
  // jsdom ไม่มี fetch ให้ และหน้านี้ยิง /master/lookups?all=1 + /master/models?all=1 ตอน mount
  global.fetch = jest.fn((url) => {
    const body = String(url).includes('/master/lookups')
      ? JSON.stringify({ divisions: DIVISIONS, machines: [], inspectors: [] })
      : '[]';
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  });
});
afterEach(() => jest.clearAllMocks());

// อ่าน query ปัจจุบันของ MemoryRouter ออกมาดูไม่ได้ตรง ๆ ยัด probe เข้าไปแทน
const Probe = () => <div data-testid="qs">{useLocation().search}</div>;
const qs = () => new URLSearchParams(screen.getByTestId('qs').textContent);

const at = (search) => render(
  <MemoryRouter initialEntries={[`/master${search}`]}>
    <MasterSetup />
    <Probe />
  </MemoryRouter>
);

const itemNoBox = () => screen.getByPlaceholderText(/Item No\./);
const itemNameBox = () => screen.getByPlaceholderText(/ชื่อ item/);

test('prefill จาก URL ลงครบทุกช่อง รวม division ที่ยังโหลดไม่เสร็จตอน mount', async () => {
  at('?item_no=AAB-NEW%2F1&item_name=%E0%B8%82%E0%B8%AD%E0%B8%87%E0%B9%83%E0%B8%AB%E0%B8%A1%E0%B9%88&drawing_no=DWG-NEW&division_id=3');

  // '/' ที่ถูก encode มาต้องกลับมาเป็น '/' ไม่ใช่ %2F
  expect(itemNoBox()).toHaveValue('AAB-NEW/1');
  expect(itemNameBox()).toHaveValue('ของใหม่');
  expect(screen.getByPlaceholderText('เลขแบบ')).toHaveValue('DWG-NEW');

  // ⚠️ division_id ถูก seed ตั้งแต่ก่อน divisions มาถึง — ต้องเด้งมาถูกเองเมื่อ option โหลดเสร็จ
  //    ห้ามมีโค้ดไหน reset ค่าทิ้งเพราะหา option ไม่เจอ
  await waitFor(() => expect(screen.getByDisplayValue('Mecha 2')).toBeInTheDocument());

  expect(screen.getByText(/ข้อมูลจาก MO เติมไว้ให้แล้ว/)).toBeInTheDocument();
});

// ModelsTab เรนเดอร์ตามแท็บ สลับแท็บ = unmount แล้ว mount ใหม่
// ถ้า prefill อ่านจาก searchParams สด ๆ ตอนนั้น param ถูกล้างไปแล้ว จะ seed ทับด้วยค่าว่าง
test('สลับแท็บไปกลับแล้วค่าที่เติมไว้และที่พิมพ์เพิ่มต้องไม่หาย', async () => {
  at('?item_no=AAB-NEW%2F1&item_name=X');
  fireEvent.change(itemNameBox(), { target: { value: 'พิมพ์เพิ่มเอง' } });

  fireEvent.click(screen.getByText('Division'));
  // ชื่อคอลัมน์โผล่ทั้งที่ label ของฟอร์มและหัวตาราง จึงต้อง findAll
  await screen.findAllByText(/IPBASS dept/);
  fireEvent.click(screen.getByText(/รุ่น & จุดตรวจ/));

  expect(itemNoBox()).toHaveValue('AAB-NEW/1');
  expect(itemNameBox()).toHaveValue('พิมพ์เพิ่มเอง');
});

// ไม่ล้าง = กด F5 หลังบันทึกแล้วฟอร์มเด้งกลับมาให้เพิ่ม item เดิมซ้ำ ชน UNIQUE
test('ล้าง param ของ prefill ทิ้งหลัง seed แต่เก็บ ?model= ไว้', async () => {
  at('?model=4&item_no=AAB-NEW%2F1&item_name=X');

  await waitFor(() => expect(qs().has('item_no')).toBe(false));
  expect(qs().has('item_name')).toBe(false);
  // ?model= ไม่ใช่ prefill มันคือ "กำลังดู item ไหน" เหมือนหน้าอื่น ต้องอยู่ต่อ
  expect(qs().get('model')).toBe('4');
  // seed ต้องทันก่อนล้าง ไม่งั้นล้างแล้วฟอร์มว่างเปล่า
  expect(itemNoBox()).toHaveValue('AAB-NEW/1');
});

test('ไม่มี param ก็เปิดได้ตามปกติ ฟอร์มว่างและไม่มีแถบบอกทาง', async () => {
  at('');
  expect(itemNoBox()).toHaveValue('');
  expect(screen.queryByText(/ข้อมูลจาก MO เติมไว้ให้แล้ว/)).not.toBeInTheDocument();
});
