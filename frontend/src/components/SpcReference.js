// frontend/src/components/SpcReference.js — แผงอ้างอิง "สูตรกับกฎ" ของ control chart
//
// คนหน้าไลน์อ่านกราฟทุกกะแต่ไม่มีที่ให้เปิดดูว่า UCL มายังไง และกฎแต่ละข้อแปลว่าอะไร
// เดิมต้องไปถามหัวหน้าหรือเปิดคู่มือเล่มที่ไม่มีใครรู้ว่าอยู่ไหน — ย้ายมาไว้บนจอเดียวกับกราฟ
//
// ⚠️ แผงนี้เป็น "ข้อความอ้างอิง" ล้วน ไม่คำนวณอะไรทั้งนั้น และไม่รับข้อมูลจาก API เลย
//    ตัวเลขจริงทุกตัวยังมาจาก backend/services/spcStats.js ที่เดียวเหมือนเดิม
//
// ⚠️ ห้ามเอาค่า A₂ / D₃ / D₄ / d₂ / E₂ มาพิมพ์เป็นตัวเลขในนี้เด็ดขาด — ตาราง A2/D3/D4
//    ต้องมีชุดเดียวในระบบ (backend/services/spcConstants.js) มีสองชุดเมื่อไหร่คือรอวันที่
//    มันไม่ตรงกัน แล้วกราฟจะเพี้ยนแบบเงียบ ๆ โดยไม่มี error ให้เห็น · ในนี้เขียนเป็น "สัญลักษณ์"
//    เท่านั้น อยากเห็นตัวเลขให้ดูที่เส้นบนกราฟซึ่ง backend คำนวณมาให้แล้ว
//
// ⚠️ เนื้อในเรนเดอร์เฉพาะตอนเปิด ({open && ...}) ไม่ใช้ <Collapse> ของ react-bootstrap
//    ซึ่งคาลูกไว้ใน DOM ตลอด — คำอธิบายกฎในนี้เป็นข้อความชุดเดียวกับรายการกฎที่ผิดใต้กราฟ
//    ค้างอยู่ใน DOM เมื่อไหร่ getByText() ของเทสจะเจอสองที่แล้ว throw
import React, { useState } from 'react';
import { Card, Button } from 'react-bootstrap';
import { OCS_RULES } from '../utils/spcRules';

// แถวสูตรหนึ่งบรรทัด — ชื่อทางซ้าย สมการทางขวา
const F = ({ name, eq, note }) => (
  <div className="formula">
    <span className="formula__name">{name}</span>
    <span className="formula__eq num">{eq}</span>
    {note && <span className="formula__note">{note}</span>}
  </div>
);

const SpcReference = () => {
  const [open, setOpen] = useState(false);

  return (
    <Card className="spc-ref mb-3">
      <Card.Header className="py-1">
        <Button
          variant="link"
          size="sm"
          className="spc-ref__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? '▾' : '▸'} สูตรการคำนวณ และกฎของ control chart
        </Button>
      </Card.Header>

      {open && (
        <Card.Body className="spc-ref__body">
          {/* แกนของทั้งระบบ วางไว้บนสุดเพราะเข้าใจผิดข้อนี้แล้วอ่านกราฟผิดทั้งใบ */}
          <div className="spc-ref__callout">
            <b>spec limit ≠ control limit</b> — <b>USL/LSL</b> มาจากแบบ ใช้ตัดสินว่าชิ้นงาน
            OK/NG (เส้นแดงทึบ) · <b>UCL/LCL</b> คำนวณจากข้อมูลที่ผลิตได้จริง ใช้จับว่ากระบวนการ
            เปลี่ยนไปหรือยัง (เส้นเหลืองประ) · ชิ้นงานอยู่ในสเปกแต่ out of control ได้
            และหลุดสเปกทั้งที่ยัง in control ก็ได้ คนละเรื่องกัน
          </div>

          <div className="spc-ref__grid">
            <section>
              <h3 className="spc-ref__h">X̄-R chart — ใช้เมื่อสุ่มตรวจครั้งละหลายชิ้น (n ≥ 2)</h3>
              <F name="X̄ᵢ" eq="(x₁ + x₂ + … + xₙ) / n" note="ค่าเฉลี่ยของ subgroup ที่ i (1 ใบตรวจ = 1 subgroup)" />
              <F name="Rᵢ" eq="max(x) − min(x)" note="พิสัยของ subgroup ที่ i" />
              <F name="X̿" eq="(X̄₁ + X̄₂ + … + X̄ₖ) / k" note="เส้นกลางของกราฟบน" />
              <F name="R̄" eq="(R₁ + R₂ + … + Rₖ) / k" note="เส้นกลางของกราฟล่าง" />
              <F name="UCL / LCL ของ X̄" eq="X̿ ± A₂ · R̄" />
              <F name="UCL ของ R" eq="D₄ · R̄" />
              <F name="LCL ของ R" eq="D₃ · R̄" note="เป็น 0 เมื่อ n ≤ 6" />
              <F name="σ (ภายใน subgroup)" eq="R̄ / d₂" />
            </section>

            <section>
              <h3 className="spc-ref__h">I-MR chart — ใช้เมื่อสุ่มตรวจครั้งละชิ้นเดียว (n = 1)</h3>
              <F name="MRᵢ" eq="| xᵢ − xᵢ₋₁ |" note="พิสัยเคลื่อนที่ — จุดแรกไม่มีค่า" />
              <F name="x̄" eq="(x₁ + x₂ + … + xₖ) / k" note="เส้นกลางของกราฟบน" />
              <F name="M̄R" eq="(MR₂ + … + MRₖ) / (k − 1)" note="เส้นกลางของกราฟล่าง" />
              <F name="UCL / LCL ของ x" eq="x̄ ± E₂ · M̄R" />
              <F name="UCL ของ MR" eq="D₄ · M̄R" />
              <F name="LCL ของ MR" eq="0" />
              <F name="σ (ภายใน subgroup)" eq="M̄R / d₂" />
            </section>

            <section>
              <h3 className="spc-ref__h">ความสามารถของกระบวนการ</h3>
              <F name="Cp" eq="(USL − LSL) / (6 · σ_within)" />
              <F name="Cpk" eq="min( (USL − x̄) / 3σ_within , (x̄ − LSL) / 3σ_within )" />
              <F name="Pp" eq="(USL − LSL) / (6 · σ_overall)" />
              <F name="Ppk" eq="min( (USL − x̄) / 3σ_overall , (x̄ − LSL) / 3σ_overall )" />
              <p className="spc-ref__p">
                <b>Cp/Cpk</b> ใช้ σ ภายใน subgroup (R̄/d₂) = “ถ้ากระบวนการนิ่ง จะทำได้แค่ไหน” ·
                <b> Pp/Ppk</b> ใช้ส่วนเบี่ยงเบนมาตรฐานของค่าวัดทั้งหมดรวมกัน = “ที่ผ่านมาทำได้จริง
                แค่ไหน” · สองค่านี้ห่างกันมาก = ระหว่าง subgroup มีการเลื่อน กระบวนการยังไม่นิ่ง ·
                สเปกด้านเดียว (มีแค่ USL หรือแค่ LSL) คิด Cp ไม่ได้ แต่ Cpk ใช้ด้านที่มีได้
              </p>
            </section>

            <section>
              <h3 className="spc-ref__h">ค่าคงที่และเส้นกลาง</h3>
              <p className="spc-ref__p">
                <b>A₂ · D₃ · D₄ · d₂ · E₂</b> เป็นค่าคงที่มาตรฐานที่อ้างตามขนาด subgroup (n)
                ระบบเก็บไว้ชุดเดียวฝั่ง server และใช้ตัวเดียวกันทั้งตอนวาดกราฟและตอนล็อก baseline
                ตัวเลขที่คำนวณออกมาแล้วดูได้จากเส้นบนกราฟโดยตรง
              </p>
              <p className="spc-ref__p">
                เส้น UCL/LCL ที่ใช้อยู่จะถูก <b>freeze ไว้ตอนกด Set baseline</b> ที่หน้า Master
                Setup — ถ้าคำนวณใหม่จากข้อมูลทั้งหมดทุกครั้งที่เปิดกราฟ เส้นจะวิ่งตามกระบวนการที่
                ค่อย ๆ เลื่อน แล้วจะไม่มีวันเตือนอะไรเลย · ยังไม่ล็อก = ขึ้นคำว่า provisional
                และเส้นประจะห่างกว่าปกติ
              </p>
            </section>
          </div>

          <h3 className="spc-ref__h mt-3">กฎ OCS 6 ข้อ (ตามฟอร์ม SP-QC-214C) — จับว่ากระบวนการเปลี่ยน</h3>
          <p className="spc-ref__p">
            ใช้กับทั้งกราฟบน (X̄ / I) และกราฟล่าง (R / MR) แยกกัน ·
            ผิดกฎ = กระบวนการกำลังเปลี่ยน <b>ของยังไม่เสีย</b> (จึงเป็นสีเหลือง ไม่ใช่แดง)
            ต้องไปดูที่เครื่องก่อนที่จะมีของหลุดสเปกจริง แล้วบันทึกสาเหตุใน Event Log ที่หน้า SC Chart
          </p>
          <table className="spc-ref__rules">
            <thead>
              <tr>
                <th>กฎ</th>
                <th>ผิดเมื่อ</th>
                <th>มักแปลว่า</th>
              </tr>
            </thead>
            <tbody>
              {OCS_RULES.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.label}</b>
                  </td>
                  <td>{r.when}</td>
                  <td className="text-muted">{r.means}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card.Body>
      )}
    </Card>
  );
};

export default SpcReference;
