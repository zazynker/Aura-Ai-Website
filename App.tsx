import React from 'react';
import { HashRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { StoreProvider } from './context/StoreContext';
import { Navbar } from './components/Navbar';
import { ToastContainer } from './components/ui/Toast';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Pricing } from './pages/Pricing';
import { Dashboard } from './pages/Dashboard';
import { Modify } from './pages/Modify';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { About } from './pages/About';
import { Footer } from './components/Footer';
import { CreditRules } from './pages/CreditRules';
import { AuthCallback } from './pages/AuthCallback';
import Admin from './pages/Admin';

const AppContent = () => {
  const location = useLocation();
  
  // 处理 OAuth 错误回调（用户取消登录等）- 防止白屏
  React.useEffect(() => {
    // 检查 hash 中是否包含 error=access_denied（用户取消 Google 登录）
    if (window.location.hash.includes('error=access_denied')) {
      window.location.href = '/#/login';
      return;
    }
  }, []);

  const isAuthPage = ['/login', '/signup', '/forgot-password', '/reset-password', '/auth/callback'].includes(location.pathname);
  const isEditorPage = location.pathname === '/modify';
  const isAdminPage = location.pathname === '/admin';
  const hideFooter = isAuthPage || isEditorPage || isAdminPage;

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
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/about" element={<About />} />
        <Route path="/credit-rules" element={<CreditRules />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
      {!hideFooter && <Footer />}
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