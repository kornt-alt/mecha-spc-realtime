// frontend/src/utils/spcRules.js — คำอธิบายกฎ OCS (Out of Control Signal) ชุดเดียวของฝั่ง client
//
// ตัวที่ "ตัดสิน" ว่าจุดไหนผิดกฎคือ ocsRules() ใน backend/services/spcStats.js
// ไฟล์นี้ไม่ตัดสินอะไรเลย มีแค่คำอธิบายว่ารหัสกฎที่ backend ส่งมาแปลว่าอะไร
//
// กฎชุดนี้ตามคู่มือ "ลักษณะกราฟที่ไม่อยู่ภายใต้การควบคุม" (8 กฎ · `no` = เลขข้อในคู่มือ)
//   Mechanical Div. ใช้กฎ 1-4 · MAMM ใช้ครบ 8 — ชุดที่ใช้ตั้งที่ลูกค้า (customers.ocs_rule_set)
//   และมากับผลกราฟเป็น chart.ocs = { ruleSet, xbar: [ids], range: [ids] }
//   กฎ 5-8 (โซน σ) ใช้กับกราฟ X̄/I เท่านั้น · กฎ 1-4 ใช้กับทั้งกราฟบนและกราฟล่าง
//
// ⚠️ ลำดับใน OCS_RULES = ลำดับแถวของตาราง OCS บนหน้า /sc
//    และรหัส (id) ต้องตรงกับ OCS_RULE_IDS ใน backend/services/spcStats.js เป๊ะ
export const OCS_RULES = [
  {
    id: 'out',
    no: 1,
    label: 'Out of UCL, LCL',
    short: 'หลุด UCL/LCL',
    when: '1 จุดอยู่นอกเส้น UCL หรือ LCL',
    means: 'มีอะไรเปลี่ยนแบบทันทีทันใด — เปลี่ยนเม็ดมีด ชนงาน ตั้งเครื่องใหม่ วัดผิด',
  },
  {
    id: 'shift_up',
    no: 2,
    label: 'Shift (7 Upper CL)',
    short: '7 จุดเหนือ CL',
    when: '7 จุดติดกันอยู่เหนือเส้นกลาง (CL)',
    means: 'ค่ากลางเลื่อนขึ้นทั้งชุด แม้ยังไม่มีจุดไหนหลุดเส้น — เปลี่ยนล็อตวัตถุดิบ เปลี่ยนคนตั้งเครื่อง',
  },
  {
    id: 'shift_down',
    no: 2,
    label: 'Shift (7 Lower CL)',
    short: '7 จุดใต้ CL',
    when: '7 จุดติดกันอยู่ใต้เส้นกลาง (CL)',
    means: 'ค่ากลางเลื่อนลงทั้งชุด — สาเหตุแบบเดียวกับข้อบน',
  },
  {
    id: 'trend_up',
    no: 3,
    label: 'Trend (7 point Up)',
    short: '7 จุดไต่ขึ้น',
    when: '7 จุดติดกันไต่ขึ้นตลอด',
    means: 'มีอะไรค่อย ๆ เปลี่ยนไปทางเดียว — เม็ดมีดสึก อุณหภูมิไต่ขึ้น',
  },
  {
    id: 'trend_down',
    no: 3,
    label: 'Trend (7 point Down)',
    short: '7 จุดไต่ลง',
    when: '7 จุดติดกันไต่ลงตลอด',
    means: 'มีอะไรค่อย ๆ เปลี่ยนไปทางเดียว — เม็ดมีดสึก อุณหภูมิลดลง',
  },
  {
    id: 'alt14',
    no: 4,
    label: 'Alternate 14 point',
    short: '14 จุดสลับขึ้นลง',
    when: '14 จุดติดกันสลับขึ้นลงทุกจุด',
    means: 'มีสองอย่างสลับกันอยู่ — สลับหัวจับ สลับคน สลับกะ หรือวัดคนละเครื่องมือ',
  },
  {
    id: 'zone_a',
    no: 5,
    label: '2 of 3 > 2σ (Zone A)',
    short: '2 ใน 3 เกิน 2σ',
    when: '2 ใน 3 จุดติดกันเกิน 2σ ฝั่งเดียวกัน',
    means: 'ค่ากลางเริ่มเลื่อน — เตือนก่อนจะหลุด UCL/LCL จริง',
  },
  {
    id: 'zone_b',
    no: 6,
    label: '4 of 5 > 1σ (Zone B)',
    short: '4 ใน 5 เกิน 1σ',
    when: '4 ใน 5 จุดติดกันเกิน 1σ ฝั่งเดียวกัน',
    means: 'ค่ากลางเลื่อนเล็กน้อยแต่ต่อเนื่อง — สาเหตุแบบเดียวกับ Shift',
  },
  {
    id: 'strat15',
    no: 7,
    label: '15 point in Zone C',
    short: '15 จุดใน ±1σ',
    when: '15 จุดติดกันอยู่ใน ±1σ (Zone C)',
    means: 'แคบผิดปกติ — subgroup ปนหลายแหล่ง ลิมิตกว้างเกินจริง หรือข้อมูลถูกปรับแต่ง',
  },
  {
    id: 'mix8',
    no: 8,
    label: '8 point out of Zone C (Mixture)',
    short: '8 จุดนอก ±1σ',
    when: '8 จุดติดกันอยู่นอก ±1σ (ฝั่งไหนก็ได้ ไม่มีจุดใน Zone C)',
    means: 'ข้อมูลผสมสองกลุ่ม — สองเครื่อง สองหัวจับ หรือสองแม่พิมพ์ปนกัน',
  },
];

export const RULE_BY_ID = Object.fromEntries(OCS_RULES.map((r) => [r.id, r]));

// กฎที่ใช้จริงของกราฟนี้ ตามลำดับแถว — ids มาจาก chart.ocs.xbar / .range
// ไม่มี ids (backend รุ่นเก่า) = กฎ 1-4 ชุดเดิม
export const rulesFor = (ids) =>
  (Array.isArray(ids) ? OCS_RULES.filter((r) => ids.includes(r.id)) : OCS_RULES.filter((r) => r.no <= 4));

// ชื่อชุดกฎ ใช้บนหัวฟอร์ม SC และหน้า Master
export const RULE_SET_LABEL = {
  basic: 'กฎ OCS ข้อ 1–4',
  full: 'กฎ OCS ครบ 8 ข้อ',
};

// ชื่อกราฟตามโหมด — ตาราง OCS / Event Log ใช้บอกว่าจุดนี้ผิดกฎบนกราฟไหน
export const chartLabel = (chart, isImr) =>
  chart === 'range' ? (isImr ? 'MR' : 'R') : (isImr ? 'I' : 'X̄');
