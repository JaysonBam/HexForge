import React, { createContext, useContext, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabaseClient';
import {
  defaultEmailSignature,
  defaultEmailTemplates,
  normalizeEmailSignature,
  normalizeEmailTemplates,
  type EmailSignature,
  type EmailTemplate,
  type EmailTemplateKey,
  type EmailTemplates
} from '../domain/emailTemplates';
import {
  DEFAULT_FILAMENT_SOURCE,
  normalizeFilamentSource,
  type FilamentSource
} from '../domain/filamentSource.ts';
import {
  normalizeFilamentSettings,
  type Filament
} from '../domain/settingsConfig';

export type { Filament } from '../domain/settingsConfig';

export interface Module {
  id: string;
  code: string;
  lecturer: string;
  modulePayment?: boolean;
  defaultFilamentSource?: FilamentSource;
}

interface SettingsContextType {
  settingsLoading: boolean;
  settingsLoadError: string | null;
  staffList: string[];
  printers: string[];
  brands: string[];
  modules: Module[];
  filaments: Filament[];
  providedFilamentPricePerGram: number;
  getFilamentPrice: (type: string) => number;
  setProvidedFilamentPricePerGram: (price: number) => void;
  addStaff: (name: string) => void;
  removeStaff: (name: string) => void;
  addPrinter: (name: string) => void;
  removePrinter: (name: string) => void;
  addBrand: (name: string) => void;
  removeBrand: (name: string) => void;
  addModule: (code: string, lecturer: string, modulePayment?: boolean, defaultFilamentSource?: FilamentSource) => void;
  removeModule: (id: string) => void;
  updateModule: (id: string, updates: Partial<Module>) => void;
  addFilament: (filament: Omit<Filament, 'id'>) => void;
  removeFilament: (id: string) => void;
  updateFilament: (id: string, updates: Partial<Filament>) => void;
  emailTemplates: EmailTemplates;
  updateEmailTemplate: (key: EmailTemplateKey, updates: Partial<EmailTemplate>) => void;
  emailSignature: EmailSignature;
  updateEmailSignature: (updates: Partial<EmailSignature>) => void;
  emailSettingsSaving: boolean;
  emailSettingsSaveError: string | null;
  saveEmailSettings: () => Promise<boolean>;
  refreshEmailSettings: () => Promise<{ emailTemplates: EmailTemplates; emailSignature: EmailSignature }>;
  nextPriority: number;
  setNextPriority: (n: number) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  
  const [nextPriority, setNextPriority] = useState<number>(1);
  const [staffList, setStaffList] = useState<string[]>([]);
  const [printers, setPrinters] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [filaments, setFilaments] = useState<Filament[]>(() => normalizeFilamentSettings([]));
  const [providedFilamentPricePerGram, setProvidedFilamentPricePerGram] = useState(0);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplates>(defaultEmailTemplates);
  const [emailSignature, setEmailSignature] = useState<EmailSignature>(defaultEmailSignature);
  const [emailSettingsSaving, setEmailSettingsSaving] = useState(false);
  const [emailSettingsSaveError, setEmailSettingsSaveError] = useState<string | null>(null);

  useEffect(() => {
    const loadConfig = async () => {
      setSettingsLoadError(null);

      try {
        const { data, error } = await supabase.from('config').select('key, value');
        if (error) {
          setSettingsLoadError(error.message || 'Failed to load settings.');
          return;
        }

        const configMap = (data ?? []).reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {} as Record<string, unknown>);
        if (typeof configMap.settings_next_priority === 'number') setNextPriority(configMap.settings_next_priority);
        if (Array.isArray(configMap.settings_staff)) setStaffList(configMap.settings_staff as string[]);
        if (Array.isArray(configMap.settings_printers)) setPrinters(configMap.settings_printers as string[]);
        if (Array.isArray(configMap.settings_brands)) setBrands(configMap.settings_brands as string[]);
        if (Array.isArray(configMap.settings_modules)) {
          setModules((configMap.settings_modules as Module[]).map((module) => ({
            ...module,
            defaultFilamentSource: normalizeFilamentSource(module.defaultFilamentSource)
          })));
        }
        setFilaments(normalizeFilamentSettings(configMap.settings_filaments));
        if (typeof configMap.settings_provided_filament_price_per_gram === 'number') {
          setProvidedFilamentPricePerGram(configMap.settings_provided_filament_price_per_gram);
        }
        setEmailTemplates(normalizeEmailTemplates(configMap.settings_email_templates));
        setEmailSignature(normalizeEmailSignature(configMap.settings_email_signature));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected settings load failure.';
        setSettingsLoadError(message);
      } finally {
        setIsLoaded(true);
      }
    };
    loadConfig();
  }, []);

  // Persistence
  useEffect(() => {
    if (isLoaded && !settingsLoadError) supabase.from('config').upsert({ key: 'settings_next_priority', value: nextPriority }).then();
  }, [nextPriority, isLoaded, settingsLoadError]);

  useEffect(() => {
    if (isLoaded && !settingsLoadError) supabase.from('config').upsert({ key: 'settings_staff', value: staffList }).then();
  }, [staffList, isLoaded, settingsLoadError]);

  useEffect(() => {
    if (isLoaded && !settingsLoadError) supabase.from('config').upsert({ key: 'settings_printers', value: printers }).then();
  }, [printers, isLoaded, settingsLoadError]);

  useEffect(() => {
    if (isLoaded && !settingsLoadError) supabase.from('config').upsert({ key: 'settings_brands', value: brands }).then();
  }, [brands, isLoaded, settingsLoadError]);

  useEffect(() => {
    if (isLoaded && !settingsLoadError) supabase.from('config').upsert({ key: 'settings_modules', value: modules }).then();
  }, [modules, isLoaded, settingsLoadError]);

  useEffect(() => {
    if (isLoaded && !settingsLoadError) supabase.from('config').upsert({ key: 'settings_filaments', value: filaments }).then();
  }, [filaments, isLoaded, settingsLoadError]);

  useEffect(() => {
    if (isLoaded && !settingsLoadError) {
      supabase.from('config').upsert({
        key: 'settings_provided_filament_price_per_gram',
        value: providedFilamentPricePerGram
      }).then();
    }
  }, [providedFilamentPricePerGram, isLoaded, settingsLoadError]);

  // Actions
  const addStaff = (name: string) => setStaffList(prev => [...prev, name]);
  const removeStaff = (name: string) => setStaffList(prev => prev.filter(s => s !== name));

  const addPrinter = (name: string) => setPrinters(prev => [...prev, name]);
  const removePrinter = (name: string) => setPrinters(prev => prev.filter(p => p !== name));

  const addBrand = (name: string) => setBrands(prev => [...prev, name]);
  const removeBrand = (name: string) => setBrands(prev => prev.filter(b => b !== name));

  const addModule = (
    code: string,
    lecturer: string,
    modulePayment: boolean = false,
    defaultFilamentSource: FilamentSource = DEFAULT_FILAMENT_SOURCE
  ) => setModules(prev => [...prev, {
    id: uuidv4(),
    code,
    lecturer,
    modulePayment,
    defaultFilamentSource: normalizeFilamentSource(defaultFilamentSource)
  }]);
  const removeModule = (id: string) => setModules(prev => prev.filter(m => m.id !== id));
  const updateModule = (id: string, updates: Partial<Module>) => {
    const normalizedUpdates = 'defaultFilamentSource' in updates
      ? {
          ...updates,
          defaultFilamentSource: normalizeFilamentSource(updates.defaultFilamentSource)
        }
      : updates;
    setModules(prev => prev.map(m => m.id === id ? { ...m, ...normalizedUpdates } : m));
  };

  const addFilament = (f: Omit<Filament, 'id'>) => setFilaments(prev => {
    if (prev.some(filament => filament.type.toLowerCase() === f.type.toLowerCase())) {
      return prev;
    }

    return normalizeFilamentSettings([...prev, { ...f, id: uuidv4() }]);
  });
  const removeFilament = (id: string) => setFilaments(prev => normalizeFilamentSettings(prev.filter(f => f.id !== id)));
  const updateFilament = (id: string, updates: Partial<Filament>) => {
    setFilaments(prev => normalizeFilamentSettings(prev.map(f => f.id === id ? { ...f, ...updates } : f)));
  };

  const updateEmailTemplate = (key: EmailTemplateKey, updates: Partial<EmailTemplate>) => {
    setEmailSettingsSaveError(null);
    setEmailTemplates(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...updates,
        key
      }
    }));
  };

  const updateEmailSignature = (updates: Partial<EmailSignature>) => {
    setEmailSettingsSaveError(null);
    setEmailSignature(prev => ({ ...prev, ...updates }));
  };

  const refreshEmailSettings = async () => {
    const { data, error } = await supabase
      .from('config')
      .select('key, value')
      .in('key', ['settings_email_templates', 'settings_email_signature']);

    if (error) {
      return { emailTemplates, emailSignature };
    }

    const configMap = (data ?? []).reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {} as Record<string, unknown>);
    const refreshedTemplates = normalizeEmailTemplates(configMap.settings_email_templates);
    const refreshedSignature = normalizeEmailSignature(configMap.settings_email_signature);

    setEmailTemplates(refreshedTemplates);
    setEmailSignature(refreshedSignature);

    return {
      emailTemplates: refreshedTemplates,
      emailSignature: refreshedSignature
    };
  };

  const saveEmailSettings = async () => {
    if (!isLoaded || settingsLoadError) return false;

    setEmailSettingsSaving(true);
    setEmailSettingsSaveError(null);

    try {
      const { error } = await supabase.from('config').upsert([
        { key: 'settings_email_templates', value: emailTemplates },
        { key: 'settings_email_signature', value: emailSignature }
      ]);

      if (error) {
        setEmailSettingsSaveError(error.message || 'Email settings were not saved.');
        return false;
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected email settings save failure.';
      setEmailSettingsSaveError(message);
      return false;
    } finally {
      setEmailSettingsSaving(false);
    }
  };

  const getFilamentPrice = (type: string) => {
    const match = filaments.find(f => f.type.toLowerCase() === type.toLowerCase());
    return match ? match.pricePerGram : 0;
  };
  
  return (
    <SettingsContext.Provider value={{
      settingsLoading: !isLoaded,
      settingsLoadError,
      nextPriority, setNextPriority,
      staffList, printers, brands, modules, filaments, providedFilamentPricePerGram,
      getFilamentPrice, setProvidedFilamentPricePerGram,
      addStaff, removeStaff,
      addPrinter, removePrinter,
      addBrand, removeBrand,
      addModule, removeModule, updateModule,
      addFilament, removeFilament, updateFilament,
      emailTemplates, updateEmailTemplate,
      emailSignature, updateEmailSignature,
      emailSettingsSaving, emailSettingsSaveError, saveEmailSettings, refreshEmailSettings
    }}>
      {children}
    </SettingsContext.Provider>
  );
};
