import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { StoreProvider } from './context/StoreContext';
import { Navbar } from './components/Navbar';
import { ToastContainer } from './components/ui/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Footer } from './components/Footer';

// ============ 首屏必须的组件（不懒加载）============
import { Home } from './pages/Home';
import { Login } from './pages/Login';

// ============ 非首屏页面（懒加载）============
const Modify = lazy(() => import('./pages/Modify').then(m => ({ default: m.Modify })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Admin = lazy(() => import('./pages/Admin'));
const Pricing = lazy(() => import('./pages/Pricing').then(m => ({ default: m.Pricing })));
const Privacy = lazy(() => import('./pages/Privacy').then(m => ({ default: m.Privacy })));
const Terms = lazy(() => import('./pages/Terms').then(m => ({ default: m.Terms })));
const About = lazy(() => import('./pages/About').then(m => ({ default: m.About })));
const CreditRules = lazy(() => import('./pages/CreditRules').then(m => ({ default: m.CreditRules })));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then(m => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPassword })));
const AuthCallback = lazy(() => import('./pages/AuthCallback').then(m => ({ default: m.AuthCallback })));

// ============ 加载占位符 ============
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
    <div className="flex flex-col items-center gap-4">
      <div className="animate-spin w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full" />
      <p className="text-slate-500 dark:text-slate-400 text-sm">Loading...</p>
    </div>
  </div>
);

const AppContent = () => {
  const location = useLocation();
  
  React.useEffect(() => {
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
      <Suspense fallback={<PageLoader />}>
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
      </Suspense>
      {!hideFooter && <Footer />}
    </div>
  );
};

const App = () => {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <HashRouter>
          <AppContent />
        </HashRouter>
      </StoreProvider>
    </ErrorBoundary>
  );
};

export default App;