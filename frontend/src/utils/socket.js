import { io } from 'socket.io-client';
import { API_ORIGIN, APP_BASE } from './config';

// Socket singleton ใช้ร่วมกันทั้งแอป
// path ต้องตรงกับที่ตั้งไว้ฝั่ง server ใน backend/index.js และกับ Apache config
const socket = io(API_ORIGIN || undefined, {
  path: `${APP_BASE}/socket.io`,
  reconnection: true,
});

export default socket;
