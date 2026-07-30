import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../utils/supabase';

export const AuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      // 检查是否有错误参数（用户取消授权）
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');
      
      if (error) {
        console.log('OAuth cancelled or error:', error, errorDescription);
        // 用户取消了授权，返回登录页
        navigate('/login', { replace: true });
        return;
      }

      // 正常流程：获取 session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.error('Auth callback error:', sessionError);
        navigate('/login', { replace: true });
        return;
      }

      if (session) {
        const destination = sessionStorage.getItem('postAuthDestination');
        if (destination?.startsWith('/') && !destination.startsWith('//')) {
          sessionStorage.removeItem('postAuthDestination');
          sessionStorage.removeItem('authEntryContext');
          navigate(destination, { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      } else {
        navigate('/login', { replace: true });
      }
    };

    handleCallback();
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600 dark:text-slate-400">Completing sign in...</p>
      </div>
    </div>
  );
};
