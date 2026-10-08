import { useEffect, useRef, useId } from 'react';

export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, busy }) {
  const dialog = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="jf-confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id={titleId} className="text-xl font-semibold mb-3">{title}</h2>
    <p id={descriptionId} className="text-sm mb-6" style={{ color: 'var(--jf-text-secondary)' }}>{message}</p>
    <div className="flex flex-wrap justify-end gap-3"><button autoFocus disabled={busy} className="jf-btn-secondary" onClick={onCancel}>Keep screening</button><button disabled={busy} className="jf-btn-primary" onClick={onConfirm}>{busy ? 'Cancelling…' : confirmLabel}</button></div>
  </dialog>;
}
