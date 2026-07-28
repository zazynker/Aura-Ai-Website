import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { StoreProvider } from './context/StoreContext';
import { Navbar } from './components/Navbar';
import { ToastContainer } from './components/ui/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Footer } from './components/Footer';
import { WorkflowDock } from './components/workflow/WorkflowDock';
import { clearWorkflow, restoreActiveWorkflow } from './components/workflow/workflowManager';
import { RewardCelebrationModal } from './components/RewardCelebrationModal';
import { useStore } from './context/StoreContext';
import {
  claimCreatorRewardCelebration,
  CREATOR_REWARD_AVAILABLE_EVENT,
} from './utils/notificationsApi';
import type { CreatorRewardCelebration } from './types';

const pendingCelebrationClaims = new Map<string, Promise<CreatorRewardCelebration | null>>();

const claimCelebrationOnce = (userId: string): Promise<CreatorRewardCelebration | null> => {
  const existing = pendingCelebrationClaims.get(userId);
  if (existing) return existing;
  const request = claimCreatorRewardCelebration().finally(() => {
    pendingCelebrationClaims.delete(userId);
  });
  pendingCelebrationClaims.set(userId, request);
  return request;
};

// ============ 首屏必须的组件（不懒加载）============
import { Home } from './pages/Home';
import { Login } from './pages/Login';

// ============ 非首屏页面（懒加载）============
const Modify = lazy(() => import('./pages/Modify').then(m => ({ default: m.Modify })));
const Video = lazy(() => import('./pages/Video').then(m => ({ default: m.Video })));
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
const ManageSubscription = lazy(() => import('./pages/ManageSubscription').then(m => ({ default: m.ManageSubscription })));

const TemplateBuilder = lazy(() => import('./pages/TemplateBuilder').then(m => ({ default: m.TemplateBuilder })));
const TemplateDetail = lazy(() => import('./pages/TemplateDetail').then(m => ({ default: m.TemplateDetail })));

// ============ 加载占位符 ============
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
    <div className="flex flex-col items-center gap-4">
      <div className="animate-spin w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full" />
      <p className="text-slate-500 dark:text-slate-400 text-sm">Loading...</p>
    </div>
  </div>
);

const RequireAuth = ({ children }: React.PropsWithChildren) => {
  const { user, authLoading } = useStore();
  const location = useLocation();

  if (authLoading) return <PageLoader />;

  if (!user) {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('postAuthDestination', `${location.pathname}${location.search}`);
    }
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <>{children}</>;
};

const AppContent = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, authLoading } = useStore();
  const [rewardCelebration, setRewardCelebration] = React.useState<CreatorRewardCelebration | null>(null);

  React.useEffect(() => {
    if (authLoading || !user) {
      setRewardCelebration(null);
      return;
    }

    let active = true;
    const checkForCreatorRewards = () => {
      if (!active || rewardCelebration) return;
      void claimCelebrationOnce(user.id)
        .then((celebration) => {
          if (active && celebration) setRewardCelebration(celebration);
        })
        .catch((error) => {
          if (active) console.error('Could not claim creator reward celebration.', error);
        });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForCreatorRewards();
    };

    checkForCreatorRewards();
    window.addEventListener(CREATOR_REWARD_AVAILABLE_EVENT, checkForCreatorRewards);
    window.addEventListener('focus', checkForCreatorRewards);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = window.setInterval(checkForCreatorRewards, 30_000);

    return () => {
      active = false;
      window.removeEventListener(CREATOR_REWARD_AVAILABLE_EVENT, checkForCreatorRewards);
      window.removeEventListener('focus', checkForCreatorRewards);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [authLoading, user?.id, rewardCelebration]);

  React.useEffect(() => {
    if (authLoading) return;
    if (!user) {
      void clearWorkflow(false);
      return;
    }

    let disposed = false;
    const restore = async () => {
      try {
        await restoreActiveWorkflow();
      } catch (error) {
        if (!disposed) console.error('Could not restore active workflow.', error);
      }
    };

    void restore();
    const handleFocus = () => { void restore(); };
    window.addEventListener('focus', handleFocus);
    return () => {
      disposed = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, [authLoading, user?.id]);

  React.useEffect(() => {
    if (!user) return;
    const destination = sessionStorage.getItem('postAuthDestination');
    if (!destination) return;
    sessionStorage.removeItem('postAuthDestination');
    sessionStorage.removeItem('authEntryContext');
    if (destination.startsWith('/') && !destination.startsWith('//') && location.pathname !== destination) {
      navigate(destination, { replace: true });
    }
  }, [user, location.pathname, navigate]);
  
  React.useEffect(() => {
    if (window.location.hash.includes('error=access_denied')) {
      window.location.href = '/#/login';
      return;
    }
  }, []);

  const isAuthPage = ['/login', '/signup', '/forgot-password', '/reset-password', '/auth/callback'].includes(location.pathname);
  const isEditorPage = location.pathname === '/modify';
  const isAdminPage = location.pathname === '/admin';
  const isSubscriptionPage = location.pathname === '/subscription';
  const isVideoPage = location.pathname === '/video';
  const isBuilderPage = location.pathname === '/templates/create';
  const isTemplateDetailPage = /^\/templates\/[^/]+$/.test(location.pathname);
  const hideFooter = isAuthPage || isEditorPage || isAdminPage || isSubscriptionPage || isVideoPage || isBuilderPage || isTemplateDetailPage;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-sans selection:bg-purple-500/30 transition-colors duration-300">
      {!isAuthPage && <Navbar />}
      <ToastContainer />
      <WorkflowDock />
      <RewardCelebrationModal
        celebration={rewardCelebration}
        onClose={() => setRewardCelebration(null)}
      />
      <Analytics
        beforeSend={(event) => {
          // HashRouter routes are not part of location.pathname. Keep the
          // route visible to Web Analytics while preserving the absolute URL
          // shape that Vercel emits by default.
          const hashPath = window.location.hash.replace(/^#/, '');
          const route = hashPath || window.location.pathname || '/';
          const safeRoute = route.startsWith('/') && !route.startsWith('//') ? route : '/';
          return {
            ...event,
            url: new URL(safeRoute, window.location.origin).toString(),
          };
        }}
      />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/template/:id" element={<Navigate to="/" replace />} />
          <Route
            path="/templates/create"
            element={
              <RequireAuth>
                <TemplateBuilder />
              </RequireAuth>
            }
          />
          <Route
            path="/templates/:templateId"
            element={<TemplateDetail />}
          />
          <Route path="/modify" element={<Modify />} />
          <Route
            path="/video"
            element={
              <RequireAuth>
                <Video />
              </RequireAuth>
            }
          />
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
          <Route path="/subscription" element={<ManageSubscription />} />
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
