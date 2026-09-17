import { render, screen } from '@testing-library/react';
import App from './App';

// socket singleton จะพยายามต่อจริงตอน import ถ้าไม่ mock
// automock เปล่า ๆ ไม่พอ เพราะยังรัน module body (เรียก io()) จึงต้องใส่ factory
// ⚠️ ต้อง mock ทั้ง default และ named export (on/joinModel/leaveModel) ที่ component ใช้
jest.mock('./utils/socket', () => ({
  __esModule: true,
  default: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  on: jest.fn(() => jest.fn()),
  joinModel: jest.fn(),
  leaveModel: jest.fn(),
}));

beforeEach(() => {
  // jsdom ไม่มี fetch ให้ และหน้าใบตรวจยิง /master/lookups + /master/models ตอน mount
  global.fetch = jest.fn((url) => {
    const body = String(url).includes('/master/lookups')
      ? '{"divisions":[],"machines":[],"inspectors":[]}'
      : '[]';
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  });
  // Router ใช้ basename '/Mecha-Spc-Realtime' ถ้า URL เป็น '/' เฉย ๆ จะไม่ match route ไหนเลย
  window.history.pushState({}, '', '/Mecha-Spc-Realtime/');
});

afterEach(() => jest.clearAllMocks());

test('renders the navbar brand', async () => {
  render(<App />);
  expect(await screen.findByText('Mecha QC Inspection')).toBeInTheDocument();
});

test('หน้าแรกคือใบตรวจ และโหลด master ตอน mount', async () => {
  render(<App />);

  expect(await screen.findByText(/ใบตรวจสอบคุณภาพ/)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    '/Mecha-Spc-Realtime/api/master/lookups',
    expect.any(Object)
  );
  expect(global.fetch).toHaveBeenCalledWith(
    '/Mecha-Spc-Realtime/api/master/models',
    expect.any(Object)
  );
});

test('พิมพ์ URL ผิดได้หน้า 404 ไม่ใช่หน้าขาว', async () => {
  window.history.pushState({}, '', '/Mecha-Spc-Realtime/ไม่มีจริง');
  render(<App />);
  expect(await screen.findByText(/ไม่พบหน้านี้/)).toBeInTheDocument();
});
