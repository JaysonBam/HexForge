import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HelperConnectionState, HelperHealth } from '../../shared/localHelperProtocol';
import { getStoredHelperPort, LocalHelperClient, LocalHelperError, storeHelperPort } from './localHelperClient';

type LocalHelperContextValue = {
  state: HelperConnectionState;
  health: HelperHealth | null;
  port: number;
  client: LocalHelperClient;
  lastError: { code: string; message: string } | null;
  probe: () => Promise<void>;
  setPort: (port: number) => void;
};

const LocalHelperContext = createContext<LocalHelperContextValue | null>(null);

export const LocalHelperProvider = ({ children }: { children: ReactNode }) => {
  const [port, setPortState] = useState(getStoredHelperPort);
  const [state, setState] = useState<HelperConnectionState>('unavailable');
  const [health, setHealth] = useState<HelperHealth | null>(null);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);
  const client = useMemo(() => new LocalHelperClient(port), [port]);
  const activeProbe = useRef<AbortController | null>(null);

  const probe = useCallback(async () => {
    activeProbe.current?.abort();
    const controller = new AbortController();
    activeProbe.current = controller;
    try {
      const nextHealth = await client.health(controller.signal);
      if (controller.signal.aborted) return;
      setHealth(nextHealth);
      setLastError(null);
      setState(nextHealth.state);
    } catch (error) {
      if (controller.signal.aborted) return;
      setHealth(null);
      setLastError(error instanceof LocalHelperError
        ? { code: error.code, message: error.message }
        : { code: 'UNAVAILABLE', message: 'The local helper is unavailable.' });
      setState('unavailable');
    }
  }, [client]);

  useEffect(() => {
    const initialProbe = window.setTimeout(() => void probe(), 0);
    const interval = window.setInterval(() => void probe(), state === 'connected' ? 30_000 : 60_000);
    const handleVisibility = () => { if (document.visibilityState === 'visible') void probe(); };
    window.addEventListener('focus', handleVisibility);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(initialProbe);
      activeProbe.current?.abort();
      window.removeEventListener('focus', handleVisibility);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [probe, state]);

  const setPort = useCallback((nextPort: number) => {
    storeHelperPort(nextPort);
    setPortState(nextPort);
  }, []);

  const value = useMemo<LocalHelperContextValue>(() => ({ state, health, port, client, lastError, probe, setPort }), [client, health, lastError, port, probe, setPort, state]);
  return <LocalHelperContext.Provider value={value}>{children}</LocalHelperContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useLocalHelper = () => {
  const context = useContext(LocalHelperContext);
  if (!context) throw new Error('useLocalHelper must be used within LocalHelperProvider.');
  return context;
};
