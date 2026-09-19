import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { authApi } from '../api/auth.api';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

export default function LoginPage() {
  const [tab, setTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setUser = useAuthStore((s) => s.setUser);
  const showToast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [regData, setRegData] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
  const [otp, setOtp] = useState('');

  const redirect = searchParams.get('redirect') || '/';
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login(email, password);
      const user = res.loggedInUser || res.data?.user || res.data;
      setUser(user);
      showToast('Login successful!', 'success');
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (regData.password !== regData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authApi.sendOtp(regData);
      showToast('OTP sent to your email!', 'success');
      setTab('otp');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.verifyOtp(otp);
      showToast('Email verified! Please log in.', 'success');
      setEmail(regData.email);
      setTab('login');
    } catch (err) {
      setError(err.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (response) => {
    setError('');
    setLoading(true);
    try {
      const res = await authApi.googleAuth(response.credential);
      const user = res.loggedInUser || res.data?.user || res.data;
      setUser(user);
      showToast('Signed in with Google!', 'success');
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!googleClientId || typeof window === 'undefined' || !window.google?.accounts?.id) return;

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleSuccess,
    });

    const container = document.getElementById('google-signin-btn');
    if (container) {
      window.google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
      });
    }
  }, [googleClientId]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Welcome back</h1>
          <p className="text-slate-500 mt-2">Sign in to track your orders in real time.</p>
        </div>

        <div className="card">
          {tab !== 'otp' && (
            <div className="flex mb-6 border-b border-slate-200">
              <button
                onClick={() => { setTab('login'); setError(''); }}
                className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                  tab === 'login' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                Login
              </button>
              <button
                onClick={() => { setTab('register'); setError(''); }}
                className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                  tab === 'register' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                Register
              </button>
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" required />
              <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required />
              <Button type="submit" loading={loading} className="w-full">Sign In</Button>

              {googleClientId && (
                <>
                  <div className="flex items-center gap-3 py-2">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-xs uppercase tracking-[0.25em] text-slate-400">or</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                  <div id="google-signin-btn" className="flex justify-center" />
                </>
              )}
            </form>
          )}

          {tab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input label="First Name" value={regData.firstName} onChange={(e) => setRegData({ ...regData, firstName: e.target.value })} required />
                <Input label="Last Name" value={regData.lastName} onChange={(e) => setRegData({ ...regData, lastName: e.target.value })} required />
              </div>
              <Input label="Email" type="email" value={regData.email} onChange={(e) => setRegData({ ...regData, email: e.target.value })} required />
              <Input label="Password" type="password" value={regData.password} onChange={(e) => setRegData({ ...regData, password: e.target.value })} required />
              <Input label="Confirm Password" type="password" value={regData.confirmPassword} onChange={(e) => setRegData({ ...regData, confirmPassword: e.target.value })} required />
              <Button type="submit" loading={loading} className="w-full">Create Account</Button>
            </form>
          )}

          {tab === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <p className="text-sm text-slate-500 mb-2">
                We've sent a verification code to <strong>{regData.email}</strong>
              </p>
              <Input label="OTP Code" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="Enter 6-digit OTP" maxLength={6} required />
              <Button type="submit" loading={loading} className="w-full">Verify OTP</Button>
              <button type="button" onClick={() => setTab('register')} className="text-sm text-slate-600 hover:underline w-full text-center">
                Back to register
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
