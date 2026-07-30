import React from 'react';
import { LockKeyhole, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

interface AuthGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  destination: string;
  title?: string;
  description?: string;
}

export const AuthGateModal: React.FC<AuthGateModalProps> = ({
  isOpen,
  onClose,
  destination,
  title = 'Create your free account to continue',
  description = 'Browse every Lazora tool for free. Sign up only when you are ready to create.',
}) => {
  const navigate = useNavigate();

  const continueToAuth = (mode: 'login' | 'signup') => {
    sessionStorage.setItem('postAuthDestination', destination);
    sessionStorage.setItem('authEntryContext', 'feature-gate');
    onClose();
    navigate(mode === 'signup' ? '/signup' : '/login', {
      state: { from: destination },
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ready to create?">
      <div className="flex flex-col items-center px-2 py-3 text-center sm:px-5">
        <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/25">
          <Sparkles className="h-8 w-8" />
          <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-900 dark:border-slate-900">
            <LockKeyhole className="h-3.5 w-3.5 text-white" />
          </span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">
          {description}
        </p>
        <div className="mt-6 flex w-full flex-col gap-2.5 sm:flex-row">
          <Button
            variant="gradient"
            className="flex-1"
            onClick={() => continueToAuth('signup')}
          >
            Sign up free
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => continueToAuth('login')}
          >
            Log in
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Your current page will reopen after authentication.
        </p>
      </div>
    </Modal>
  );
};
