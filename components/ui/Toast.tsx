import React from 'react';
import { useStore } from '../../context/StoreContext';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

export const ToastContainer = () => {
  const { toasts, removeToast } = useStore();

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border glass-panel shadow-2xl animate-in slide-in-from-right transition-all min-w-[300px] 
            ${toast.type === 'success' ? 'border-green-500/30' : toast.type === 'error' ? 'border-red-500/30' : 'border-blue-500/30'}`}
        >
          {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />}
          {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />}
          {toast.type === 'info' && <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
          
          <p className="text-sm font-medium text-slate-900 dark:text-slate-200 flex-1">{toast.message}</p>
          
          <button onClick={() => removeToast(toast.id)} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};