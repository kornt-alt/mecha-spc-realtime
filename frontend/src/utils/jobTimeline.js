// utils/jobTimeline.js — ช่วงเวลาของงาน Set up จาก check_job_events (pure · ไม่แตะ React/DB)
//
// Korn สั่ง 2026-11-19: เก็บเวลาแต่ละขั้นแล้วโชว์เป็น timeline
//   PD: เปิดงาน/ถูกตีกลับ → Set up & Adjust → pd_start_check → PD เช็คงาน → ส่ง QC / ตัดสินเอง
//   QC: ส่งแล้ว → รอ QC รับงาน → qc_accept → รอเริ่มเช็ค → qc_start_check → QC เช็คงาน → ผ่าน / ไม่ผ่าน
// ⚠️ ตัวคิดช่วงเวลามีที่นี่ที่เดียว (หน้า JobDetail + ป้ายในคิว) — แค่ลบเวลาของ event ไม่ตัดสินอะไร
// ⚠️ งานก่อนมี *_start_check (ก่อน 2026-11-19) → ช่วงของ PD รวมเป็น pd_legacy "PD (ไม่ได้แยกเวลา)"

export const SEGMENTS = {
  adjust: { label: 'Set up & Adjust', who: 'PD' },
  pd_check: { label: 'PD เช็คงาน', who: 'PD' },
  pd_legacy: { label: 'PD (ไม่ได้แยกเวลา)', who: 'PD' },
  wait_qc: { label: 'รอ QC รับงาน', who: 'QC' },
  qc_wait: { label: 'QC รับแล้ว รอเริ่มเช็ค', who: 'QC' },
  qc_check: { label: 'QC เช็คงาน', who: 'QC' },
};
export const TOTAL_KEYS = ['adjust', 'pd_check', 'wait_qc', 'qc_wait', 'qc_check'];

const ts = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
export const minutesBetween = (from, to) => {
  const a = ts(from);
  const b = ts(to);
  return a === null || b === null ? null : Math.max(0, (b - a) / 60000);
};

// "45 นาที" · "1 ชม. 12 นาที" · "2 วัน 3 ชม." · ต่ำกว่า 1 นาที = "< 1 นาที"
export const fmtDuration = (min) => {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—';
  const m = Math.floor(min);
  if (m < 1) return '< 1 นาที';
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} ชม. ${m % 60} นาที` : `${Math.floor(h / 24)} วัน ${h % 24} ชม.`;
};

const PD_END = ['pd_submit', 'pd_pass', 'pd_reject'];
const QC_END = ['qc_pass', 'qc_reject'];
const OUTCOME = { qc_pass: 'pass', pd_pass: 'pass', qc_reject: 'reject', pd_reject: 'reject', cancel: 'cancel' };

// events: แถวจาก GET /check-jobs/:id (เรียงตามเวลา) · flow: pd_qc | pd | qc · now: ms (ช่วงที่ยังเดินนับถึงตรงนี้)
// คืน { rounds: [{ round, segments: [{ key, label, who, from, to, minutes, running, by }], outcome, end }], totals, leadMinutes, closed }
export const buildTimeline = (events, flow = 'pd_qc', now = Date.now()) => {
  const list = [...(events ?? [])].sort((a, b) => (ts(a.at) - ts(b.at)) || (Number(a.id) - Number(b.id)));
  const byRound = new Map();
  for (const e of list) {
    const r = Number(e.round_no) || 1;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(e);
  }
  const roundNos = [...byRound.keys()].sort((a, b) => a - b);
  const nowIso = new Date(now).toISOString();
  const closedEv = list.find((e) => ['qc_pass', 'pd_pass', 'cancel'].includes(e.action));

  let prevEnd = null; // event ที่จบรอบก่อน (ตีกลับ) = จุดเริ่มรอบนี้
  const rounds = roundNos.map((round) => {
    const evs = byRound.get(round);
    const find = (actions) => evs.find((e) => actions.includes(e.action));
    const startEv = round === 1 ? find(['open']) : prevEnd;
    const cancel = find(['cancel']);
    const segs = [];
    // ช่วงหนึ่งช่วง — ไม่มีจุดจบ: งานยังไม่ปิด = กำลังเดิน (นับถึง now) · งานถูกยกเลิก = จบที่ cancel
    const push = (key, fromEv, toEv) => {
      if (!fromEv) return;
      const endEv = toEv ?? cancel ?? null;
      const running = !endEv && !closedEv;
      if (!endEv && !running) return;
      const to = endEv ? endEv.at : nowIso;
      segs.push({
        key, ...SEGMENTS[key], from: fromEv.at, to: endEv ? endEv.at : null, running,
        minutes: minutesBetween(fromEv.at, to), by: fromEv.user_name, byEnd: endEv?.user_name ?? null,
      });
    };

    const pdStart = find(['pd_start_check']);
    const pdEnd = find(PD_END);
    const qcAccept = find(['qc_accept']);
    const qcStart = find(['qc_start_check']);
    const qcEnd = find(QC_END);

    if (flow !== 'qc') {
      if (pdStart) {
        push('adjust', startEv, pdStart);
        push('pd_check', pdStart, pdEnd);
      } else if (pdEnd || !startEv) {
        // งานเก่า: มีจุดจบ PD แต่ไม่มี start → รวมเป็นช่วงเดียว
        push('pd_legacy', startEv, pdEnd);
      } else {
        push('adjust', startEv, null);
      }
      if (flow === 'pd_qc' && pdEnd?.action === 'pd_submit') {
        push('wait_qc', pdEnd, qcAccept);
      }
    }
    // flow qc: รอบ 1 qc_accept เขียนตอนเปิดงาน · รอบถัดไปไม่มี accept ใหม่ = เริ่มที่จุดตีกลับ
    const qcFrom = qcAccept ?? (flow === 'qc' && round > 1 ? startEv : null);
    if (qcFrom) {
      if (qcStart) {
        push('qc_wait', qcFrom, qcStart);
        push('qc_check', qcStart, qcEnd);
      } else if (qcEnd) {
        push('qc_check', qcFrom, qcEnd); // งานเก่า: รับ = เริ่มเช็ค
      } else {
        push('qc_wait', qcFrom, null);
      }
    }

    const endEv = qcEnd ?? (pdEnd && pdEnd.action !== 'pd_submit' ? pdEnd : null) ?? cancel ?? null;
    prevEnd = endEv && OUTCOME[endEv.action] === 'reject' ? endEv : null;
    return { round, start: startEv?.at ?? null, segments: segs, outcome: endEv ? OUTCOME[endEv.action] : null, end: endEv };
  });

  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]));
  let legacy = 0;
  for (const r of rounds) {
    for (const s of r.segments) {
      if (s.key === 'pd_legacy') legacy += s.minutes ?? 0;
      else totals[s.key] += s.minutes ?? 0;
    }
  }
  if (legacy) totals.pd_legacy = legacy;
  const openEv = list.find((e) => e.action === 'open');
  return {
    rounds,
    totals,
    closed: Boolean(closedEv),
    leadMinutes: openEv ? minutesBetween(openEv.at, closedEv ? closedEv.at : nowIso) : null,
  };
};
