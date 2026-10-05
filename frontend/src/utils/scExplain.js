// คำอธิบายที่มาของตัวเลขแต่ละช่องบนหน้า SC (tooltip + ไฮไลต์ช่องต้นทาง) — pure
//
// ⚠️ แทนค่าตัวเลขที่ server ส่งมาเท่านั้น ไม่คำนวณสถิติใหม่ — ผลท้ายสูตรคือค่าเดียวกับที่ช่องโชว์เสมอ
//    ค่าคงที่ A2/D3/D4/d₂/E2 มาจาก limits.constants ของ backend ห้ามถือตารางไว้ฝั่งนี้
//    ที่ทำเองมีแค่หาว่าช่องไหนเป็น max/min เพื่อไฮไลต์ (แสดงผลล้วน หลักเดียวกับ outOfSpec)
//
// key ของช่อง:  v:<i>:<k> ค่าวัด · x:<i> X̄/X · r:<i> R/MR · stat:<name> กล่องสถิติ
//               lim:<ucl|cl|lcl|rucl|rcl|rlcl> หัวกระดาษ · spec:<usl|lsl>
//               k:<n>:<A2|D3|D4|d2> ตารางค่าคงที่ · k:imr:E2 (I-MR อ้างแถว n = 2)
// explain(key, { chart, cp }) → { title, lines: [string], sources: [key] } หรือ null

import { fmt, fmtCap } from '../components/XbarRCharts';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const k3 = (v) => (isNum(v) ? v.toFixed(3) : '—'); // ค่าคงที่ A2/d₂ ฯลฯ

const valueCells = (points) =>
  points.flatMap((p) => (p.values ?? []).map((v, k) => ({ key: `v:${p.index}:${k}`, v })).filter((c) => isNum(c.v)));

export const explain = (key, { chart, cp }) => {
  if (!key || !chart?.limits) return null;
  const points = chart.points ?? [];
  const L = chart.limits;
  const st = chart.stats ?? {};
  const cap = chart.capability ?? {};
  const C = L.constants ?? {};
  const imr = L.mode === 'i-mr';
  const n = L.n;
  const usl = cp?.usl;
  const lsl = cp?.lsl;
  const XB = imr ? 'x̄' : 'x̿';
  const RB = imr ? 'M̄R' : 'R̄';
  const fromBaseline = Boolean(L.baselineUsed);
  // ลิมิตที่ล็อกไว้ไม่ได้มาจากข้อมูลบนจอ → ไม่ไฮไลต์อะไร บอกตรง ๆ แทน
  const limitSrc = (keys) => (fromBaseline ? [] : keys);
  // ช่องในตารางค่าคงที่ที่ถูกใช้ — I-MR อ้างแถว n = 2 (moving range ของค่าคู่ติดกัน)
  const kc = (col) => (col === 'E2' ? 'k:imr:E2' : `k:${imr ? 2 : n}:${col}`);
  const baselineNote = fromBaseline ? [`${XB} / ${RB} มาจาก baseline ที่ล็อกไว้ ไม่ใช่ข้อมูลในเดือนนี้`] : [];

  const [kind, a] = key.split(':');
  const i = Number(a);
  const p = points[i];

  if (kind === 'x' && p) {
    if (imr) return { title: 'X', lines: [`X = ค่าวัดของจุดนี้ = ${fmt(p.xbar)}`], sources: [`v:${i}:0`] };
    const cells = (p.values ?? []).map((v, k) => ({ v, k })).filter((c) => isNum(c.v));
    return {
      title: `X̄ ของ subgroup #${p.subgroupNo}`,
      lines: ['X̄ = ผลรวมค่าวัด / n', `= (${cells.map((c) => c.v).join(' + ')}) / ${cells.length} = ${fmt(p.xbar)}`],
      sources: cells.map((c) => `v:${i}:${c.k}`),
    };
  }

  if (kind === 'r' && p) {
    if (imr) {
      if (i === 0 || !isNum(p.range)) return { title: 'MR', lines: ['จุดแรกไม่มี MR (ไม่มีจุดก่อนหน้า)'], sources: [] };
      return {
        title: 'MR',
        lines: ['MR = |X ของจุดนี้ − X ของจุดก่อนหน้า|', `= |${fmt(p.xbar)} − ${fmt(points[i - 1].xbar)}| = ${fmt(p.range)}`],
        sources: [`v:${i}:0`, `v:${i - 1}:0`],
      };
    }
    const cells = (p.values ?? []).map((v, k) => ({ v, k })).filter((c) => isNum(c.v));
    if (cells.length < 2) return { title: 'R', lines: ['ค่าวัดไม่ครบ คิด R ไม่ได้'], sources: [] };
    const hi = cells.reduce((m, c) => (c.v > m.v ? c : m));
    // ค่าเท่ากันทั้งคู่ (R = 0) ต้องได้คนละช่อง ไม่งั้นไฮไลต์ช่องเดียว
    const lo = cells.filter((c) => c !== hi).reduce((m, c) => (c.v < m.v ? c : m));
    return {
      title: `R ของ subgroup #${p.subgroupNo}`,
      lines: ['R = ค่ามากสุด − ค่าน้อยสุด', `= ${hi.v} − ${lo.v} = ${fmt(p.range)}`],
      sources: [`v:${i}:${hi.k}`, `v:${i}:${lo.k}`],
    };
  }

  if (kind === 'spec') return null;

  if (kind === 'stat') {
    const vals = valueCells(points);
    switch (a) {
      case 'n':
        return {
          title: 'n',
          lines: [`จำนวนชิ้นต่อ subgroup = ${n}`, imr ? 'n = 1 จึงใช้กราฟ I-MR' : `ใช้เปิดตารางค่าคงที่ A2/D3/D4/d₂ ของ n = ${n}`],
          sources: [...(points[0]?.values ?? []).map((_, k) => `v:0:${k}`), ...(imr ? [] : ['A2', 'D3', 'D4', 'd2'].map(kc))],
        };
      case 'count':
        return { title: 'ค่าวัดทั้งหมด', lines: [`นับค่าวัดทุกช่อง = ${st.count}`], sources: vals.map((c) => c.key) };
      case 'subgroups':
        return { title: 'Subgroup', lines: [`จำนวนจุดบนกราฟ = ${st.subgroups}`], sources: points.map((q) => `x:${q.index}`) };
      case 'max':
      case 'min': {
        const target = a === 'max' ? st.max : st.min;
        return {
          title: a === 'max' ? 'Max' : 'Min',
          lines: [`${a === 'max' ? 'ค่ามากสุด' : 'ค่าน้อยสุด'}จากค่าวัด ${st.count} ค่า = ${fmt(target)}`],
          sources: vals.filter((c) => c.v === target).map((c) => c.key),
        };
      }
      case 'xbarbar':
        return {
          title: XB,
          lines: [`${XB} = เฉลี่ย ${imr ? 'X' : 'X̄'} ของ ${st.subgroups} จุด (ช่องที่ไฮไลต์) = ${fmt(st.xbarbar)}`],
          sources: points.map((q) => `x:${q.index}`),
        };
      case 'rbar': {
        const rs = points.filter((q) => isNum(q.range));
        return {
          title: RB,
          lines: [`${RB} = เฉลี่ย ${imr ? 'MR' : 'R'} ของ ${rs.length} จุด (ช่องที่ไฮไลต์) = ${fmt(st.rbar)}`],
          sources: rs.map((q) => `r:${q.index}`),
        };
      }
      case 'sigma':
        return {
          title: 'σ ภายใน subgroup',
          lines: [`σ = ${RB} / d₂`, `= ${fmt(L.rbar)} / ${k3(C.d2)} = ${fmt(cap.sigmaWithin, 5)}`, ...baselineNote],
          sources: [...limitSrc(['stat:rbar']), kc('d2')],
        };
      case 'cp':
        if (!isNum(usl) || !isNum(lsl)) return { title: 'Cp', lines: ['สเปกด้านเดียว คิด Cp ไม่ได้ ดู Cpk แทน'], sources: [] };
        return {
          title: 'Cp',
          lines: ['Cp = (USL − LSL) / 6σ', `= (${usl} − ${lsl}) / (6 × ${fmt(cap.sigmaWithin, 5)}) = ${fmtCap(cap.cp)}`],
          sources: ['spec:usl', 'spec:lsl', 'stat:sigma'],
        };
      case 'cpu':
        if (!isNum(usl)) return { title: 'Cpu', lines: ['ไม่มี USL'], sources: [] };
        return {
          title: 'Cpu',
          lines: ['Cpu = (USL − ค่าเฉลี่ย) / 3σ', `= (${usl} − ${fmt(cap.mean)}) / (3 × ${fmt(cap.sigmaWithin, 5)}) = ${fmtCap(cap.cpu)}`],
          sources: ['spec:usl', 'stat:xbarbar', 'stat:sigma'],
        };
      case 'cpl':
        if (!isNum(lsl)) return { title: 'Cpl', lines: ['ไม่มี LSL'], sources: [] };
        return {
          title: 'Cpl',
          lines: ['Cpl = (ค่าเฉลี่ย − LSL) / 3σ', `= (${fmt(cap.mean)} − ${lsl}) / (3 × ${fmt(cap.sigmaWithin, 5)}) = ${fmtCap(cap.cpl)}`],
          sources: ['spec:lsl', 'stat:xbarbar', 'stat:sigma'],
        };
      case 'cpk': {
        const sides = [isNum(cap.cpu) && `Cpu ${fmtCap(cap.cpu)}`, isNum(cap.cpl) && `Cpl ${fmtCap(cap.cpl)}`].filter(Boolean);
        return {
          title: 'Cpk',
          lines: sides.length === 2
            ? ['Cpk = ค่าที่น้อยกว่าระหว่าง Cpu กับ Cpl', `= min(${sides.join(', ')}) = ${fmtCap(cap.cpk)}`]
            : [`สเปกด้านเดียว Cpk = ${sides[0] ?? '—'}`],
          sources: ['stat:cpu', 'stat:cpl'],
        };
      }
      case 'pp':
        return {
          title: 'Pp / Ppk',
          lines: [
            `ใช้ s = SD ของค่าวัดทั้ง ${st.count} ค่า = ${fmt(cap.sigmaOverall, 5)} (ไม่ใช่ ${RB}/d₂)`,
            'Pp = (USL − LSL) / 6s · Ppk = min((USL − ค่าเฉลี่ย) / 3s, (ค่าเฉลี่ย − LSL) / 3s)',
            `= ${fmtCap(cap.pp)} / ${fmtCap(cap.ppk)}`,
          ],
          sources: [...vals.map((c) => c.key), 'spec:usl', 'spec:lsl'],
        };
      default:
        return null;
    }
  }

  if (kind === 'lim') {
    const x = fmt(L.xbarbar);
    const r = fmt(L.rbar);
    const both = [...limitSrc(['stat:xbarbar', 'stat:rbar']), kc(imr ? 'E2' : 'A2')];
    const spread = imr ? `E2 × ${RB}` : `A2 × ${RB}`;
    const kx = imr ? C.E2 : C.A2;
    const rows = {
      cl: [`CL = ${XB}`, `= ${fmt(L.center)}`, limitSrc(['stat:xbarbar'])],
      ucl: [`UCL = ${XB} + ${spread}`, `= ${x} + ${k3(kx)} × ${r} = ${fmt(L.ucl)}`, both],
      lcl: [`LCL = ${XB} − ${spread}`, `= ${x} − ${k3(kx)} × ${r} = ${fmt(L.lcl)}`, both],
      rcl: [`CL = ${RB}`, `= ${fmt(L.rangeCenter)}`, limitSrc(['stat:rbar'])],
      rucl: [`UCL = D4 × ${RB}`, `= ${k3(C.D4)} × ${r} = ${fmt(L.rangeUcl)}`, [...limitSrc(['stat:rbar']), kc('D4')]],
      rlcl: [`LCL = D3 × ${RB}`, `= ${k3(C.D3)} × ${r} = ${fmt(L.rangeLcl)}`, [...limitSrc(['stat:rbar']), kc('D3')]],
    };
    const row = rows[a];
    if (!row) return null;
    const chartName = a.startsWith('r') ? (imr ? 'MR' : 'R') : imr ? 'I' : 'X̄';
    return { title: `${chartName} Chart`, lines: [row[0], row[1], ...baselineNote], sources: row[2] };
  }

  return null;
};
