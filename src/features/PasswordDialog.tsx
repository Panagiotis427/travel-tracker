import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { friendlyError } from './AuthScreen';

interface Props {
  /** 'recovery' = opened from a password-reset e-mail link. */
  mode: 'change' | 'recovery';
  /** Closes the dialog; a message is shown in the profile area when given. */
  onClose: (msg?: string) => void;
}

// In-app password form, replacing window.prompt: masked input, a confirm field, inline
// errors, and the same offline / unreachable-server guidance as the sign-in screen.
export default function PasswordDialog({ mode, onClose }: Props) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 6) { setMsg('Use at least 6 characters.'); return; }
    if (pw !== pw2) { setMsg('The two passwords do not match.'); return; }
    if (!supabase) return;
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) setMsg(friendlyError(error));
      else onClose('Password updated.');
    } catch (err) {
      setMsg(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <form className="modal pw-modal" onSubmit={submit}>
        <div className="modal-head">
          <h2 id="pw-title">{mode === 'recovery' ? 'Choose a new password' : 'Change password'}</h2>
          <button type="button" className="x" onClick={() => onClose()} aria-label="Close" disabled={busy}>×</button>
        </div>
        <input
          ref={first}
          type="password"
          className="pw-input"
          placeholder="New password"
          aria-label="New password"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          minLength={6}
          required
        />
        <input
          type="password"
          className="pw-input"
          placeholder="Repeat the new password"
          aria-label="Repeat the new password"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          minLength={6}
          required
        />
        <div className="auth-msg" role="status" aria-live="polite">{msg}</div>
        <div className="modal-actions">
          <button type="button" className="io" onClick={() => onClose()} disabled={busy}>Cancel</button>
          <button type="submit" className="drill" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </div>
      </form>
    </div>
  );
}
