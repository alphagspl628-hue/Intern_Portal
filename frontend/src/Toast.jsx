import React, { createContext, useContext, useCallback, useState } from 'react';

const ToastContext = createContext(null);

let idCounter = 0;

const ICONS = { success: 'check_circle', error: 'error', info: 'info' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, message, opts = {}) => {
    if (!message) return;
    const id = ++idCounter;
    setToasts((list) => [...list, { id, type, message }]);
    const duration = opts.duration ?? (type === 'error' ? 5000 : 3500);
    if (duration > 0) setTimeout(() => remove(id), duration);
    return id;
  }, [remove]);

  const toast = {
    success: (m, o) => push('success', m, o),
    error: (m, o) => push('error', m, o),
    info: (m, o) => push('info', m, o),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container" role="region" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role="alert">
            <span className="material-symbols-outlined toast-icon">{ICONS[t.type]}</span>
            <span className="toast-msg">{t.message}</span>
            <button className="toast-close" onClick={() => remove(t.id)} aria-label="Dismiss">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

// Pull a human-friendly message out of an axios error.
export function apiError(err, fallback = 'Something went wrong. Please try again.') {
  return err?.response?.data?.error || err?.message || fallback;
}
