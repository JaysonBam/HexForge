export const runSequentialImports = async <T>(
  items: T[],
  action: (item: T) => Promise<boolean>
): Promise<number> => {
  let completed = 0;
  for (const item of items) {
    if (await action(item)) completed += 1;
  }
  return completed;
};
