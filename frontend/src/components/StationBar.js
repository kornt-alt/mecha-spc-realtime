// frontend/src/components/StationBar.js — แถบ "สถานี" ด้านบนใบตรวจ
//
// เครื่องหนึ่งเครื่องยืนตรวจรุ่นเดิม เครื่องจักรเดิม คนเดิม ทั้งกะ ของเดิมให้เลือกใหม่
// ทุกครั้งที่เปิดหน้า = 4 คลิกที่ทิ้งเปล่าทุกใบ ตอนนี้จำไว้ (utils/station.js) แล้วแสดงเป็น
// บรรทัดเดียว มีปุ่มเปลี่ยนไว้ตอนย้ายรุ่น/สลับกะเท่านั้น
import React, { useState } from 'react';
import { Row, Col, Form, Button } from 'react-bootstrap';
import { SHIFTS } from '../utils/config';
import { useDialog } from '../utils/useDialog';
import SearchSelect from './SearchSelect';
import AppDialog from './AppDialog';

const shiftLabel = (code) => SHIFTS.find((s) => s.code === code)?.label ?? '—';

// เครื่องจักรกับผู้ตรวจผูกกับ division ตัดให้เหลือเฉพาะของ division ที่รุ่นนี้อยู่
// จะได้ไม่ต้องเลื่อนหาในลิสต์ยาว ๆ — แต่ถ้ากรองแล้วว่าง (ข้อมูล master ยังไม่ครบ)
// ให้แสดงทั้งหมดไว้ก่อน ดีกว่าปล่อยให้เลือกอะไรไม่ได้เลย
const scopeToDivision = (list, divisionId) => {
  if (!divisionId) return list;
  const scoped = list.filter((row) => String(row.division_id) === String(divisionId));
  return scoped.length > 0 ? scoped : list;
};

const StationBar = ({
  station, models, machines, inspectors, divisions = [], onChange, onAddInspector, ready,
}) => {
  const [editing, setEditing] = useState(false);
  const { dialog, showAlert, showForm, closeDialog } = useDialog();

  const model = models.find((m) => String(m.id) === station.modelId);
  const machine = machines.find((m) => String(m.id) === station.machineId);
  const inspector = inspectors.find((i) => String(i.id) === station.inspectorId);

  const divisionId = model?.division_id;
  const machineOptions = scopeToDivision(machines, divisionId);
  const inspectorOptions = scopeToDivision(inspectors, divisionId);

  // ยังตั้งไม่ครบ = กางแผงค้างไว้ ไม่ต้องให้กดหา
  const open = editing || !ready;

  // ⚠️ SearchSelect ส่งค่ามาเป็นสตริงตรง ๆ ไม่ใช่ event ต่างจาก <Form.Select> ของกะ
  const setVal = (key) => (value) => onChange({ ...station, [key]: value });
  const setShift = (e) => onChange({ ...station, shift: e.target.value });

  // เปลี่ยนรุ่นแล้วเครื่อง/ผู้ตรวจของ division เดิมอาจใช้ไม่ได้ ล้างทิ้งให้เลือกใหม่
  const setModel = (modelId) => {
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

  // ⚠️ hint ไม่ใช่ของประดับ — ชื่อผู้ตรวจซ้ำกันได้และ item เลขเดียวกันมีได้ทั้งสอง division
  //    ข้อความตรงนี้คือสิ่งเดียวที่แยกสองแถวที่หน้าตาเหมือนกันออกจากกัน (และค้นหาได้ด้วย)
  const modelOpts = models.map((m) => ({
    value: String(m.id),
    label: `${m.item_no} — ${m.item_name}`,
    hint: m.division_name ?? '',
  }));
  const machineOpts = machineOptions.map((m) => ({
    value: String(m.id),
    label: m.code,
    hint: m.name ?? '',
  }));
  const inspectorOpts = inspectorOptions.map((i) => ({
    value: String(i.id),
    label: i.name,
    hint: i.emp_code ?? '',
  }));

  // ผู้ตรวจที่ยังไม่มีในระบบคือทางตันของคนที่กำลังจะกรอกใบตรวจ — ให้เพิ่มตรงนี้ได้เลย
  // ⚠️ emp_code เป็น NOT NULL + UNIQUE ใน DB จึงต้องถามด้วย ใส่แต่ชื่อบันทึกไม่ผ่าน
  const askAddInspector = () => showForm({
    title: 'เพิ่มผู้ตรวจใหม่',
    body: 'เพิ่มแล้วจะถูกเลือกให้ทันที และใช้ได้กับทุกเครื่องที่เปิดระบบนี้',
    confirmLabel: 'เพิ่ม',
    fields: [
      {
        name: 'emp_code',
        label: 'รหัสพนักงาน',
        required: true,
        hint: 'ห้ามซ้ำกับคนที่มีอยู่แล้ว',
      },
      { name: 'name', label: 'ชื่อ', required: true },
      {
        name: 'division_id',
        label: 'Division',
        placeholder: '— ไม่ระบุ —',
        defaultValue: divisionId ? String(divisionId) : '',
        options: divisions.map((d) => ({ value: String(d.id), label: d.name })),
      },
    ],
    onConfirm: async (data) => {
      try {
        const id = await onAddInspector(data);
        onChange({ ...station, inspectorId: String(id) });
      } catch (e) {
        showAlert({ title: 'เพิ่มผู้ตรวจไม่สำเร็จ', body: e.message });
      }
    },
  });

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
            <Form.Label htmlFor="station-model" className="small mb-1 text-muted">Item No.</Form.Label>
            <SearchSelect
              id="station-model"
              value={station.modelId}
              options={modelOpts}
              onChange={setModel}
              placeholder="— เลือก item —"
              emptyText="ไม่พบ item ที่ค้นหา"
            />
          </Col>
          <Col md={3}>
            <Form.Label htmlFor="station-machine" className="small mb-1 text-muted">เครื่อง</Form.Label>
            <SearchSelect
              id="station-machine"
              value={station.machineId}
              options={machineOpts}
              onChange={setVal('machineId')}
              placeholder="— เลือกเครื่อง —"
              emptyText="ไม่พบเครื่องที่ค้นหา"
            />
          </Col>
          <Col md={2}>
            <Form.Label htmlFor="station-shift" className="small mb-1 text-muted">กะ</Form.Label>
            {/* ⚠️ ต้องมี <option value=""> — ไม่เดากะให้แล้ว station.shift จึงเริ่มเป็นค่าว่าง
                ถ้าไม่มี option รองรับ <Form.Select> จะโชว์กะแรกของลิสต์ทั้งที่ state ยังว่าง
                · กะมี 6 ตัวจบ ยังเป็น <Form.Select> อยู่ พิมพ์ค้นหาแล้วไม่ได้เร็วขึ้น */}
            <Form.Select id="station-shift" value={station.shift} onChange={setShift}>
              <option value="">— เลือกกะ —</option>
              {SHIFTS.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label htmlFor="station-inspector" className="small mb-1 text-muted">ผู้ตรวจ</Form.Label>
            <SearchSelect
              id="station-inspector"
              value={station.inspectorId}
              options={inspectorOpts}
              onChange={setVal('inspectorId')}
              placeholder="— เลือกผู้ตรวจ —"
              emptyText="ไม่พบผู้ตรวจที่ค้นหา"
              onAddNew={onAddInspector ? askAddInspector : null}
              addNewLabel="เพิ่มผู้ตรวจใหม่"
            />
          </Col>
          <Col xs={12}>
            <div className="small text-muted">
              ค่าที่เลือกไว้จะถูกจำไว้ในเครื่องนี้ เปิดหน้าครั้งหน้าไม่ต้องเลือกใหม่ ·
              ช่อง item / เครื่อง / ผู้ตรวจ พิมพ์เพื่อค้นหาได้
            </div>
          </Col>
        </Row>
      )}

      <AppDialog dialog={dialog} onHide={closeDialog} />
    </div>
  );
};

export default StationBar;
