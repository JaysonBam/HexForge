export interface Filament {
  id: string;
  type: string;
  pricePerGram: number;
}

export interface FilamentPriceGroup {
  pricePerGram: number;
  filaments: Filament[];
}

const canonicalFilamentType = (type: string) => type.trim().toUpperCase();

const toFinitePrice = (value: unknown, fallback = 0) => {
  const price = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(price) && price >= 0 ? price : fallback;
};

const normalizeFilamentRow = (value: unknown): Filament | null => {
  if (!value || typeof value !== 'object') return null;

  const row = value as Partial<Filament>;
  const type = typeof row.type === 'string' ? row.type.trim() : '';
  if (!type) return null;

  const canonicalType = canonicalFilamentType(type);
  return {
    id: typeof row.id === 'string' && row.id.trim() ? row.id : `filament-${canonicalType.toLowerCase()}`,
    type,
    pricePerGram: toFinitePrice(row.pricePerGram)
  };
};

export const normalizeFilamentSettings = (value: unknown): Filament[] => {
  const rows = Array.isArray(value) ? value : [];
  const byType = new Map<string, Filament>();

  rows.forEach((row) => {
    const filament = normalizeFilamentRow(row);
    if (!filament) return;
    byType.set(canonicalFilamentType(filament.type), filament);
  });

  return Array.from(byType.entries())
    .map(([, filament]) => filament)
    .sort((left, right) => left.type.localeCompare(right.type));
};

export const groupFilamentsByPrice = (filaments: Filament[]): FilamentPriceGroup[] => {
  const groups = new Map<number, Filament[]>();

  filaments.forEach((filament) => {
    const price = toFinitePrice(filament.pricePerGram);
    groups.set(price, [...(groups.get(price) ?? []), filament]);
  });

  return Array.from(groups.entries())
    .map(([pricePerGram, groupFilaments]) => ({
      pricePerGram,
      filaments: groupFilaments.sort((left, right) => left.type.localeCompare(right.type))
    }))
    .sort((left, right) => left.pricePerGram - right.pricePerGram);
};
