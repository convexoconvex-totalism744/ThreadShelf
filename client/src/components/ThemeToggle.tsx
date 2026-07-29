import { useUIStore } from '../store';
import { Icons } from '../icons';

interface ThemeToggleProps {
  /** `full` shows a labelled row, `icon` shows a compact icon button. */
  readonly variant?: 'full' | 'icon';
}

export function ThemeToggle({ variant = 'full' }: ThemeToggleProps) {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  const nextLabel = isDark ? 'light' : 'dark';

  return (
    <button
      className={`theme-toggle ${variant}`}
      onClick={toggleTheme}
      title={`Switch to ${nextLabel} theme`}
      aria-label={`Switch to ${nextLabel} theme`}
    >
      <span className="tt-ico">{isDark ? Icons.sun : Icons.moon}</span>
      {variant === 'full' && <span className="tt-label">{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  );
}
