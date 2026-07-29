import { useToastStore } from '../toast';
import { Icons } from '../icons';

const ICON_FOR = {
  info: Icons.info,
  success: Icons.check,
  error: Icons.warn,
} as const;

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismissToast = useToastStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          className="toast"
          data-type={t.type}
          onClick={() => dismissToast(t.id)}
          title="Dismiss"
        >
          <span className="toast-ico">{ICON_FOR[t.type]}</span>
          <span className="toast-text">{t.text}</span>
        </button>
      ))}
    </div>
  );
}
