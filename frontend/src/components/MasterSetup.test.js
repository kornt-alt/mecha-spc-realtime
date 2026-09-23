// เทสทางเข้าจาก MO — หน้าใบตรวจหิ้ว item มาให้ทาง URL แล้วฟอร์มต้องเติมให้ครบ
// (ดู masterHref ใน utils/useModelParam.js)
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { on } from '../utils/socket';
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

const MODELS = [
  { id: 4, division_id: 2, item_no: 'AAB-1001-01', item_name: 'ปลอกใน', division_name: 'Mecha 1', is_active: 1, checkpoint_count: 1 },
  { id: 5, division_id: 3, item_no: 'AAB-2002-02', item_name: 'แกนนอก', division_name: 'Mecha 2', is_active: 1, checkpoint_count: 0 },
];

// จุดตรวจที่มีอยู่แล้วของ item 4 — หน่วย 'Ra' ไม่อยู่ใน UNIT_OPTIONS โดยตั้งใจ
// ใช้พิสูจน์ว่าลิสต์หน่วยงอกจากของที่ใช้อยู่จริง ไม่ใช่ลิสต์ตายตัว
const CHECKPOINTS = [
  { id: 10, model_id: 4, seq_no: 1, name: 'OD', char_type: 'variable', unit: 'Ra', gauge: 'Roughness tester',
    usl: 1.6, lsl: null, target: null, sample_size: 1, is_critical: 0, is_active: 1 },
];

beforeEach(() => {
  localStorage.clear();
  // jsdom ไม่มี fetch ให้ และหน้านี้ยิง /master/lookups?all=1 + /master/models?all=1 ตอน mount
  global.fetch = jest.fn((url) => {
    const u = String(url);
    let body = '[]';
    if (u.includes('/master/lookups')) {
      body = JSON.stringify({ divisions: DIVISIONS, machines: [], inspectors: [] });
    } else if (/\/master\/models\/\d+/.test(u)) {
      body = JSON.stringify({ model: MODELS[0], checkpoints: CHECKPOINTS });
    } else if (u.includes('/master/models')) {
      body = JSON.stringify(MODELS);
    } else if (u.includes('/master/add') || u.includes('/master/update')) {
      body = JSON.stringify({ success: true, id: 99 });
    }
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

// ── ฟอร์มจุดตรวจ ───────────────────────────────────────────────────────────
//
// ฟอร์มนี้ถูก disable ทั้งชุดจนกว่าจะเลือก item — ทุกเคสข้างล่างจึงต้องเลือกก่อน
const pickItem = async () => fireEvent.click(await screen.findByText('AAB-1001-01'));
const cpRow = (name) => screen.findByRole('row', { name: new RegExp(name) });

test('ทุกช่องในฟอร์มจุดตรวจมี label ที่ผูกกับช่องจริง', async () => {
  at('');
  for (const label of ['ชื่อจุดตรวจ', 'ชนิด', 'หน่วย', 'เครื่องมือวัด', 'LSL', 'Target', 'USL', 'ชิ้น/ครั้ง']) {
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  }
});

// ลิสต์เป็น <datalist> ไม่ใช่ <select> — ค่าที่ไม่อยู่ในลิสต์ต้องยังพิมพ์และบันทึกได้
test('ลิสต์หน่วยมีตัวตั้งต้น และงอกจากหน่วยที่ item นี้ใช้อยู่จริง', async () => {
  at('');
  await pickItem();
  await waitFor(() => {
    // <datalist> ไม่อยู่ใน accessibility tree — Testing Library ไม่มี query ให้ ต้องอ่าน DOM ตรง ๆ
    // eslint-disable-next-line testing-library/no-node-access
    const opts = [...document.querySelectorAll('#cp-unit-options option')].map((o) => o.value);
    expect(opts).toEqual(['mm', 'μm', 'Ra']);
  });
  // ช่องหน่วยเป็น input ธรรมดาที่ผูก datalist ไว้ ไม่ใช่ select ที่บังคับเลือก
  expect(screen.getByLabelText('หน่วย').tagName).toBe('INPUT');
  expect(screen.getByLabelText('หน่วย')).toHaveAttribute('list', 'cp-unit-options');
});

test('เพิ่มจุดตรวจแล้วเครื่องมือวัด/หน่วยยังอยู่ แต่ชื่อจุดถูกล้าง', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชื่อจุดตรวจ'), { target: { value: 'OD หลัง' } });
  fireEvent.change(screen.getByLabelText('เครื่องมือวัด'), { target: { value: 'Micrometer' } });
  fireEvent.change(screen.getByLabelText('หน่วย'), { target: { value: 'mm' } });
  fireEvent.change(screen.getByLabelText('ชิ้น/ครั้ง'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มจุดตรวจ' }));

  await waitFor(() => expect(screen.getByLabelText('ชื่อจุดตรวจ')).toHaveValue(''));
  expect(screen.getByLabelText('เครื่องมือวัด')).toHaveValue('Micrometer');
  expect(screen.getByLabelText('หน่วย')).toHaveValue('mm');
  // sample_size เดินข้ามเส้น snake/camel (rememberCp รับ sample_size → เก็บเป็น sampleSize)
  expect(screen.getByLabelText('ชิ้น/ครั้ง')).toHaveValue(3);
});

// master_updated ถูก io.emit() ทั้งระบบ คนอื่นแก้ master เมื่อไหร่หน้านี้โหลดใหม่ทั้งชุด
// ถ้าการโหลดใหม่ไปล้างฟอร์ม สองคนแก้ master พร้อมกันแล้วอีกคนจะเสียของที่พิมพ์ค้างไว้เงียบ ๆ
test('คนอื่นแก้ master ระหว่างกรอก → ฟอร์มจุดตรวจต้องไม่ถูกล้าง', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชื่อจุดตรวจ'), { target: { value: 'ร่องลึก' } });

  const [, reload] = on.mock.calls.filter(([evt]) => evt === 'master_updated').pop();
  await act(async () => { reload(); });

  expect(screen.getByLabelText('ชื่อจุดตรวจ')).toHaveValue('ร่องลึก');
});

// เคสคู่แฝดของเคส modelForm ข้างบน — <ModelsTab> unmount ทุกครั้งที่สลับแท็บ
test('สลับแท็บไปกลับแล้วค่าในฟอร์มจุดตรวจไม่หาย', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชื่อจุดตรวจ'), { target: { value: 'ความหนา' } });

  fireEvent.click(screen.getByText('Division'));
  await screen.findAllByText(/IPBASS dept/);
  fireEvent.click(screen.getByText(/รุ่น & จุดตรวจ/));

  expect(screen.getByLabelText('ชื่อจุดตรวจ')).toHaveValue('ความหนา');
});

test('สเปกกลับหัวเตือนทันทีขณะพิมพ์ และกดเพิ่มไม่ผ่าน', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชื่อจุดตรวจ'), { target: { value: 'OD' } });
  fireEvent.change(screen.getByLabelText('LSL'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('USL'), { target: { value: '9' } });

  expect(screen.getByText(/LSL มากกว่า USL/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มจุดตรวจ' }));
  // ⚠️ ต้องถามในกล่อง — ข้อความเดียวกันนี้อยู่ในแถบเตือนใต้ฟอร์มด้วย (คนละหน้าที่กัน
  //    แถบบอกว่าค่าที่พิมพ์อยู่ผิด · กล่องบอกว่าที่เพิ่งกดไปไม่ได้บันทึก)
  expect(await screen.findByRole('dialog')).toHaveTextContent(/LSL มากกว่า USL/);
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/master/add'))).toBe(false);
});

test('สเปกด้านเดียวต้องไม่มีคำเตือน', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('USL'), { target: { value: '1.6' } });
  // เตือนพร่ำเพรื่อแล้วคนจะเลิกอ่านคำเตือนจริง — แบบที่คุมด้านเดียวเป็นรูปปกติของระบบนี้
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
});

// ตอนแก้ ฟอร์มอยู่บนสุดแต่แถวอยู่ในตารางข้างล่าง ถ้าไม่บอกก็ไม่มีทางรู้ว่ากำลังแก้จุดไหน
test('กด "แก้" แล้วหัวการ์ดบอกว่ากำลังแก้จุดไหน และแถวนั้นถูกไฮไลต์', async () => {
  at('');
  await pickItem();
  const row = await cpRow('OD');
  fireEvent.click(within(row).getByRole('button', { name: 'แก้' }));

  expect(await screen.findByText(/กำลังแก้จุดที่/)).toBeInTheDocument();
  expect(screen.getByLabelText('ชื่อจุดตรวจ')).toHaveValue('OD');
  expect((await cpRow('OD')).className).toMatch(/table-warning/);
});

// ── โหมดกรอกสเปกแบบ "ค่ากลาง + พิกัด" ──────────────────────────────────────
//
// สิ่งที่บันทึกลง DB ต้องเป็น LSL/Target/USL สัมบูรณ์เสมอไม่ว่ากรอกมาโหมดไหน
// เทสชุดนี้จึงอ่าน body ที่ถูกยิงไป /master/add จริง ๆ ไม่ใช่ดูแค่หน้าจอ
const toTolMode = () => fireEvent.click(screen.getByLabelText('ค่ากลาง + พิกัดจากแบบ'));
const toLimitsMode = () => fireEvent.click(screen.getByLabelText('LSL / Target / USL'));

const addedData = () => {
  const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/master/add'));
  return JSON.parse(call[1].body).data;
};

const fillTol = (nominal, upper, lower) => {
  fireEvent.change(screen.getByLabelText('ค่ากลาง'), { target: { value: nominal } });
  fireEvent.change(screen.getByLabelText('พิกัดบน'), { target: { value: upper } });
  fireEvent.change(screen.getByLabelText('พิกัดล่าง'), { target: { value: lower } });
};

test('ค่าเริ่มต้นเป็นโหมด LSL/Target/USL — ช่องพิกัดยังไม่โผล่', async () => {
  at('');
  await pickItem();
  expect(screen.getByLabelText('LSL')).toBeInTheDocument();
  expect(screen.queryByLabelText('ค่ากลาง')).not.toBeInTheDocument();
});

test('สลับโหมดแล้วช่องสลับตาม', async () => {
  at('');
  await pickItem();
  toTolMode();
  expect(screen.getByLabelText('ค่ากลาง')).toBeInTheDocument();
  expect(screen.queryByLabelText('LSL')).not.toBeInTheDocument();
});

// เคสหลักของฟีเจอร์ — พิมพ์ตามแบบแล้วสิ่งที่ถูกบันทึกต้องเป็นเลขสัมบูรณ์
test('กรอกแบบพิกัดแล้วบันทึกเป็น LSL/Target/USL สัมบูรณ์', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชื่อจุดตรวจ'), { target: { value: 'OD หน้า' } });
  toTolMode();
  fillTol('1.23', '0.5', '0.6');

  // preview คือ <SpecValue> ตัวเดียวกับที่ operator เห็นบนใบตรวจ
  expect(screen.getByText(/0\.63 – 1\.73/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มจุดตรวจ' }));
  await waitFor(() => expect(addedData()).toMatchObject({ lsl: 0.63, target: 1.23, usl: 1.73 }));
});

// งานเพลา/เฟือง — พิกัดติดลบทั้งคู่ ลิมิตทั้งสองด้านอยู่ใต้ค่ากลาง
test('พิกัดลบทั้งคู่บันทึกได้ถูกต้อง', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชื่อจุดตรวจ'), { target: { value: 'เพลา' } });
  toTolMode();
  fillTol('10', '-0.005', '-0.015');

  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มจุดตรวจ' }));
  await waitFor(() => expect(addedData()).toMatchObject({ lsl: 9.985, target: 10, usl: 9.995 }));
});

// ถ้าใครเปลี่ยนช่องพิกัดกลับไปเป็น type="number" เคสนี้จะพัง — เบราว์เซอร์กลืน '+' ทิ้ง
test('พิมพ์ + ในช่องพิกัดได้จริง (ช่องเป็น text ไม่ใช่ number)', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชื่อจุดตรวจ'), { target: { value: 'รู' } });
  toTolMode();
  fillTol('10', '+0.015', '+0.005');

  expect(screen.getByLabelText('พิกัดบน')).toHaveValue('+0.015');
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มจุดตรวจ' }));
  await waitFor(() => expect(addedData()).toMatchObject({ lsl: 10.005, target: 10, usl: 10.015 }));
});

// กรอกพิกัดสลับข้างเป็นความผิดพลาดจริง ห้ามสลับให้เงียบ ๆ ต้องให้ตาข่ายเดิมจับ
test('พิกัดสลับข้างยังโดนกฎ LSL > USL บล็อกเหมือนเดิม', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชื่อจุดตรวจ'), { target: { value: 'สลับข้าง' } });
  toTolMode();
  fillTol('10', '-0.015', '-0.005');

  expect(screen.getByText(/LSL มากกว่า USL/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มจุดตรวจ' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent(/LSL มากกว่า USL/);
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/master/add'))).toBe(false);
});

// สลับโหมดดูเฉย ๆ แล้วเลขขยับ = แก้สเปกของจุดตรวจไปโดยไม่ได้ตั้งใจ
test('สลับโหมดไปกลับแล้วค่าไม่หายและไม่ขยับ', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('LSL'), { target: { value: '0.63' } });
  fireEvent.change(screen.getByLabelText('Target'), { target: { value: '1.23' } });
  fireEvent.change(screen.getByLabelText('USL'), { target: { value: '1.73' } });

  toTolMode();
  expect(screen.getByLabelText('ค่ากลาง')).toHaveValue(1.23);
  expect(screen.getByLabelText('พิกัดบน')).toHaveValue('+0.5');
  expect(screen.getByLabelText('พิกัดล่าง')).toHaveValue('-0.6');

  toLimitsMode();
  expect(screen.getByLabelText('LSL')).toHaveValue(0.63);
  expect(screen.getByLabelText('Target')).toHaveValue(1.23);
  expect(screen.getByLabelText('USL')).toHaveValue(1.73);
});

// แบบใบเดียวมีจุดตรวจที่เขียนรูปเดียวกันสิบกว่าจุด เด้งกลับทุกครั้งที่บันทึกคือกดสลับซ้ำ 15 รอบ
test('บันทึกแล้วช่องพิกัดถูกล้าง แต่ยังอยู่โหมดพิกัดเหมือนเดิม', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชื่อจุดตรวจ'), { target: { value: 'จุดแรก' } });
  toTolMode();
  fillTol('1.23', '0.5', '0.6');
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มจุดตรวจ' }));

  await waitFor(() => expect(screen.getByLabelText('ค่ากลาง')).toHaveValue(null));
  expect(screen.getByLabelText('พิกัดบน')).toHaveValue('');
});

// editingCp ที่ชี้ไปจุดเก่าพร้อมฟอร์มที่แสดงคนละรูปคือทางลัดไปแก้ผิดจุด
test('กด "แก้" กลับมาโหมด LSL/Target/USL เสมอ พร้อมเลขที่เก็บอยู่จริง', async () => {
  at('');
  await pickItem();
  toTolMode();
  fillTol('9', '0.1', '0.1');

  const row = await cpRow('OD');
  fireEvent.click(within(row).getByRole('button', { name: 'แก้' }));

  expect(await screen.findByLabelText('USL')).toHaveValue(1.6);
  expect(screen.queryByLabelText('ค่ากลาง')).not.toBeInTheDocument();
});

// จุด attribute ไม่มีค่าตัวเลขเลย ไม่มีสเปกให้กรอกไม่ว่าโหมดไหน
test('จุด attribute ไม่มีแถบเลือกโหมด', async () => {
  at('');
  await pickItem();
  fireEvent.change(screen.getByLabelText('ชนิด'), { target: { value: 'attribute' } });
  expect(screen.queryByLabelText('ค่ากลาง + พิกัดจากแบบ')).not.toBeInTheDocument();
});

// ลิสต์ item ยาวเป็นร้อยแถว เลื่อนหาช้ากว่าพิมพ์
test('ช่องค้นหากรองตาราง item ได้ทั้งเลข ชื่อ และ division', async () => {
  at('');
  await screen.findByText('AAB-1001-01');
  const search = screen.getByPlaceholderText(/ค้นหา item/);

  fireEvent.change(search, { target: { value: 'แกนนอก' } });
  expect(screen.queryByText('AAB-1001-01')).not.toBeInTheDocument();
  expect(screen.getByText('AAB-2002-02')).toBeInTheDocument();

  // ค้นด้วย division ได้ด้วย — สองแถวที่เลข item คล้ายกันแยกกันด้วยอันนี้
  fireEvent.change(search, { target: { value: 'Mecha 1' } });
  expect(screen.getByText('AAB-1001-01')).toBeInTheDocument();
  expect(screen.queryByText('AAB-2002-02')).not.toBeInTheDocument();

  // ไม่เจอต้องบอก ไม่ใช่ตารางว่างเปล่าที่อธิบายตัวเองไม่ได้
  fireEvent.change(search, { target: { value: 'zzz' } });
  expect(screen.getByText('ไม่พบ item ที่ค้นหา')).toBeInTheDocument();
});
