import { useEffect, useRef, useState } from 'react';
import { HardDrive, RotateCw, X } from 'lucide-react';
import { useLocalHelper } from './LocalHelperContext';

const LABELS = {
  connected: 'Files connected',
  not_configured: 'Files setup needed',
  root_unavailable: 'Files root unavailable',
  unavailable: 'Files unavailable'
} as const;

export const LocalHelperIndicator = () => {
  const { state, port, lastError, probe, setPort } = useLocalHelper();
  const [open, setOpen] = useState(false);
  const [draftPort, setDraftPort] = useState(String(port));
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const tone = state === 'connected'
    ? 'border-emerald-300 bg-emerald-100 text-emerald-900'
    : state === 'unavailable'
      ? 'border-slate-300 bg-slate-100 text-slate-600'
      : 'border-amber-300 bg-amber-100 text-amber-900';
  const dot = state === 'connected' ? 'bg-emerald-500' : state === 'unavailable' ? 'bg-slate-400' : 'bg-amber-500';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setDraftPort(String(port));
          setOpen((value) => !value);
        }}
        className={`forge-focus-ring inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-bold transition-colors ${tone}`}
        aria-expanded={open}
      >
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
        {LABELS[state]}
      </button>
      {open && (
        <div className="forge-modal absolute right-0 z-[120] mt-2 w-72 p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Local file connection</p>
              <p className="mt-1 text-sm font-bold text-slate-950">{LABELS[state]}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-900" aria-label="Close local connection settings"><X size={15} /></button>
          </div>
          <p className="mt-3 text-xs font-semibold leading-relaxed text-slate-600">
            This setting applies only to this browser on this workstation.
          </p>
          {state === 'unavailable' && lastError && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-amber-900">
              {lastError.code === 'TIMEOUT'
                ? 'The browser timed out while requesting local network access. Allow local network access for this site, then retry.'
                : lastError.message}
            </p>
          )}
          <label className="mt-3 block text-xs font-bold text-slate-700" htmlFor="local-helper-port">Helper port</label>
          <div className="mt-1 flex gap-2">
            <input
              id="local-helper-port"
              type="number"
              min={1024}
              max={65535}
              value={draftPort}
              onChange={(event) => setDraftPort(event.target.value)}
              className="forge-command-input min-w-0 flex-1 px-3 py-2 text-sm font-bold"
            />
            <button
              type="button"
              onClick={() => {
                const nextPort = Number(draftPort);
                if (Number.isInteger(nextPort) && nextPort >= 1024 && nextPort <= 65535) {
                  if (nextPort === port) void probe();
                  else setPort(nextPort);
                }
              }}
              className="forge-button-secondary inline-flex items-center gap-1 rounded-md px-3 text-xs font-bold"
            >
              <RotateCw size={13} /> Retry
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
            <HardDrive size={13} /> http://127.0.0.1:{port}/v1
          </div>
        </div>
      )}
    </div>
  );
};
