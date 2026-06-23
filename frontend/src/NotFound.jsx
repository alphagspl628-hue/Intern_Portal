import React from 'react';
import { useNavigate } from 'react-router-dom';

// Shared 404 page. Used both for unknown routes and for a deleted intern account.
const NotFound = ({
  title = 'Page not found',
  message = "The page you're looking for doesn't exist or has been moved.",
  actionLabel = 'Back to home',
  actionTo = '/',
}) => {
  const navigate = useNavigate();
  return (
    <div className="auth-screen">
      <button type="button" className="auth-back" onClick={() => navigate('/')} title="Back to home">
        <span className="material-symbols-outlined">arrow_back</span>
      </button>
      <div className="not-found">
        <div className="nf-code">404</div>
        <h1>{title}</h1>
        <p className="muted">{message}</p>
        <button className="btn-primary" onClick={() => navigate(actionTo)}>
          <span className="material-symbols-outlined">{actionTo === '/login' ? 'login' : 'home'}</span>{actionLabel}
        </button>
      </div>
    </div>
  );
};

export default NotFound;
