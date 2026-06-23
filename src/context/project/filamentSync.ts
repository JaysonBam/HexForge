import type { Part } from '../../types';
import {
  filamentSourceToOwnFilament,
  normalizeFilamentSource
} from '../../domain/filamentSource.ts';

export const withSyncedFilamentFlags = (data: Partial<Part>): Partial<Part> => {
  const synced = { ...data };

  if ('primaryFilamentSource' in synced) {
    const source = normalizeFilamentSource(synced.primaryFilamentSource, synced.primaryOwnFilament);
    synced.primaryFilamentSource = source;
    synced.primaryOwnFilament = filamentSourceToOwnFilament(source);
  } else if ('primaryOwnFilament' in synced) {
    synced.primaryFilamentSource = normalizeFilamentSource(undefined, synced.primaryOwnFilament);
  }

  if ('secondaryFilamentSource' in synced) {
    const source = normalizeFilamentSource(synced.secondaryFilamentSource, synced.secondaryOwnFilament);
    synced.secondaryFilamentSource = source;
    synced.secondaryOwnFilament = filamentSourceToOwnFilament(source);
  } else if ('secondaryOwnFilament' in synced) {
    synced.secondaryFilamentSource = normalizeFilamentSource(undefined, synced.secondaryOwnFilament);
  }

  return synced;
};
