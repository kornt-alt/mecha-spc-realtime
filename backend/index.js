// backend/index.js — bootstrap เท่านั้น: ต่อ socket.io, mount routes, จับ error
//
// ⚠️ Apache เสิร์ฟ frontend/build เอง Express ทำแค่ API + socket.io
//    ห้ามใส่ express.static หรือ React fallback route กลับเข้ามา
'use strict';

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const env = require('./config/env');
const { checkSchema } = require('./db/schemaCheck');
const { errorHandler, notFoundApi } = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

// path ต้องตรงกับ APP_BASE ฝั่ง frontend และ config ของ Apache
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: `${env.APP_BASE}/socket.io`,
});

// routes เข้าถึง io ผ่าน req.app.get('io') — ไม่ต้องส่ง io เข้าไปเป็นพารามิเตอร์ทุกไฟล์
app.set('io', io);

// 5 MB: นำเข้า item หลายร้อยตัวพร้อมจุดตรวจ (POST /master/items/bulk) เกิน 100 KB ค่าเริ่มของ express
app.use(express.json({ limit: '5mb' }));
app.use(cors());

// ── socket.io: ใช้ room แยกตามรุ่น ─────────────────────────────────────────
//
// ⚠️ นี่เป็นโปรเจกต์แรกในเครือที่ใช้ room — อีก 6 โปรเจกต์ที่ใช้ socket.io ใช้ io.emit()
//    broadcast ทั้งระบบล้วน ๆ ไม่ใช่พิมพ์ผิด ตั้งใจให้เป็นแบบนี้
//
// ระบบเดิม: บันทึกทีนึง → query ประวัติทั้งหมดของ spec → ส่งให้ทุก client ที่ต่ออยู่
//           payload โตขึ้นเรื่อย ๆ ตามจำนวนค่าวัด และเครื่องที่ดูรุ่นอื่นก็โดนด้วย
// ตอนนี้:   ส่งเฉพาะ "สรุปว่าอะไรเปลี่ยน" เข้า room ของรุ่นนั้น client เอา checkpointIds
//           ไปโหลดเฉพาะกราฟที่กระทบ
const MODEL_ROOM = (id) => `model:${Number(id)}`;

io.on('connection', (socket) => {
  socket.on('join_model', (modelId) => {
    if (!Number.isInteger(Number(modelId))) return;
    // ออกจาก room รุ่นเดิมก่อนเสมอ ไม่งั้นเปลี่ยนรุ่นไปมาแล้วค้างอยู่หลาย room
    for (const room of socket.rooms) {
      if (room.startsWith('model:')) socket.leave(room);
    }
    socket.join(MODEL_ROOM(modelId));
  });

  socket.on('leave_model', (modelId) => {
    if (!Number.isInteger(Number(modelId))) return;
    socket.leave(MODEL_ROOM(modelId));
  });
});

// ── routes ────────────────────────────────────────────────────────────────

const API = `${env.APP_BASE}/api`;

app.get(`${API}/health`, (req, res) => res.json({ ok: true, appBase: env.APP_BASE }));

app.use(`${API}/auth`, require('./routes/auth'));
app.use(`${API}/users`, require('./routes/users'));
app.use(`${API}/master`, require('./routes/master'));
app.use(`${API}/inspections`, require('./routes/inspections'));
app.use(`${API}/charts`, require('./routes/charts'));
app.use(`${API}/reports`, require('./routes/reports'));
app.use(`${API}/events`, require('./routes/events'));
// งานส่งต่อ PD → QC (Set up / Last Piece) — ต้อง login ทั้ง router · แจ้งคิวด้วย io.emit('check_job_updated')
app.use(`${API}/check-jobs`, require('./routes/checkJobs'));

// ต้องอยู่หลัง route ทั้งหมด — เส้นที่ไม่มีจริงใต้ /api ตอบ JSON ไม่ใช่ HTML
app.use(API, notFoundApi);
app.use(errorHandler);

// ── start ─────────────────────────────────────────────────────────────────

server.listen(env.PORT, () => {
  console.log(`[server] พร้อมใช้งานที่ port ${env.PORT} · API อยู่ที่ ${API}`);
  // เตือนอย่างเดียว ไม่ล้ม startup — server ที่ไม่ขึ้นเลยเพราะ schema เพี้ยนนิดเดียวแก้ยากกว่า
  checkSchema().catch((err) => console.warn('[schema] ข้ามการตรวจ:', err.message));
});

module.exports = { app, server, io };
