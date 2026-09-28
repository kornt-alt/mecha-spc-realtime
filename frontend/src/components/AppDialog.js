// frontend/src/components/AppDialog.js — กล่องยืนยัน/แจ้งเตือนกลางของทั้งแอป
//
// ใช้คู่กับ utils/useDialog.js เสมอ (สเตตอยู่ที่นั่น ที่นี่วาดอย่างเดียว)
// รูปแบบลอกมาจาก ConfirmModal ของ MSE_AUTO_PLAN ที่ใช้อยู่จริงในเครือ แต่ตัดสองอย่างออก:
// ไอคอน bi-* (โปรเจกต์นี้ถอด bootstrap-icons ทิ้งไปแล้ว ไม่มี <i class="bi"> สักตัว)
// และ propTypes (prop-types ไม่ใช่ dependency ตรงของโปรเจกต์นี้)
import React, { useEffect, useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';

const AppDialog = ({ dialog, onHide }) => {
  const [value, setValue] = useState('');
  const [form, setForm] = useState({});

  const kind = dialog?.kind ?? 'alert';
  const isPrompt = kind === 'prompt';
  const isForm = kind === 'form';
  const isAlert = kind === 'alert';
  const fields = isForm ? (dialog.fields ?? []) : [];

  // ล้างช่องกรอกทุกครั้งที่เปลี่ยนกล่อง — ค่าของใบที่แล้วต้องไม่ค้างมาให้กดยืนยันซ้ำ
  useEffect(() => {
    setValue('');
    setForm(Object.fromEntries((dialog?.fields ?? []).map((f) => [f.name, f.defaultValue ?? ''])));
  }, [dialog]);

  const trimmed = value.trim();
  const formOk = fields
    .filter((f) => f.required)
    .every((f) => String(form[f.name] ?? '').trim() !== '');
  const canConfirm = (!isPrompt || trimmed !== '') && (!isForm || formOk);

  // ⚠️ ปิดกล่อง "ก่อน" เรียก onConfirm เสมอ ห้ามสลับลำดับ
  //    onConfirm หลายตัวยิง API แล้วเปิดกล่อง error ใบใหม่ตอน throw — ถ้าปิดทีหลัง
  //    กล่องเก่าจะค้างทับ (บั๊กแบบเดียวกับที่ BaselineModal เป็นอยู่ตอน confirmBaseline ล้ม)
  const confirm = () => {
    if (!canConfirm) return;
    const action = dialog?.onConfirm;
    const payload = isForm
      // ⚠️ ช่อง password ไม่ trim — ช่อง login ไม่ trim รหัสผ่าน ถ้าตรงนี้ตัดช่องว่างหัวท้ายทิ้ง
      //    คนที่ตั้งรหัสลงท้ายด้วยเว้นวรรคจะ login ไม่ได้อีกเลย
      ? Object.fromEntries(fields.map((f) => [
        f.name, f.type === 'password' ? String(form[f.name] ?? '') : String(form[f.name] ?? '').trim(),
      ]))
      : trimmed;
    onHide();
    action?.(payload);
  };

  return (
    // ⚠️ animation={false} โดยตั้งใจ — Fade ตั้ง setTimeout รอ transitionend ซึ่งยิง setState
    //    หลังเทสจบ act() ทุกเคสที่เปิดกล่อง · ปิดแล้วกล่องขึ้นทันที ซึ่งบนแท็บเล็ตหน้างานก็ดีกว่า
    //    (ผลข้างเคียง: onEntered จะไม่ถูกเรียกเลย ห้ามเอามาใช้จัดโฟกัส ใช้ autoFocus ที่ element)
    <Modal show={Boolean(dialog)} onHide={onHide} centered animation={false}>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>{dialog?.title}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {/* ข้อความเดิมหลายอันมี \n\n คั่นอยู่แล้ว ย้ายมาดิบ ๆ ต้องยังขึ้นบรรทัดเหมือนเดิม */}
        {dialog?.body && <div style={{ whiteSpace: 'pre-line' }}>{dialog.body}</div>}

        {isForm && fields.map((f, i) => (
          <Form.Group key={f.name} controlId={`app-dialog-${f.name}`} className="mt-3">
            <Form.Label className="small mb-1">
              {f.label}{f.required && <span className="text-danger"> *</span>}
            </Form.Label>
            {f.options ? (
              <Form.Select
                value={form[f.name] ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
              >
                <option value="">{f.placeholder ?? '— เลือก —'}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Form.Select>
            ) : (
              <Form.Control
                autoFocus={i === 0}
                type={f.type ?? 'text'}
                placeholder={f.placeholder}
                value={form[f.name] ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); confirm(); }
                }}
              />
            )}
            {f.hint && <Form.Text>{f.hint}</Form.Text>}
          </Form.Group>
        ))}

        {isPrompt && (
          <Form.Group controlId="app-dialog-input" className="mt-3">
            <Form.Label className="small mb-1">{dialog.inputLabel}</Form.Label>
            {/* autoFocus ทำงานได้จริงกับ <Modal> — React ใส่โฟกัสตอน commit ซึ่งเกิดก่อน
                effect ของ Modal แล้ว Modal มี guard ว่าถ้าโฟกัสอยู่ในกล่องแล้วจะไม่ย้ายซ้ำ */}
            <Form.Control
              autoFocus
              value={value}
              aria-describedby="app-dialog-hint"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); confirm(); }
              }}
            />
            {/* ⚠️ ห้ามเป็น <Alert> — ของ react-bootstrap พ่วง role="alert" มาด้วย และมีเทส
                ที่ยืนยันว่าทั้งหน้าต้องไม่มี alert สักตัวตอนสเปกด้านเดียว */}
            {dialog.inputHint && (
              <Form.Text id="app-dialog-hint">{dialog.inputHint}</Form.Text>
            )}
          </Form.Group>
        )}
      </Modal.Body>

      <Modal.Footer>
        {/* ⚠️ โฟกัสเริ่มต้นอยู่ที่ปุ่มปิด/ยกเลิกสำหรับ confirm และ alert — กด Enter รัว ๆ
            มาจากหน้าก่อนต้องไม่ไปโดนปุ่มลบ · prompt/form ยกโฟกัสให้ช่องกรอกแรกแทน ไม่งั้นเสียคลิกฟรี */}
        <Button variant="secondary" autoFocus={!isPrompt && !isForm} onClick={onHide}>
          {dialog?.cancelLabel ?? (isAlert ? 'ปิด' : 'ยกเลิก')}
        </Button>
        {!isAlert && (
          <Button
            variant={dialog?.variant ?? 'primary'}
            disabled={!canConfirm}
            onClick={confirm}
          >
            {dialog?.confirmLabel ?? 'ยืนยัน'}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default AppDialog;
