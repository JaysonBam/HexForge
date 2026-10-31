import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/app/providers/ThemeProvider';

export function ThemeToggle() {
  const { theme, setPreference } = useTheme();
  const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <button type="button" onClick={() => setPreference(theme === 'dark' ? 'light' : 'dark')}
      aria-label={label} title={label}
      className="forge-theme-toggle forge-focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors">
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

export function ThemeSettings() {
  const { preference, setPreference } = useTheme();
  return (
    <section className="forge-panel flex flex-wrap items-center justify-between gap-4 p-4" aria-labelledby="appearance-title">
      <div>
        <h2 id="appearance-title" className="font-black">Appearance</h2>
        <p className="mt-1 text-sm text-[var(--forge-muted)]">Choose a theme for this browser. System follows your device.</p>
      </div>
      <fieldset className="forge-nav-shell flex max-w-full gap-1 p-1">
        <legend className="sr-only">Colour theme</legend>
        {([{ value: 'system', label: 'System', icon: Monitor }, { value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }] as const).map(({ value, label, icon: Icon }) => (
          <label key={value} className="relative cursor-pointer">
            <input className="peer sr-only" type="radio" name="theme" value={value} checked={preference === value} onChange={() => setPreference(value)} />
            <span className="forge-theme-option flex items-center gap-1.5 rounded px-2 py-2 text-xs font-bold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sky-400 sm:gap-2 sm:px-3 sm:text-sm">
              <Icon size={15} aria-hidden="true" />{label}
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
