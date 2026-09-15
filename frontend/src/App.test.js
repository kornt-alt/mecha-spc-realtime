import { render, screen } from '@testing-library/react';
import App from './App';

// socket singleton จะพยายามต่อจริงตอน import ถ้าไม่ mock
// automock เปล่า ๆ ไม่พอ เพราะยังรัน module body (เรียก io()) จึงต้องใส่ factory
jest.mock('./utils/socket', () => ({
  __esModule: true,
  default: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
}));

beforeEach(() => {
  // jsdom ไม่มี fetch ให้ และ Dashboard ยิง /master/tree ตอน mount
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('[]') })
  );
  // Router ใช้ basename '/Mecha-Spc-Realtime' ถ้า URL เป็น '/' เฉย ๆ จะไม่ match route ไหนเลย
  window.history.pushState({}, '', '/Mecha-Spc-Realtime/');
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the navbar brand', async () => {
  render(<App />);
  expect(await screen.findByText('Mecha SPC Realtime')).toBeInTheDocument();
});

test('mounts the dashboard route and loads master data', async () => {
  render(<App />);

  // Dashboard ขึ้นจริง (ถ้า basename ไม่ match จะไม่เจอข้อความนี้)
  expect(await screen.findByText(/No specs match your filter/i)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    '/Mecha-Spc-Realtime/api/master/tree',
    expect.any(Object)
  );
});
