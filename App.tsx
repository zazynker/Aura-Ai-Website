
import React from 'react';
import { HashRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { StoreProvider } from './context/StoreContext';
import { Navbar } from './components/Navbar';
import { ToastContainer } from './components/ui/Toast';
import { Home } from './pages/Home';
// TemplateDetail removed
import { Login } from './pages/Login';
import { Pricing } from './pages/Pricing';
import { Dashboard } from './pages/Dashboard';
import { Modify } from './pages/Modify';

const AppContent = () => {
  const location = useLocation();
  const isAuthPage = location.pathname === '/login' || location.pathname === '/signup';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-sans selection:bg-purple-500/30 transition-colors duration-300">
      {!isAuthPage && <Navbar />}
      <ToastContainer />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/template/:id" element={<Navigate to="/" replace />} />
        <Route path="/modify" element={<Modify />} />
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
