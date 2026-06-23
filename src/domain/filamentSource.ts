export const FILAMENT_SOURCE_VALUES = ['misc', 'student_provided', 'module_provided'] as const;

export type FilamentSource = typeof FILAMENT_SOURCE_VALUES[number];

export const DEFAULT_FILAMENT_SOURCE: FilamentSource = 'misc';

export const FILAMENT_SOURCE_LABELS: Record<FilamentSource, string> = {
  misc: 'Misc filament',
  student_provided: 'Student-provided filament',
  module_provided: 'Module-provided filament'
};

export const FILAMENT_SOURCE_SHORT_LABELS: Record<FilamentSource, string> = {
  misc: 'Misc',
  student_provided: 'Student',
  module_provided: 'Module'
};

export const normalizeFilamentSource = (
  value: unknown,
  legacyOwnFilament?: boolean
): FilamentSource => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase().replace(/-/g, '_');
    if (FILAMENT_SOURCE_VALUES.includes(normalized as FilamentSource)) {
      return normalized as FilamentSource;
    }
  }

  return legacyOwnFilament ? 'student_provided' : DEFAULT_FILAMENT_SOURCE;
};

export const isProvidedFilamentSource = (source: FilamentSource) => source !== 'misc';

export const filamentSourceToOwnFilament = (source: FilamentSource) =>
  isProvidedFilamentSource(source);

export const getPartFilamentSource = (
  explicitSource: unknown,
  legacyOwnFilament?: boolean
) => normalizeFilamentSource(explicitSource, legacyOwnFilament);

export const filamentSourceLabel = (source: FilamentSource) =>
  FILAMENT_SOURCE_LABELS[source];

export const filamentSourceShortLabel = (source: FilamentSource) =>
  FILAMENT_SOURCE_SHORT_LABELS[source];
