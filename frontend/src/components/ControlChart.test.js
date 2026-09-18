// เทส ControlChart — คอมไพล์ผ่านไม่ได้แปลว่า render ผ่าน
// recharts กับ custom dot function พังตอน runtime ได้ (เช่นอ่าน payload ที่เป็น null)
// เทสนี้เลยเน้นว่า "render แล้วไม่ throw" ในทุกโหมดที่ backend ส่งมาได้
import { render, screen } from '@testing-library/react';
import ControlChart from './ControlChart';

const checkpoint = (over = {}) => ({
  id: 1, seq_no: 1, name: 'OD', char_type: 'variable', unit: 'mm',
  usl: 10.05, lsl: 9.95, target: 10, sample_size: 5, is_critical: false, ...over,
});

const point = (i, over = {}) => ({
  index: i, subgroupNo: i + 1, inspectionId: i + 1,
  xbar: 10 + (i % 3) * 0.01, range: 0.03, values: [9.98, 10.01, 10, 9.99, 10.02],
  meta: { moNo: 'MO-1', lotNo: 'L1', shift: 'M', inspector: 'สมชาย', machine: 'MC-01', inspectedAt: '2026-09-17T01:00:00Z' },
  rules: [], ...over,
});

const limits = (over = {}) => ({
  mode: 'xbar-r', n: 5, baselineUsed: true, provisional: false,
  subgroupCount: 3, minBaselineSubgroups: 20,
  center: 10, ucl: 10.02, lcl: 9.98,
  rangeCenter: 0.035, rangeUcl: 0.074, rangeLcl: 0, sigmaWithin: 0.0155, ...over,
});

const capability = { cp: 1.1, cpk: 1.06, pp: 1.27, ppk: 1.22, sigmaWithin: 0.0155, sigmaOverall: 0.0134, mean: 10 };

test('X-bar R — โชว์ชื่อจุด สเปก และ badge สถานะ', () => {
  render(<ControlChart chart={{
    checkpoint: checkpoint(), points: [point(0), point(1), point(2)],
    limits: limits(), capability, violations: [], mode: 'xbar-r',
  }} />);

  expect(screen.getByText(/1\. OD/)).toBeInTheDocument();
  expect(screen.getByText(/X̄-R \(n=5\)/)).toBeInTheDocument();
  expect(screen.getByText('In control')).toBeInTheDocument();
  // Cpk/Ppk โผล่สองที่โดยตั้งใจ: badge บนหัวกราฟ และบรรทัดสรุปใต้กราฟ จึงใช้ getAllByText
  expect(screen.getAllByText(/Cpk 1\.06/).length).toBeGreaterThan(0);
  // ต้องโชว์ Ppk คู่กับ Cpk เสมอ — ห่างกันมากแปลว่า process ไม่นิ่ง ข้อมูลนี้หายไม่ได้
  expect(screen.getAllByText(/Ppk 1\.22/).length).toBeGreaterThan(0);
});

test('มีจุดผิดกฎ Nelson → ขึ้น Out of control', () => {
  render(<ControlChart chart={{
    checkpoint: checkpoint(), points: [point(0), point(1, { rules: [1, 5] })],
    limits: limits(), capability, violations: [{ index: 1, rules: [1, 5] }], mode: 'xbar-r',
  }} />);

  expect(screen.getByText('Out of control')).toBeInTheDocument();
});

test('I-MR (n=1) — จุดแรก range เป็น null ต้องไม่พัง', () => {
  render(<ControlChart chart={{
    checkpoint: checkpoint({ sample_size: 1 }),
    points: [point(0, { range: null, values: [25.1] }), point(1, { range: 0.07, values: [25.05] })],
    limits: limits({ mode: 'i-mr', n: 1 }), capability, violations: [], mode: 'i-mr',
  }} />);

  expect(screen.getByText(/I-MR \(n=1\)/)).toBeInTheDocument();
  expect(screen.getByText('Moving Range')).toBeInTheDocument();
});

test('ลิมิตยัง provisional → ขึ้นคำเตือนว่าเส้นจะขยับ', () => {
  render(<ControlChart chart={{
    checkpoint: checkpoint(), points: [point(0)],
    limits: limits({ provisional: true, baselineUsed: false, subgroupCount: 3 }),
    capability, violations: [], mode: 'xbar-r',
  }} />);

  expect(screen.getByText(/provisional/)).toBeInTheDocument();
});

test('จุด attribute — โชว์สรุป %NG ไม่พยายามวาดกราฟ', () => {
  render(<ControlChart chart={{
    checkpoint: checkpoint({ char_type: 'attribute', usl: null, lsl: null }),
    mode: 'attribute', total: 10, ngCount: 2, ngRate: 0.2,
    points: [], limits: null, capability: null, violations: [],
  }} />);

  expect(screen.getByText('2 / 10')).toBeInTheDocument();
  expect(screen.getByText(/%NG 20\.0%/)).toBeInTheDocument();
});

test('n ผสมกัน → โชว์ error ที่ backend ส่งมา แทนที่จะวาดกราฟผิด ๆ', () => {
  render(<ControlChart chart={{
    checkpoint: checkpoint(), mode: null, points: [], limits: null,
    capability: null, violations: [],
    error: 'subgroup ในช่วงนี้มีขนาดไม่เท่ากัน (n = 3, 5) — ต้อง re-baseline',
  }} />);

  expect(screen.getByText(/ขนาดไม่เท่ากัน/)).toBeInTheDocument();
});

test('ยังไม่มีข้อมูล → ไม่พัง', () => {
  render(<ControlChart chart={{
    checkpoint: checkpoint(), mode: 'xbar-r', points: [], limits: null,
    capability: null, violations: [],
  }} />);

  expect(screen.getByText(/ยังไม่มีข้อมูลค่าวัด/)).toBeInTheDocument();
});

// ── สองเทสนี้คุมสิ่งที่เพิ่มเข้ามาตอนรีดีไซน์ ──────────────────────────────

test('กฎ Nelson ที่ผิด ต้องอ่านได้เป็นข้อความโดยไม่ต้อง hover', () => {
  // ⚠️ ของเดิมข้อมูลนี้อยู่ใน tooltip อย่างเดียว จอสัมผัสหน้าไลน์แตะไม่ติด
  //    และ ResponsiveContainer ใน jsdom สูง 0 ทุกอย่างในกราฟจึงเทสไม่ได้เลย
  //    รายการกฎต้องอยู่ "นอก" กราฟถึงจะทั้งใช้งานได้จริงและเทสได้
  render(<ControlChart chart={{
    checkpoint: checkpoint(), points: [point(0), point(1, { rules: [1, 5] }), point(2, { rules: [5] })],
    limits: limits(), capability, mode: 'xbar-r',
    violations: [{ index: 1, rules: [1, 5] }, { index: 2, rules: [5] }],
  }} />);

  expect(screen.getByText(/หลุด 3σ/)).toBeInTheDocument();
  // กฎข้อ 5 โดนสอง subgroup ต้องรวมเป็นบรรทัดเดียวแล้วบอกว่า subgroup ไหนบ้าง
  expect(screen.getByText(/2 ใน 3 จุดเกิน 2σ — subgroup 2, 3/)).toBeInTheDocument();
});

test('มีคำอธิบายเส้น แยก spec limit กับ control limit ออกจากกัน', () => {
  // แยกสองเส้นนี้ไม่ออก = อ่านกราฟผิดทั้งใบ (ดู CLAUDE.md "spec limit ≠ control limit")
  // ใช้ <Legend> ของ recharts ไม่ได้ เพราะมันรับ payload จาก Line เท่านั้น ReferenceLine ไม่ส่งเข้าไป
  render(<ControlChart chart={{
    checkpoint: checkpoint(), points: [point(0), point(1)],
    limits: limits(), capability, violations: [], mode: 'xbar-r',
  }} />);

  expect(screen.getByText(/spec limit \(USL\/LSL\)/)).toBeInTheDocument();
  expect(screen.getByText(/control limit \(UCL\/LCL\)/)).toBeInTheDocument();
});
