// เทส Dashboard — เน้นเรื่องเดียว: "กราฟที่เห็นอยู่เป็นของเครื่องไหน"
//
// ⚠️ ResponsiveContainer ของ recharts สูง 0 ใน jsdom ทุกอย่างที่อยู่ "ในกราฟ" จึงเทสไม่ได้เลย
//    เทสนี้จับที่ URL ที่ถูกยิงออกไปแทน ซึ่งเป็นตัวตัดสินจริงว่ากราฟกรองเครื่องหรือไม่
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';

// ต้อง mock ทั้ง default และ named export — automock เปล่า ๆ ยังรัน module body (ต่อ socket จริง)
jest.mock('../utils/socket', () => ({
  __esModule: true,
  default: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  on: jest.fn(() => jest.fn()),
  joinModel: jest.fn(),
  leaveModel: jest.fn(),
}));

const MODELS = [
  { id: 1, item_no: 'AAB-1002', item_name: 'SHAFT', division_id: 7, division_name: 'M/P1', is_active: 1 },
];
const MACHINES = [
  { id: 11, division_id: 7, code: 'MC-01', name: 'CNC 1', is_active: 1 },
  { id: 12, division_id: 7, code: 'MC-02', name: 'CNC 2', is_active: 1 },
  // เครื่องของอีก division ต้องไม่โผล่ในลิสต์ — ใบตรวจข้าม division ไม่มีอยู่จริง
  { id: 21, division_id: 8, code: 'MP2-09', name: 'GRINDER', is_active: 1 },
];

const calls = () => global.fetch.mock.calls.map(([url]) => String(url));

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn((url) => {
    const u = String(url);
    const body = u.includes('/master/lookups')
      ? JSON.stringify({ divisions: [], machines: MACHINES, inspectors: [] })
      : u.includes('/master/models')
        ? JSON.stringify(MODELS)
        : JSON.stringify({ charts: [], summary: {}, inspections: [] });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  });
});

afterEach(() => jest.clearAllMocks());

const renderAt = (path) =>
  render(<MemoryRouter initialEntries={[path]}><Dashboard /></MemoryRouter>);

test('ยังไม่เลือกเครื่อง → ดึงกราฟรวมทุกเครื่อง และบอกไว้ที่หัวหน้า', async () => {
  renderAt('/?model=1');

  await waitFor(() => expect(calls().some((u) => u.includes('/reports/model/1'))).toBe(true));
  expect(calls().some((u) => u.includes('machine_id'))).toBe(false);
  expect(await screen.findByText(/รวมทุกเครื่อง/)).toBeInTheDocument();
});

test('?machine= ใน URL → แนบตัวกรองไปกับคำขอ และบอกขอบเขตที่กำลังดู', async () => {
  // ⚠️ ตัวกรองต้องไปถึง API จริง ไม่ใช่แค่เปลี่ยนป้ายบนจอ — backend เป็นคนเลือกทั้งข้อมูล
  //    และชุด baseline ของเครื่องนั้นจากค่านี้ (pickBaseline) ไม่ส่งไป = ได้กราฟรวมเงียบ ๆ
  global.fetch = jest.fn((url) => {
    const u = String(url);
    const body = u.includes('/master/lookups')
      ? JSON.stringify({ divisions: [], machines: MACHINES, inspectors: [] })
      : u.includes('/master/models')
        ? JSON.stringify(MODELS)
        : JSON.stringify({
          charts: [{ checkpoint: { id: 5, seq_no: 1, name: 'OD', char_type: 'variable' }, mode: 'xbar-r', points: [], limits: null, capability: null, violations: [] }],
          summary: {},
          inspections: [],
        });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  });

  renderAt('/?model=1&machine=11');

  await waitFor(() =>
    expect(calls().some((u) => u.includes('/reports/model/1?machine_id=11'))).toBe(true));
  expect(await screen.findByText(/เป็นของเครื่องนี้เครื่องเดียว/)).toBeInTheDocument();
});

test('ลิสต์เครื่องมีเฉพาะเครื่องใน division ของ item ที่เลือก บวกแถว "ทุกเครื่อง"', async () => {
  renderAt('/?model=1');

  // รอให้ lookups มาถึงก่อน ไม่งั้นเปิดลิสต์ตอนที่ยังมีแต่แถว "ทุกเครื่อง"
  await waitFor(() => expect(calls().some((u) => u.includes('/master/lookups'))).toBe(true));
  fireEvent.focus(await screen.findByLabelText('เครื่องที่จะแสดง'));

  // ⚠️ ต้องถามผ่าน listbox เสมอ — getAllByRole('option') นับ <option> ของ <select> จริงในหน้าด้วย
  const list = await screen.findByRole('listbox');
  const labels = within(list).getAllByRole('option').map((o) => o.textContent);

  expect(labels.some((t) => t.includes('ทุกเครื่อง'))).toBe(true);
  expect(labels.some((t) => t.includes('MC-01'))).toBe(true);
  expect(labels.some((t) => t.includes('MP2-09'))).toBe(false);
});

test('แผงสูตร/กฎ ปิดอยู่ตอนแรก กดแล้วถึงโผล่', async () => {
  // ⚠️ ต้องเรนเดอร์เฉพาะตอนเปิดจริง ไม่ใช่ซ่อนด้วย CSS — คำอธิบายกฎในแผงเป็นข้อความชุดเดียว
  //    กับรายการกฎที่ผิดใต้กราฟ ค้างอยู่ใน DOM เมื่อไหร่ getByText จะเจอสองที่แล้ว throw
  renderAt('/?model=1');

  expect(screen.queryByText(/2 ใน 3 จุดเกิน 2σ/)).not.toBeInTheDocument();

  fireEvent.click(await screen.findByRole('button', { name: /สูตรการคำนวณ/ }));

  expect(await screen.findByText(/X̿ ± A₂ · R̄/)).toBeInTheDocument();
  expect(screen.getByText(/2 ใน 3 จุดเกิน 2σ/)).toBeInTheDocument();
});
