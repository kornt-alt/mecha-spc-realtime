require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const http = require('http'); // จำเป็นสำหรับ Socket.io
const { Server } = require('socket.io'); // Socket.io
const multer = require('multer'); // จัดการ Upload รูป
const fs = require('fs');

const app = express();
const server = http.createServer(app); // Wrap express app

// Config Socket.io
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  },
  path: '/Mecha-Spc-Realtime/socket.io' // Path ต้องตรงกับ Apache Config
});

app.use(express.json());
app.use(cors());

// Config Upload (Multer)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Static Files
// หมายเหตุ: หน้าเว็บ (frontend/build) เสิร์ฟโดย Apache ไม่ใช่ Express
// ที่นี่จึงเหลือแค่ API + socket.io + โฟลเดอร์ uploads เท่านั้น
app.use('/Mecha-Spc-Realtime/uploads', express.static(uploadDir)); // ให้เข้าถึงรูปภาพได้

// Database Pool
const dbConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};
const dbPool = mysql.createPool(dbConfig);

// ========== HELPERS ==========

// คอลัมน์ที่อนุญาตให้เขียนได้ของแต่ละตาราง
// ชื่อคอลัมน์ต่อเข้า SQL ตรง ๆ (parameterize ชื่อคอลัมน์ไม่ได้) จึงต้อง whitelist
// รายการนี้ต้องตรงกับที่ MasterSetup.handleSave ส่งมาจริง
const ALLOWED_COLUMNS = {
  divisions: ['name'],
  machines: ['division_id', 'name'],
  parts: ['machine_id', 'part_name', 'part_no'],
  specs: ['part_id', 'spec_name', 'ucl', 'lcl', 'target'],
};
const allowedTables = Object.keys(ALLOWED_COLUMNS);

// ค่าจากฟอร์มมาเป็น string เสมอ จึงต้อง coerce ก่อนตรวจ ไม่ใช่เช็ค typeof
const isIntLike = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v));
const isNumLike = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

// แยก data ออกเป็นคอลัมน์ที่ใช้ได้ / คีย์ที่ไม่รู้จัก
const pickColumns = (table, data) => {
  const allowed = ALLOWED_COLUMNS[table];
  const keys = Object.keys(data || {});
  return {
    keys: keys.filter((k) => allowed.includes(k)),
    invalid: keys.filter((k) => !allowed.includes(k)),
  };
};

// ========== API ROUTES ==========

app.get('/Mecha-Spc-Realtime/api/master/tree', async (req, res) => {
    try {
        // ดึงข้อมูลแบบ Hierarchy JSON
        const [rows] = await dbPool.query(`
            SELECT 
                d.id as d_id, d.name as d_name,
                m.id as m_id, m.name as m_name,
                p.id as p_id, p.part_name,
                s.id as s_id, s.spec_name, s.ucl, s.lcl, s.target
            FROM divisions d
            LEFT JOIN machines m ON d.id = m.division_id
            LEFT JOIN parts p ON m.id = p.machine_id
            LEFT JOIN specs s ON p.id = s.part_id
            ORDER BY d.id, m.id, p.id, s.id
        `);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. API: Universal CRUD for Master Data (Division, Machine, Part, Spec)
app.post('/Mecha-Spc-Realtime/api/master/add', async (req, res) => {
    const { table, data } = req.body; // table: 'divisions', 'machines', etc.
    // Safety check for table name to prevent injection
    if (!allowedTables.includes(table)) return res.status(400).json({ error: "Invalid table" });

    const { keys, invalid } = pickColumns(table, data);
    if (invalid.length) return res.status(400).json({ error: `Invalid column(s): ${invalid.join(', ')}` });
    if (!keys.length) return res.status(400).json({ error: "No data to insert" });

    try {
        const values = keys.map((k) => data[k]);
        const placeholders = keys.map(() => '?').join(',');
        
        const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
        const [result] = await dbPool.execute(sql, values);
        
        // Notify clients to refresh master data
        io.emit('master_updated'); 
        res.json({ success: true, id: result.insertId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. API: Submit Measurement (Input Data)
app.post('/Mecha-Spc-Realtime/api/measure', async (req, res) => {
    // รับ lot_no มาด้วย
    const { spec_id, value, sampling_no, checker_name, lot_no } = req.body;

    if (!isIntLike(spec_id)) return res.status(400).json({ error: "spec_id must be a number" });
    if (!isNumLike(value)) return res.status(400).json({ error: "value must be a number" });
    if (!isIntLike(sampling_no)) return res.status(400).json({ error: "sampling_no must be an integer" });

    try {
        await dbPool.execute(
            `INSERT INTO measurements (spec_id, value, sampling_no, checker_name, lot_no) VALUES (?, ?, ?, ?, ?)`,
            [Number(spec_id), Number(value), Number(sampling_no), checker_name ?? null, lot_no ?? null]
        );

        // ดึงข้อมูลล่าสุดส่ง Socket (รวม lot_no)
        const [history] = await dbPool.query(
            `SELECT value, sampling_no, lot_no, measured_at FROM measurements WHERE spec_id = ? ORDER BY measured_at ASC`,
            [Number(spec_id)]
        );

        io.emit(`spc_data_${spec_id}`, history); // Real-time update
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. API: Get Historical Data (For initial graph load)
app.get('/Mecha-Spc-Realtime/api/spc/:specId', async (req, res) => {
    if (!isIntLike(req.params.specId)) return res.status(400).json({ error: "Invalid spec id" });

    const { start, end } = req.query; // รับ query param ?start=...&end=...
    let sql = `SELECT value, sampling_no, lot_no, measured_at FROM measurements WHERE spec_id = ?`;
    let params = [Number(req.params.specId)];

    if (start && end) {
        sql += ` AND DATE(measured_at) BETWEEN ? AND ?`;
        params.push(start, end);
    }
    
    sql += ` ORDER BY measured_at ASC`;

    try {
        const [rows] = await dbPool.query(sql, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/Mecha-Spc-Realtime/api/history/:partId', async (req, res) => {
    if (!isIntLike(req.params.partId)) return res.status(400).json({ error: "Invalid part id" });

    try {
        const partId = Number(req.params.partId);
        // Query Join เพื่อดึงชื่อ Spec และค่า UCL/LCL มาเทียบสถานะ
        const sql = `
            SELECT 
                m.id, 
                m.measured_at, 
                m.lot_no, 
                m.sampling_no, 
                m.value, 
                m.checker_name,
                s.spec_name, 
                s.ucl, 
                s.lcl, 
                s.target
            FROM measurements m
            JOIN specs s ON m.spec_id = s.id
            WHERE s.part_id = ?
            ORDER BY m.measured_at DESC, m.sampling_no DESC
            LIMIT 50 -- ดึงมาแค่ 50 รายการล่าสุดพอกันหน่วง
        `;
        const [rows] = await dbPool.query(sql, [partId]);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/Mecha-Spc-Realtime/api/master/update', async (req, res) => {
    const { table, id, data } = req.body;

    // Whitelist check
    if (!allowedTables.includes(table)) return res.status(400).json({ error: "Invalid table" });
    if (!isIntLike(id)) return res.status(400).json({ error: "Invalid id" });

    const { keys, invalid } = pickColumns(table, data);
    if (invalid.length) return res.status(400).json({ error: `Invalid column(s): ${invalid.join(', ')}` });
    if (!keys.length) return res.status(400).json({ error: "No data to update" });

    try {
        const values = keys.map((k) => data[k]);

        // สร้าง query string เช่น: "name = ?, ucl = ?, target = ?"
        const setClause = keys.map(key => `${key} = ?`).join(', ');
        
        // ต่อท้ายด้วย ID
        const sql = `UPDATE ${table} SET ${setClause} WHERE id = ?`;
        
        await dbPool.execute(sql, [...values, Number(id)]);
        
        io.emit('master_updated'); // แจ้ง Client อื่นให้ Refresh
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 6. API: Universal DELETE
app.delete('/Mecha-Spc-Realtime/api/master/delete', async (req, res) => {
    const { table, id } = req.body;

    if (!allowedTables.includes(table)) return res.status(400).json({ error: "Invalid table" });
    if (!isIntLike(id)) return res.status(400).json({ error: "Invalid id" });

    try {
        // FK ทุกเส้นเป็น ON DELETE CASCADE ข้อมูลลูกจะถูกลบตามอัตโนมัติ
        await dbPool.execute(`DELETE FROM ${table} WHERE id = ?`, [Number(id)]);
        
        io.emit('master_updated');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API ที่ไม่มีอยู่จริง ต้องตอบ JSON ไม่ใช่ HTML
// (หน้าเว็บกับ React fallback เป็นหน้าที่ของ Apache)
app.use('/Mecha-Spc-Realtime/api', (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

// เปลี่ยนจาก app.listen เป็น server.listen เพื่อรองรับ Socket.io
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});