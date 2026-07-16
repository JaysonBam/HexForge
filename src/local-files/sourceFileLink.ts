import type { LocalProjectFile } from '../../shared/localHelperProtocol';
import type { Part } from '../types';

export const normalizeSourceFilePath = (value: string): string =>
  value.replaceAll('\\', '/').replace(/^\.\//, '').toLocaleLowerCase();

export const isFileLinkedToParts = (file: LocalProjectFile, parts: Part[]): boolean => {
  const filePath = normalizeSourceFilePath(file.relativePath);
  return parts.some((part) =>
    Boolean(part.sourceFilePath)
    && normalizeSourceFilePath(part.sourceFilePath as string) === filePath);
};

export const findLinkedLocalFile = (
  sourceFilePath: string,
  files: LocalProjectFile[]
): LocalProjectFile | undefined => {
  const linkedPath = normalizeSourceFilePath(sourceFilePath);
  return files.find((file) => normalizeSourceFilePath(file.relativePath) === linkedPath);
};

export const sourceFileName = (sourceFilePath: string): string => {
  const segments = sourceFilePath.replaceAll('\\', '/').split('/');
  return segments.at(-1) || sourceFilePath;
};
