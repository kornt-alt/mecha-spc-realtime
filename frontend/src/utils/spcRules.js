// frontend/src/utils/spcRules.js — คำอธิบายกฎ OCS (Out of Control Signal) ชุดเดียวของฝั่ง client
//
// ตัวที่ "ตัดสิน" ว่าจุดไหนผิดกฎคือ ocsRules() ใน backend/services/spcStats.js
// ไฟล์นี้ไม่ตัดสินอะไรเลย มีแค่คำอธิบายว่ารหัสกฎที่ backend ส่งมาแปลว่าอะไร
//
// กฎชุดนี้ตามตาราง OCS ของชีต SC ในฟอร์ม SP-QC-214C ที่ QC ใช้อยู่ (แทนกฎ Nelson 8 ข้อของเดิม)
// ใช้กับทั้งกราฟ X̄ (หรือ I) และกราฟ R (หรือ MR) แยกกัน
//
// ⚠️ ลำดับใน OCS_RULES = ลำดับแถวของตาราง OCS บนหน้า /sc และใน Excel
//    และรหัส (id) ต้องตรงกับ OCS_RULE_IDS ใน backend/services/spcStats.js เป๊ะ
export const OCS_RULES = [
  {
    id: 'out',
    label: 'Out of UCL, LCL',
    short: 'หลุด UCL/LCL',
    when: '1 จุดอยู่นอกเส้น UCL หรือ LCL',
    means: 'มีอะไรเปลี่ยนแบบทันทีทันใด — เปลี่ยนเม็ดมีด ชนงาน ตั้งเครื่องใหม่ วัดผิด',
  },
  {
    id: 'shift_up',
    label: 'Shift (7 Upper CL)',
    short: '7 จุดเหนือ CL',
    when: '7 จุดติดกันอยู่เหนือเส้นกลาง (CL)',
    means: 'ค่ากลางเลื่อนขึ้นทั้งชุด แม้ยังไม่มีจุดไหนหลุดเส้น — เปลี่ยนล็อตวัตถุดิบ เปลี่ยนคนตั้งเครื่อง',
  },
  {
    id: 'shift_down',
    label: 'Shift (7 Lower CL)',
    short: '7 จุดใต้ CL',
    when: '7 จุดติดกันอยู่ใต้เส้นกลาง (CL)',
    means: 'ค่ากลางเลื่อนลงทั้งชุด — สาเหตุแบบเดียวกับข้อบน',
  },
  {
    id: 'trend_up',
    label: 'Trend (6 point Up)',
    short: '6 จุดไต่ขึ้น',
    when: '6 จุดติดกันไต่ขึ้นตลอด',
    means: 'มีอะไรค่อย ๆ เปลี่ยนไปทางเดียว — เม็ดมีดสึก อุณหภูมิไต่ขึ้น',
  },
  {
    id: 'trend_down',
    label: 'Trend (6 point Down)',
    short: '6 จุดไต่ลง',
    when: '6 จุดติดกันไต่ลงตลอด',
    means: 'มีอะไรค่อย ๆ เปลี่ยนไปทางเดียว — เม็ดมีดสึก อุณหภูมิลดลง',
  },
  {
    id: 'alt14',
    label: 'Alternate 14 point',
    short: '14 จุดสลับขึ้นลง',
    when: '14 จุดติดกันสลับขึ้นลงทุกจุด',
    means: 'มีสองอย่างสลับกันอยู่ — สลับหัวจับ สลับคน สลับกะ หรือวัดคนละเครื่องมือ',
  },
];

export const RULE_BY_ID = Object.fromEntries(OCS_RULES.map((r) => [r.id, r]));

// ชื่อกราฟตามโหมด — ตาราง OCS / Event Log ใช้บอกว่าจุดนี้ผิดกฎบนกราฟไหน
export const chartLabel = (chart, isImr) =>
  chart === 'range' ? (isImr ? 'MR' : 'R') : (isImr ? 'I' : 'X̄');
