// frontend/src/components/StationBar.js — แถบ "สถานี" ด้านบนใบตรวจ
//
// เครื่องหนึ่งเครื่องยืนตรวจรุ่นเดิม เครื่องจักรเดิม คนเดิม ทั้งกะ ของเดิมให้เลือกใหม่
// ทุกครั้งที่เปิดหน้า = 4 คลิกที่ทิ้งเปล่าทุกใบ ตอนนี้จำไว้ (utils/station.js) แล้วแสดงเป็น
// บรรทัดเดียว มีปุ่มเปลี่ยนไว้ตอนย้ายรุ่น/สลับกะเท่านั้น
import React, { useState } from 'react';
import { Row, Col, Form, Button } from 'react-bootstrap';
import { SHIFTS } from '../utils/config';

const shiftLabel = (code) => SHIFTS.find((s) => s.code === code)?.label ?? '—';

// เครื่องจักรกับผู้ตรวจผูกกับ division ตัดให้เหลือเฉพาะของ division ที่รุ่นนี้อยู่
// จะได้ไม่ต้องเลื่อนหาในลิสต์ยาว ๆ — แต่ถ้ากรองแล้วว่าง (ข้อมูล master ยังไม่ครบ)
// ให้แสดงทั้งหมดไว้ก่อน ดีกว่าปล่อยให้เลือกอะไรไม่ได้เลย
const scopeToDivision = (list, divisionId) => {
  if (!divisionId) return list;
  const scoped = list.filter((row) => String(row.division_id) === String(divisionId));
  return scoped.length > 0 ? scoped : list;
};

const StationBar = ({ station, models, machines, inspectors, onChange, ready }) => {
  const [editing, setEditing] = useState(false);

  const model = models.find((m) => String(m.id) === station.modelId);
  const machine = machines.find((m) => String(m.id) === station.machineId);
  const inspector = inspectors.find((i) => String(i.id) === station.inspectorId);

  const divisionId = model?.division_id;
  const machineOptions = scopeToDivision(machines, divisionId);
  const inspectorOptions = scopeToDivision(inspectors, divisionId);

  // ยังตั้งไม่ครบ = กางแผงค้างไว้ ไม่ต้องให้กดหา
  const open = editing || !ready;

  const set = (key) => (e) => onChange({ ...station, [key]: e.target.value });

  // เปลี่ยนรุ่นแล้วเครื่อง/ผู้ตรวจของ division เดิมอาจใช้ไม่ได้ ล้างทิ้งให้เลือกใหม่
  const setModel = (e) => {
    const modelId = e.target.value;
    const nextDivision = models.find((m) => String(m.id) === modelId)?.division_id;
    const stillValid = (list, id) =>
      id && list.some((r) => String(r.id) === id && String(r.division_id) === String(nextDivision));
    onChange({
      ...station,
      modelId,
      machineId: stillValid(machines, station.machineId) ? station.machineId : '',
      inspectorId: stillValid(inspectors, station.inspectorId) ? station.inspectorId : '',
    });
  };

  return (
    <div className="station">
      <div className="station__row">
        {model ? (
          <>
            <span className="station__model">{model.item_no}</span>
            <span className="text-muted">{model.item_name}</span>
          </>
        ) : (
          <span className="station__model text-muted">ยังไม่ได้เลือก item</span>
        )}

        {ready && !open && (
          <div className="station__facts">
            <span className="station__fact">M/C <b>{machine?.code ?? '—'}</b></span>
            <span className="station__fact">Shift <b>{shiftLabel(station.shift)}</b></span>
            <span className="station__fact">ผู้ตรวจสอบ <b>{inspector?.name ?? '—'}</b></span>
          </div>
        )}

        <div className="ms-auto">
          <Button
            variant={open ? 'secondary' : 'outline-primary'}
            size="sm"
            onClick={() => setEditing((v) => !v)}
            disabled={!ready && open}
          >
            {open ? 'ปิดแผงตั้งค่า' : 'เปลี่ยนการเช็ค'}
          </Button>
        </div>
      </div>

      {open && (
        <Row className="g-2 mt-1">
          <Col md={4}>
            <Form.Label className="small mb-1 text-muted">Item No.</Form.Label>
            <Form.Select value={station.modelId} onChange={setModel}>
              <option value="">— เลือก item —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.item_no} — {m.item_name} ({m.division_name})</option>
              ))}
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label className="small mb-1 text-muted">เครื่อง</Form.Label>
            <Form.Select value={station.machineId} onChange={set('machineId')}>
              <option value="">— เลือกเครื่อง —</option>
              {machineOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.code} {m.name ? `(${m.name})` : ''}</option>
              ))}
            </Form.Select>
          </Col>
          <Col md={2}>
            <Form.Label className="small mb-1 text-muted">กะ</Form.Label>
            <Form.Select value={station.shift} onChange={set('shift')}>
              {SHIFTS.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label className="small mb-1 text-muted">ผู้ตรวจ</Form.Label>
            <Form.Select value={station.inspectorId} onChange={set('inspectorId')}>
              <option value="">— เลือกผู้ตรวจ —</option>
              {inspectorOptions.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </Form.Select>
          </Col>
          <Col xs={12}>
            <div className="small text-muted">
              ค่าที่เลือกไว้จะถูกจำไว้ในเครื่องนี้ เปิดหน้าครั้งหน้าไม่ต้องเลือกใหม่
            </div>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default StationBar;
