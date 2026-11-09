import React from 'react';
import ReactDOM from 'react-dom/client';

// ⚠️ CSS ของทั้งแอป import ที่ไฟล์นี้ที่เดียว และลำดับนี้ห้ามสลับ
//
//   1. bootstrap  — ของ vendor
//   2. theme.css  — ธีมมาตรฐานของ Korn (skill korn-ui-theme): header/footer/โหมดมืด/ตาราง freeze (--mc-*)
//   3. tokens     — token ของแอปนี้ (แกนสี สเปก/คอนโทรล) + override คลาสที่ bootstrap ฝังค่าดิบไว้ — ชนะ theme.css
//   4. index.css  — คลาสเฉพาะของแอป
//
// เดิม bootstrap ถูก import ทั้งที่นี่และใน App.js แล้วลงท้ายด้วยการถูกแทรก "หลัง"
// index.css ทุกครั้ง กฎที่เขียนเองจึงแพ้มาตลอด (`.form-control::placeholder`
// ใน index.css ตายอยู่ใน bundle production จริง ๆ) — ย้ายมาไว้ที่เดียวให้ลำดับแน่นอน
//
// ห้ามใช้ @import ของ CSS เรียก tokens.css จากใน index.css แทน — @import ถูกยกขึ้นหัวไฟล์
// ผลลัพธ์จะกลายเป็น tokens มาก่อน bootstrap ซึ่งแพ้อีกแบบ
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/theme.css';
import './styles/tokens.css';
import './index.css';

import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
