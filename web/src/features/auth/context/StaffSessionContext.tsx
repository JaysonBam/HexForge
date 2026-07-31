import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type StaffSessionContextType = {
  activeStaffName: string;
  setActiveStaffName: (name: string) => void;
  clearActiveStaffName: () => void;
  claimActiveStaffName: () => string | null;
};

type StoredStaffSession = {
  name: string;
  lastUsedAt: string;
};

const STAFF_SESSION_STORAGE_KEY = 'misc-print-ops.active-staff-session';
const STAFF_SESSION_TIMEOUT_MS = 60 * 60 * 1000;

const StaffSessionContext = createContext<StaffSessionContextType | undefined>(undefined);

const readStoredSession = (): StoredStaffSession | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(STAFF_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredStaffSession>;
    const name = (parsed?.name || '').trim();
    const lastUsedAt = typeof parsed?.lastUsedAt === 'string' ? parsed.lastUsedAt : '';
    if (!name || !lastUsedAt) return null;

    const lastUsedMs = new Date(lastUsedAt).getTime();
    if (!Number.isFinite(lastUsedMs)) return null;

    if (Date.now() - lastUsedMs > STAFF_SESSION_TIMEOUT_MS) {
      window.localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
      return null;
    }

    return { name, lastUsedAt };
  } catch (error) {
    console.error('Failed to read stored staff session:', error);
    return null;
  }
};

const writeStoredSession = (name: string) => {
  if (typeof window === 'undefined') return;

  const trimmedName = name.trim();
  if (!trimmedName) {
    window.localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
    return;
  }

  const payload: StoredStaffSession = {
    name: trimmedName,
    lastUsedAt: new Date().toISOString()
  };
  window.localStorage.setItem(STAFF_SESSION_STORAGE_KEY, JSON.stringify(payload));
};

export const StaffSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeStaffName, setActiveStaffNameState] = useState(() => readStoredSession()?.name || '');

  const clearActiveStaffName = useCallback(() => {
    setActiveStaffNameState('');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
    }
  }, []);

  const setActiveStaffName = useCallback((name: string) => {
    const trimmedName = name.trim();
    setActiveStaffNameState(trimmedName);
    writeStoredSession(trimmedName);
  }, []);

  const claimActiveStaffName = useCallback(() => {
    const storedSession = readStoredSession();
    if (!storedSession?.name) {
      clearActiveStaffName();
      return null;
    }

    setActiveStaffNameState(storedSession.name);
    writeStoredSession(storedSession.name);
    return storedSession.name;
  }, [clearActiveStaffName]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!readStoredSession()?.name) {
        setActiveStaffNameState('');
      }
    }, 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const value = useMemo(() => ({
    activeStaffName,
    setActiveStaffName,
    clearActiveStaffName,
    claimActiveStaffName
  }), [activeStaffName, setActiveStaffName, clearActiveStaffName, claimActiveStaffName]);

  return (
    <StaffSessionContext.Provider value={value}>
      {children}
    </StaffSessionContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useStaffSession = () => {
  const context = useContext(StaffSessionContext);
  if (!context) {
    throw new Error('useStaffSession must be used within a StaffSessionProvider');
  }
  return context;
};
