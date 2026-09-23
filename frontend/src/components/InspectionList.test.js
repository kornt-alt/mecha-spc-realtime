// เทส InspectionList — ตารางใบตรวจ + ปุ่มยกเลิก/คืนค่า
//
// สามเรื่องที่ต้องไม่พลาด:
//   1. ใบที่ยกเลิกแล้ว **ยังต้องอยู่ในตาราง** ไม่งั้นกดคืนค่าไม่ได้และคนจะนึกว่าลบจริงไปแล้ว
//   2. ยกเลิกโดยไม่มีเหตุผลต้องไม่ถูกส่งไป server (ไม่มี auth เหตุผลคือร่องรอยเดียวที่เหลือ)
//      — ตอนนี้บังคับด้วยปุ่มยืนยันที่กดไม่ได้ในกล่อง ไม่ใช่ window.alert ใบที่สอง
//   3. baseline ที่ล็อกคร่อมใบที่ยกเลิก ต้องเตือนให้ re-baseline ไม่งั้นเส้นลิมิตมาจากข้อมูลที่ตัดไปแล้ว
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import InspectionList from './InspectionList';

const ROWS = [
  {
    id: 1, mo_no: 'MO-001', lot_no: 'L1', shift: 'M', subgroup_no: 1,
    inspected_at: '2026-09-18T02:00:00Z', overall_result: 'OK',
    machine_name: 'MC-01', inspector_name: 'สมชาย', ng_count: 0,
    voided_at: null, voided_reason: null,
  },
  {
    id: 2, mo_no: 'MO-001', lot_no: 'L1', shift: 'M', subgroup_no: 2,
    inspected_at: '2026-09-18T03:00:00Z', overall_result: 'NG',
    machine_name: 'MC-01', inspector_name: 'สมชาย', ng_count: 3,
    voided_at: '2026-09-18T04:00:00Z', voided_reason: 'กรอกผิด — สมชาย',
  },
];

const okResponse = (body = { success: true }) => Promise.resolve({
  ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)),
});

beforeEach(() => { global.fetch = jest.fn(() => okResponse()); });
afterEach(() => jest.restoreAllMocks());

// แถวที่ 0 คือ thead — ROWS[0] อยู่ index 1, ROWS[1] อยู่ index 2
const rowOf = (i) => screen.getAllByRole('row')[i + 1];

const bodyOf = (call) => JSON.parse(call[1].body);
const addCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/void'));

test('ใบที่ยกเลิกแล้วยังอยู่ในตาราง พร้อมเหตุผลและปุ่มคืนค่า', () => {
  render(<InspectionList rows={ROWS} />);

  const voided = rowOf(1);
  expect(within(voided).getByText('ยกเลิก')).toBeInTheDocument();
  expect(within(voided).getByText('กรอกผิด — สมชาย')).toBeInTheDocument();
  expect(within(voided).getByRole('button', { name: 'คืนค่า' })).toBeInTheDocument();
  // ต้องมองออกทันทีว่าไม่นับแล้ว ไม่ใช่แถวธรรมดา
  expect(voided.className).toMatch(/row--voided/);

  // แถวปกติต้องไม่ถูกทำเครื่องหมาย และปุ่มต้องเป็น "ยกเลิก"
  const live = rowOf(0);
  expect(live.className).not.toMatch(/row--voided/);
  expect(within(live).getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument();
});

// ทุกกล่องยืนยันเป็น <Modal> ในแอป ไม่ใช่ popup ของเบราว์เซอร์แล้ว
// ⚠️ ต้องถามผ่าน within(dialog) เสมอ — ปุ่ม "ยกเลิก" / "คืนค่า" มีทั้งในแถวตารางและในกล่อง
const dlg = () => screen.getByRole('dialog');

const openVoid = (i = 0) => {
  fireEvent.click(within(rowOf(i)).getByRole('button', { name: 'ยกเลิก' }));
  return dlg();
};

const openRestore = (i = 1) => {
  fireEvent.click(within(rowOf(i)).getByRole('button', { name: 'คืนค่า' }));
  return dlg();
};

const fillReason = (d, value) =>
  fireEvent.change(within(d).getByLabelText('เหตุผลที่ยกเลิก'), { target: { value } });

const confirmVoid = (d) =>
  fireEvent.click(within(d).getByRole('button', { name: 'ยืนยันยกเลิกใบตรวจ' }));

test('ยกเลิกแล้วส่งเหตุผลไปด้วย และเรียก onChanged ให้โหลดใหม่', async () => {
  const onChanged = jest.fn();
  render(<InspectionList rows={ROWS} onChanged={onChanged} />);

  const d = openVoid();
  fillReason(d, '  ตรวจซ้ำ  ');
  confirmVoid(d);

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  const [url, opts] = addCalls()[0];
  expect(String(url)).toMatch(/\/inspections\/1\/void$/);
  expect(opts.method).toBe('PUT');
  // ช่องว่างหัวท้ายต้องถูกตัด ไม่ใช่ส่งดิบไป
  expect(bodyOf(addCalls()[0])).toEqual({ voided: true, reason: 'ตรวจซ้ำ' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

// เหตุผลคือร่องรอยเดียวที่ระบบมี (ไม่มี auth เลยสักเส้น) — ต้องกดยืนยันไม่ได้จนกว่าจะกรอกจริง
test('ไม่กรอกเหตุผล = ปุ่มยืนยันกดไม่ได้ และไม่ยิงอะไรเลย', () => {
  render(<InspectionList rows={ROWS} />);

  const d = openVoid();
  const ok = within(d).getByRole('button', { name: 'ยืนยันยกเลิกใบตรวจ' });

  expect(ok).toBeDisabled();
  fillReason(d, '   ');
  expect(ok).toBeDisabled();
  // ปุ่มที่กดไม่ได้ต้องบอกเหตุผลเสมอ ไม่งั้นกลายเป็นทางตัน
  expect(within(d).getByText(/จำเป็นต้องกรอก/)).toBeInTheDocument();

  fillReason(d, 'กรอกผิด');
  expect(ok).toBeEnabled();
  expect(addCalls()).toHaveLength(0);
});

test('กดปิดที่กล่องยกเลิก = ไม่ยิงอะไรเลย', () => {
  render(<InspectionList rows={ROWS} />);

  const d = openVoid();
  fillReason(d, 'กรอกผิด');
  fireEvent.click(within(d).getByRole('button', { name: 'ปิด' }));

  expect(addCalls()).toHaveLength(0);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('คืนค่าต้องยืนยันก่อน และส่ง voided: false โดยไม่ต้องมีเหตุผล', async () => {
  const onChanged = jest.fn();
  render(<InspectionList rows={ROWS} onChanged={onChanged} />);

  const d = openRestore();
  // ต้องถามถึงใบที่กดจริง ไม่ใช่ใบไหนก็ได้
  expect(d).toHaveTextContent(/#2/);
  fireEvent.click(within(d).getByRole('button', { name: 'คืนค่า' }));

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(bodyOf(addCalls()[0])).toEqual({ voided: false });
});

test('ไม่ยืนยันตอนคืนค่า = ไม่ยิงอะไรเลย และโฟกัสเริ่มต้นอยู่ที่ปุ่มยกเลิก', () => {
  render(<InspectionList rows={ROWS} />);

  const d = openRestore();
  const cancel = within(d).getByRole('button', { name: 'ยกเลิก' });

  // กด Enter รัวมาจากหน้าก่อนต้องไม่ไปโดนปุ่มยืนยัน
  expect(cancel).toHaveFocus();
  fireEvent.click(cancel);
  expect(addCalls()).toHaveLength(0);
});

// baseline เป็นตัวเลขที่ freeze ไว้ ไม่มีอะไรคำนวณใหม่ให้ — ยกเลิกใบที่อยู่ในช่วงนั้น
// แล้วเงียบไว้ = เส้น control limit ยังมาจากข้อมูลที่ระบบเพิ่งบอกว่าไม่นับ
test('ยกเลิกใบที่อยู่ในช่วง baseline ที่ล็อกไว้ → เตือนให้ re-baseline พร้อมชื่อจุด', async () => {
  global.fetch = jest.fn(() => okResponse({ success: true, staleBaselines: ['OD', 'ความหนา'] }));
  render(<InspectionList rows={ROWS} />);

  const d = openVoid();
  fillReason(d, 'กรอกผิด');
  confirmVoid(d);

  // กล่องเตือนเป็นคนละใบกับกล่องที่เพิ่งปิดไป
  await waitFor(() => expect(dlg()).toHaveTextContent(/Re-baseline/));
  expect(dlg()).toHaveTextContent(/OD, ความหนา/);
});

test('ใบที่ถูกล้างทิ้งไปแล้ว → โชว์ข้อความจาก server ไม่ใช่ error ดิบ', async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: false, status: 404,
    text: () => Promise.resolve(JSON.stringify({ error: 'ไม่พบใบตรวจนี้ — อาจถูกล้างทิ้งไปแล้ว' })),
  }));

  render(<InspectionList rows={ROWS} />);
  const d = openRestore();
  fireEvent.click(within(d).getByRole('button', { name: 'คืนค่า' }));

  await waitFor(() => expect(dlg()).toHaveTextContent(/ถูกล้างทิ้งไปแล้ว/));
});

test('ไม่มีใบตรวจ → ขึ้นข้อความแทนตารางเปล่า', () => {
  render(<InspectionList rows={[]} emptyText="ไม่มีใบตรวจที่ตรงกับตัวกรองนี้" />);
  expect(screen.getByText('ไม่มีใบตรวจที่ตรงกับตัวกรองนี้')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
