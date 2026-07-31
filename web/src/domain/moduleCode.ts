const MODULE_CODE_INPUT_PATTERN = /^([A-Za-z]{3})\s*(\d{3})$/;

export const normalizeModuleCode = (value: string): string | null => {
  const match = value.trim().match(MODULE_CODE_INPUT_PATTERN);
  return match ? `${match[1].toUpperCase()} ${match[2]}` : null;
};

export const isValidModuleCode = (value: string): boolean => normalizeModuleCode(value) !== null;
