import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';
import type { SlicerHint, SupportedFileKind } from '../../../shared/localHelperProtocol.js';
import type { HelperConfig } from './config.js';

const existingPath = async (candidate: string | undefined): Promise<string | null> => {
  if (!candidate) return null;
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
};

export const detectSlicerPaths = async (): Promise<{ bambuStudioPath: string | null; curaPath: string | null }> => {
  const programFiles = process.env.ProgramFiles;
  const localAppData = process.env.LOCALAPPDATA;
  const bambuCandidates = [
    programFiles ? path.join(programFiles, 'Bambu Studio', 'bambu-studio.exe') : undefined,
    localAppData ? path.join(localAppData, 'Programs', 'Bambu Studio', 'bambu-studio.exe') : undefined
  ];
  const curaCandidates = [
    programFiles ? path.join(programFiles, 'UltiMaker Cura 5.10.0', 'UltiMaker-Cura.exe') : undefined,
    programFiles ? path.join(programFiles, 'UltiMaker Cura 5.9.0', 'UltiMaker-Cura.exe') : undefined,
    localAppData ? path.join(localAppData, 'Programs', 'UltiMaker Cura', 'UltiMaker-Cura.exe') : undefined
  ];
  let bambuStudioPath: string | null = null;
  let curaPath: string | null = null;
  for (const candidate of bambuCandidates) {
    bambuStudioPath = await existingPath(candidate);
    if (bambuStudioPath) break;
  }
  for (const candidate of curaCandidates) {
    curaPath = await existingPath(candidate);
    if (curaPath) break;
  }
  return { bambuStudioPath, curaPath };
};

const selectApplication = (config: HelperConfig, kind: SupportedFileKind, hint: SlicerHint) => {
  if (kind === 'ufp') return 'cura';
  if (kind === 'gcode.3mf') return 'bambu';
  if (hint !== 'auto') return hint;
  const mappedKind = ['step', 'stp', 'obj'].includes(kind) ? 'stl' : kind;
  return config.defaultApplications[mappedKind as SupportedFileKind] ?? 'system';
};

export const openSupportedFile = async (
  filePath: string,
  kind: SupportedFileKind,
  hint: SlicerHint,
  config: HelperConfig
): Promise<void> => {
  const application = selectApplication(config, kind, hint);
  if (application === 'system') {
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) throw new Error(errorMessage);
    return;
  }
  const executablePath = application === 'bambu' ? config.bambuStudioPath : config.curaPath;
  if (!executablePath || path.extname(executablePath).toLocaleLowerCase() !== '.exe' || !(await existingPath(executablePath))) {
    throw new Error(`${application === 'bambu' ? 'Bambu Studio' : 'UltiMaker Cura'} is not configured or cannot be found.`);
  }
  const child = spawn(executablePath, [filePath], {
    detached: true,
    shell: false,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
};
