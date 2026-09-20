import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  onSkip: () => void;
}

// Optional first-run auth screen. Login succeeds -> App's auth listener sets the
// session and unmounts this. "Continue without an account" keeps it local-first.
export default function AuthScreen({ onSkip }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMsg(null);
    const creds = { email: email.trim(), password: pw };
    const { error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword(creds)
        : await supabase.auth.signUp(creds);
    setBusy(false);
    if (error) setMsg(error.message);
    else if (mode === 'signup') setMsg('Account created. If email confirmation is on, confirm via the email, then log in.');
    // On success the session listener in App closes this screen.
  }

  async function reset() {
    if (!supabase) return;
    const em = email.trim() || window.prompt('Your account email:') || '';
    if (!em) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: window.location.origin + window.location.pathname });
    setBusy(false);
    setMsg(error ? error.message : 'If that email has an account, a password-reset link is on its way.');
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">Scratch Globe</div>
        <p className="auth-tag">Track the countries and regions you have been to. Works offline and free — sign in to sync across your devices.</p>

        <form onSubmit={submit} className="auth-form">
          <input type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />
          <button className="auth-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>

        <button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMsg(null); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
        </button>
        {mode === 'login' && <button className="auth-switch" onClick={reset} disabled={busy}>Forgot password?</button>}

        {msg && <div className="auth-msg">{msg}</div>}

        <button className="auth-skip" onClick={onSkip}>Continue without an account</button>
      </div>
    </div>
  );
}
