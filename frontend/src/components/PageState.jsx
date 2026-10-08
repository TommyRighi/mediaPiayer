export default function PageState({ title, message, retry, busy = false, children }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md text-center" role={retry ? 'alert' : 'status'} aria-live="polite">
        {busy && <div className="jf-loading-line mb-6" aria-hidden="true" />}
        <h1 className="text-2xl font-semibold mb-3">{title}</h1>
        {message && <p className="text-sm mb-6" style={{ color: 'var(--jf-text-secondary)' }}>{message}</p>}
        {retry && <button className="jf-btn-primary" onClick={retry}>Try again</button>}
        {children}
      </div>
    </div>
  );
}
