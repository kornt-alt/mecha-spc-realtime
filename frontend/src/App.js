import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Navbar, Nav, Container } from 'react-bootstrap';

import MasterSetup from './components/MasterSetup';
import InputStation from './components/InputStation';
import SpcChart from './components/SpcChart'; 
import Dashboard from './components/Dashboard';

import './index.css';
import 'bootstrap/dist/css/bootstrap.min.css';

// const BACKEND_URL = 'http://localhost:5000';
const BACKEND_URL = '/Mecha-Spc-Realtime';

const API_BASE = `${BACKEND_URL}/api`;
// const API_BASE = '/Mecha-Spc-Realtime/api';

const apiCall = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');

  const { body, ...restOptions } = options;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...restOptions, 
    body: body ? JSON.stringify(body) : undefined, 
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    
    let data;
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = text;
    }
    // const data = await response.json(); // (แบบเดิม)

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/Mecha-Spc-Realtime/';
        throw new Error('Session expired');
      }
      throw new Error(data?.message || data || 'Something went wrong');
    }
    return data;
  } catch (error) {
    throw error;
  }
};

const NotFound = () => (
  <Container className="text-center mt-5">
    <h2>404 - Page Not Found</h2>
    <p>Sorry kub. Don't Have This Page eiei</p>
    <Link to="/">กลับหน้าหลัก</Link>
  </Container>
);

// const Dashboard = () => {
//   const [specs, setSpecs] = React.useState([]);

//   React.useEffect(() => {
//     const fetchSpecs = async () => {
//        const tree = await apiCall('/master/tree');
//        // กรองเอาเฉพาะที่มี Spec ID
//        const uniqueSpecs = tree.filter(t => t.s_id);
//        setSpecs(uniqueSpecs);
//     };
//     fetchSpecs();
//   }, []);

//   return (
//     <Container className="mt-4">
//         <h2>📊 Real-time SPC Dashboard</h2>
//         <div className="row">
//             {specs.map(spec => (
//                 <div className="col-md-6" key={spec.s_id}>
//                     <SpcChart spec={spec} />
//                 </div>
//             ))}
//         </div>
//     </Container>
//   );
// };

const ConditionalNavbar = () => {
  return (
    <Navbar bg="dark" variant="dark" expand="lg" className="mb-4">
      <Container>
        <Navbar.Brand as={Link} to="/">Mecha Attend</Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

const Layout = ({ children }) => (
  <>
    <ConditionalNavbar />
    <Container>{children}</Container>
  </>
);

const App = () => {
  return (
    <Router basename="/Mecha-Spc-Realtime">
      <Navbar bg="dark" variant="dark" expand="lg">
        <Container>
          <Navbar.Brand as={Link} to="/">Mecha SPC Realtime</Navbar.Brand>
          <Nav className="me-auto">
            <Nav.Link as={Link} to="/">Dashboard</Nav.Link>
            <Nav.Link as={Link} to="/input">Input Station</Nav.Link>
            <Nav.Link as={Link} to="/master">Master Setup</Nav.Link>
          </Nav>
        </Container>
      </Navbar>
      
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/input" element={<InputStation />} />
        <Route path="/master" element={<MasterSetup />} />
      </Routes>
    </Router>
  );
};

export default App;
export { apiCall, API_BASE, BACKEND_URL };