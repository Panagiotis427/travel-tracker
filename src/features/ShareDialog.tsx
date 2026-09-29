import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

interface Props {
  /** 'share' asks for a name and makes this map's share link; 'add' takes someone's link. */
  mode: 'share' | 'add';
  /** Builds the share link for the given name ('share' mode). */
  makeLink?: (name: string) => Promise<string>;
  /** Adds the person behind a pasted link ('add' mode). */
  onAdd?: (link: string) => void;
  /** Closes the dialog; a message is shown under the sharing buttons when given. */
  onClose: (msg?: string) => void;
}

// In-app sharing form, replacing window.prompt: the name for your link, or someone's link
// to paste. Where the clipboard is blocked, the new link is shown selected, ready to copy.
export default function ShareDialog({ mode, makeLink, onAdd, onClose }: Props) {
  const [text, setText] = useState(mode === 'share' ? 'Me' : '');
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);
  useEffect(() => { if (link) linkRef.current?.select(); }, [link]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'add') {
      if (!text.trim()) { setMsg('Paste a share link first.'); return; }
      onAdd?.(text.trim());
      onClose();
      return;
    }
    if (!makeLink) return;
    const made = await makeLink(text.trim() || 'Me');
    try {
      await navigator.clipboard.writeText(made);
      onClose('Share link copied to clipboard.');
    } catch {
      setLink(made);
      setMsg('Copy this link and send it.');
    }
  }

  const title = mode === 'share' ? 'Share my map' : 'Add a person';
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form className="modal share-modal" onSubmit={submit}>
        <div className="modal-head">
          <h2 id="share-title">{title}</h2>
          <button type="button" className="x" onClick={() => onClose()} aria-label="Close">×</button>
        </div>
        {link === null ? (
          <input
            ref={first}
            className="dialog-input"
            placeholder={mode === 'share' ? 'Your name on the shared map' : 'Paste a share link'}
            aria-label={mode === 'share' ? 'Your name on the shared map' : 'Share link'}
            autoComplete="off"
            maxLength={mode === 'share' ? 60 : undefined}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <input ref={linkRef} className="dialog-input" aria-label="Your share link" readOnly value={link} onFocus={(e) => e.target.select()} />
        )}
        <div className="auth-msg" role="status" aria-live="polite">{msg}</div>
        <div className="modal-actions">
          <button type="button" className="io" onClick={() => onClose(link ? 'Share link ready.' : undefined)}>{link ? 'Done' : 'Cancel'}</button>
          {link === null && <button type="submit" className="drill">{mode === 'share' ? 'Create link' : 'Add'}</button>}
        </div>
      </form>
    </div>
  );
}
