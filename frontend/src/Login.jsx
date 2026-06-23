import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API } from './config';
import { useToast, apiError } from './Toast';
import { isBlank, isEmail } from './validation';

const Login = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState('intern'); // 'intern' | 'admin'
  const [intern, setIntern] = useState({ email: '', internId: '' });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (m) => {
    setMode(m);
    setError('');
  };

  const validate = () => {
    if (mode === 'admin') {
      if (isBlank(password)) return 'Please enter the admin password.';
      return '';
    }
    if (isBlank(intern.email) || isBlank(intern.internId)) return 'Email and Intern ID are both required.';
    if (!isEmail(intern.email)) return 'Enter a valid email address.';
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      toast.error(problem);
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (mode === 'admin') {
        await axios.post(`${API}/api/admin/login`, { password });
        localStorage.setItem('adminToken', 'admin');
        toast.success('Welcome back, admin.');
        navigate('/admin');
      } else {
        const res = await axios.post(`${API}/api/intern/login`, intern);
        localStorage.setItem('internId', res.data.internId);
        localStorage.setItem('internName', res.data.name);
        // Team leaders get their own dedicated dashboard.
        if (res.data.isTeamLeader) {
          localStorage.setItem('isTeamLeader', 'true');
          toast.success(`Welcome, ${res.data.name} — Team Leader.`);
          navigate('/team-leader');
        } else {
          localStorage.removeItem('isTeamLeader');
          toast.success(`Signed in as ${res.data.name}.`);
          navigate('/intern');
        }
      }
    } catch (err) {
      const msg = apiError(err, 'Login failed.');
      setError(msg);
      toast.error(msg);
    }
    setLoading(false);
  };

  return (
    <div className="auth-screen">
      <button type="button" className="auth-back" onClick={() => navigate('/')} title="Back to home">
        <span className="material-symbols-outlined">arrow_back</span>
      </button>
      <form className="auth-card" onSubmit={submit}>
        <h1>GSPL</h1>
        <p className="auth-sub">Sign in to your portal</p>

        <div className="login-toggle">
          <button
            type="button"
            className={mode === 'intern' ? 'active' : ''}
            onClick={() => switchMode('intern')}
          >
            Intern
          </button>
          <button
            type="button"
            className={mode === 'admin' ? 'active' : ''}
            onClick={() => switchMode('admin')}
          >
            Admin
          </button>
        </div>

        {mode === 'intern' ? (
          <>
            <input
              type="email"
              placeholder="Email address"
              value={intern.email}
              onChange={(e) => setIntern({ ...intern, email: e.target.value })}
              required
            />
            <input
              type="text"
              placeholder="Intern ID (e.g. GSPL-INT-2026-1234)"
              value={intern.internId}
              onChange={(e) => setIntern({ ...intern, internId: e.target.value })}
              required
            />
          </>
        ) : (
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}

        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Log in'}
        </button>

        {mode === 'intern' ? (
          <p className="auth-hint">
            Haven't been selected yet? <a href="/">Apply on the home page</a>
          </p>
        ) : (
          <p className="auth-hint"></p>
        )}
      </form>
    </div>
  );
};

export default Login;
