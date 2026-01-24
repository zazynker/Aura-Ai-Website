import React from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { StoreProvider } from './context/StoreContext';
import { Navbar } from './components/Navbar';
import { ToastContainer } from './components/ui/Toast';
import { Home } from './pages/Home';
import { TemplateDetail } from './pages/TemplateDetail';
import { Login } from './pages/Login';
import { Pricing } from './pages/Pricing';
import { Dashboard } from './pages/Dashboard';

const AppContent = () => {
  const location = useLocation();
  const isAuthPage = location.pathname === '/login' || location.pathname === '/signup';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-purple-500/30">
      {!isAuthPage && <Navbar />}
      <ToastContainer />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/template/:id" element={<TemplateDetail />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Login isSignup />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </div>
  );
};

const App = () => {
  return (
    <StoreProvider>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </StoreProvider>
  );
};

export default App;
