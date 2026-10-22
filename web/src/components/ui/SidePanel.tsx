import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function SidePanel({ title, subtitle, status, icon: Icon, onClose, closeLabel, closeDisabled = false, actions, children }: {
  title: string;
  subtitle: string;
  status?: string;
  icon: LucideIcon;
  onClose: () => void;
  closeLabel: string;
  closeDisabled?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    if (!panelRef.current?.contains(document.activeElement)) closeRef.current?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, [opener]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-[2px] print:hidden"
      onClick={() => { if (!closeDisabled) onClose(); }}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (!closeDisabled) onClose();
        }
        if (event.key === 'Tab') {
          const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])');
          const first = controls?.[0];
          const last = controls?.[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="project-side-panel forge-drawer flex h-full w-full max-w-2xl flex-col bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-20 shrink-0 items-center gap-3 border-b border-slate-300 bg-white px-5 py-4">
          <Icon size={20} className="shrink-0 text-slate-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-lg font-black text-slate-950">{title}</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <p className="min-w-0 truncate">{subtitle}</p>
              {status && <span className="shrink-0" role="status" aria-live="polite">{status}</span>}
            </div>
          </div>
          {actions}
          <Button ref={closeRef} variant="ghost" size="icon" className="shrink-0" disabled={closeDisabled} onClick={onClose} aria-label={closeLabel}>
            <X size={18} />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </aside>
    </div>
  );
}
