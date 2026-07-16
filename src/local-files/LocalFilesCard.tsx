import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileInput, Folder, FolderOpen, FolderPlus, Loader2, RefreshCw, Settings, Usb } from 'lucide-react';
import type { DefaultApplication, LocalProjectFile, ProjectResolution, SlicerHint, SupportedFileKind } from '../../shared/localHelperProtocol';
import type { Project } from '../types';
import { useProjects } from '../context/ProjectContext';
import { useSettings } from '../context/SettingsContext';
import { useFeedback } from '../components/ui/FeedbackProvider';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { uploadThumbnailFromBlobUrl } from '../utils/storageUtils';
import { useLocalHelper } from './LocalHelperContext';
import { runSequentialImports } from './importSequence';
import { analyzeProjectFiles } from './projectFileImport';

type MatchedResolution = Extract<ProjectResolution, { status: 'matched' | 'created' }>;

const slicerHintFor = (project: Project, file: LocalProjectFile): SlicerHint => {
  if (file.kind === 'ufp') return 'cura';
  if (file.kind === 'gcode.3mf') return 'bambu';
  const printerText = project.parts.map((part) => part.printerName ?? '').join(' ').toLocaleLowerCase();
  if (printerText.includes('bambu')) return 'bambu';
  if (printerText.includes('ultimaker') || printerText.includes('cura')) return 'cura';
  return 'auto';
};

const openLabel = (hint: SlicerHint) => hint === 'bambu'
  ? 'Open in Bambu Studio'
  : hint === 'cura'
    ? 'Open in UltiMaker Cura'
    : 'Open';

const displayedSlicerHintFor = (
  project: Project,
  file: LocalProjectFile,
  defaults?: Partial<Record<SupportedFileKind, DefaultApplication>>
): SlicerHint => {
  const projectHint = slicerHintFor(project, file);
  if (projectHint !== 'auto') return projectHint;
  const mappedKind = ['step', 'stp', 'obj'].includes(file.kind) ? 'stl' : file.kind;
  return defaults?.[mappedKind as SupportedFileKind] ?? 'system';
};

const fileDisplayPath = (file: LocalProjectFile) => file.relativePath.replaceAll('\\', '/');

const fileActionClass = 'forge-focus-ring inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-800 disabled:pointer-events-none disabled:opacity-45';

const SlicerIcon = ({ hint }: { hint: SlicerHint }) => {
  if (hint === 'bambu') return <img src="/images/slicers/bambu-studio.png" alt="" className="h-full w-full rounded-[5px] object-cover" />;
  if (hint === 'cura') return <img src="/images/slicers/cura.png" alt="" className="h-full w-full rounded-[5px] object-cover" />;
  return <ExternalLink size={14} />;
};

export const LocalFilesCard = ({ project }: { project: Project }) => {
  const { state, health, client } = useLocalHelper();
  const { addExtractedParts, syncStatus } = useProjects();
  const { getFilamentPrice } = useSettings();
  const { confirm, notify, showMessage } = useFeedback();
  const [resolution, setResolution] = useState<ProjectResolution | null>(null);
  const [files, setFiles] = useState<LocalProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const descriptor = useMemo(() => ({
    projectId: project.id,
    priorityNumber: project.priorityNumber,
    studentName: project.studentName,
    studentNumber: project.studentNumber,
    module: project.course
  }), [
    project.course,
    project.id,
    project.priorityNumber,
    project.studentName,
    project.studentNumber
  ]);

  const loadFiles = useCallback(async (matched: MatchedResolution, signal?: AbortSignal) => {
    const response = await client.listProjectFiles(matched.projectKey, signal);
    setFiles(response.files);
  }, [client]);

  const resolveFolder = useCallback(async () => {
    if (state !== 'connected') return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    try {
      const result = await client.resolveProject(descriptor, controller.signal);
      if (controller.signal.aborted) return;
      setResolution(result);
      if (result.status === 'matched' || result.status === 'created') await loadFiles(result, controller.signal);
      else setFiles([]);
    } catch {
      if (!controller.signal.aborted) setResolution(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [client, descriptor, loadFiles, state]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setResolution(null);
      setFiles([]);
      if (state === 'connected') void resolveFolder();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      activeRequest.current?.abort();
    };
  }, [project.id, resolveFolder, state]);

  const refreshFiles = useCallback(async () => {
    if (!resolution || (resolution.status !== 'matched' && resolution.status !== 'created')) return;
    setLoading(true);
    try {
      await loadFiles(resolution);
    } catch (error) {
      notify({ title: 'Local files could not refresh', message: error instanceof Error ? error.message : 'Try again.', tone: 'warning' });
    } finally {
      setLoading(false);
    }
  }, [loadFiles, notify, resolution]);

  const createFolder = async () => {
    setActionId('create-folder');
    try {
      const result = await client.createProjectFolder(descriptor);
      setResolution(result);
      if (result.status === 'matched' || result.status === 'created') {
        await loadFiles(result);
        notify({
          title: result.status === 'created' ? 'Folder created' : 'Folder matched',
          message: result.folderName,
          tone: 'success'
        });
      }
    } catch (error) {
      notify({ title: 'Folder was not created', message: error instanceof Error ? error.message : 'The helper could not create the folder.', tone: 'warning' });
    } finally {
      setActionId(null);
    }
  };

  const selectCandidate = async (candidateId: string) => {
    setActionId(candidateId);
    try {
      const result = await client.resolveProject(descriptor, undefined, candidateId);
      setResolution(result);
      if (result.status === 'matched' || result.status === 'created') await loadFiles(result);
    } catch (error) {
      notify({ title: 'Folder could not be selected', message: error instanceof Error ? error.message : 'Refresh and try again.', tone: 'warning' });
    } finally {
      setActionId(null);
    }
  };

  const openProjectFolder = async (matched: MatchedResolution) => {
    setActionId('open-folder');
    try {
      await client.openProjectFolder(matched.projectKey);
    } catch (error) {
      notify({ title: 'Folder could not be opened', message: error instanceof Error ? error.message : 'Refresh local files and try again.', tone: 'warning' });
    } finally {
      setActionId(null);
    }
  };

  const performImport = useCallback(async (file: LocalProjectFile, announce = true): Promise<boolean> => {
    if (file.group !== 'print_ready' || !file.importEligible) return false;
    setActionId(`import:${file.fileId}`);
    try {
      const browserFile = await client.readFile(file);
      const result = await analyzeProjectFiles({
        files: [browserFile],
        startPartNumber: project.parts.length + 1,
        getFilamentPrice,
        uploadThumbnail: uploadThumbnailFromBlobUrl
      });
      if (result.parts.length) {
        const saved = await addExtractedParts(project.id, result.parts);
        if (!saved) throw new Error('HexForge could not save the imported parts.');
        if (announce) notify({ title: 'Local file imported', message: `${file.filename} was added to the existing parts list.`, tone: 'success' });
      }
      if (result.errors.length) await showMessage({ title: 'File needs attention', messages: result.errors, tone: 'warning' });
      return result.parts.length > 0;
    } catch (error) {
      if (announce) notify({ title: 'Import failed', message: error instanceof Error ? error.message : 'The local file could not be imported.', tone: 'error' });
      return false;
    } finally {
      setActionId(null);
    }
  }, [addExtractedParts, client, getFilamentPrice, notify, project.id, project.parts.length, showMessage]);

  const importAll = async () => {
    const candidates = files.filter((file) => file.group === 'print_ready' && file.importEligible);
    if (!candidates.length) return;
    setActionId('import-all');
    const importedCount = await runSequentialImports(candidates, (file) => performImport(file, false));
    setActionId(null);
    await refreshFiles();
    notify({
      title: 'Local import complete',
      message: importedCount ? `${importedCount} file${importedCount === 1 ? '' : 's'} added to the parts list.` : 'No files were imported.',
      tone: importedCount ? 'success' : 'info'
    });
  };

  const openFile = async (file: LocalProjectFile) => {
    setActionId(`open:${file.fileId}`);
    try {
      await client.openFile(file.fileId, slicerHintFor(project, file));
    } catch (error) {
      const shouldOpenSettings = await confirm({
        title: 'File could not be opened',
        message: error instanceof Error ? error.message : 'The configured application is unavailable.',
        messages: ['Open the helper settings to check the slicer application path.'],
        confirmLabel: 'Open helper settings',
        cancelLabel: 'Close',
        tone: 'warning'
      });
      if (shouldOpenSettings) await client.openSettings().catch(() => undefined);
    } finally {
      setActionId(null);
    }
  };

  const copyToPrinter = async (file: LocalProjectFile) => {
    setActionId(`copy:${file.fileId}`);
    try {
      let operation = await client.startCopy(file.fileId);
      const deadline = Date.now() + 5 * 60_000;
      while (['awaiting_destination', 'copying'].includes(operation.status) && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        operation = await client.getCopyOperation(operation.operationId);
      }
      if (operation.status === 'completed') {
        notify({ title: 'Copied to destination', message: `${operation.destinationName ?? file.filename} was copied and verified.`, tone: 'success' });
      } else if (operation.status === 'failed') {
        throw new Error(operation.error || 'The copy could not be completed.');
      }
      await refreshFiles();
    } catch (error) {
      notify({ title: 'Copy failed', message: error instanceof Error ? error.message : 'The file could not be copied.', tone: 'error' });
    } finally {
      setActionId(null);
    }
  };

  const groups = useMemo(() => ({
    model: files.filter((file) => file.group === 'model'),
    print_ready: files.filter((file) => file.group === 'print_ready')
  }), [files]);
  const importableCount = files.filter((file) => file.group === 'print_ready' && file.importEligible).length;

  if (state === 'unavailable' || state === 'not_configured') return null;
  if (state === 'root_unavailable') {
    return (
      <Card className="flex h-full min-h-0 flex-col border-amber-300 bg-amber-50 p-3 print:hidden">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">Local files</p>
        <p className="mt-1 text-xs font-black text-amber-950">Projects root unavailable</p>
        <p className="mt-1 text-[10px] font-semibold leading-relaxed text-amber-800">Reconnect the drive or choose the root again in helper settings.</p>
        <Button variant="outline" size="sm" className="mt-2 h-7 gap-1.5 px-2 text-[10px]" onClick={() => void client.openSettings()}><Settings size={13} /> Helper settings</Button>
      </Card>
    );
  }

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden print:hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-300 bg-gradient-to-r from-slate-100 to-sky-50 px-3 py-2">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">Local files</p>
        <button type="button" onClick={() => void refreshFiles()} disabled={loading || !resolution || resolution.status === 'not_found' || resolution.status === 'ambiguous'} className="forge-focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-sky-700 disabled:opacity-40" aria-label="Refresh local files" title="Refresh local files">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {loading && !resolution && <div className="flex items-center gap-2 text-[11px] font-bold text-slate-600"><Loader2 size={14} className="animate-spin" /> Resolving project folder…</div>}

        {resolution?.status === 'not_found' && (
          <div className="forge-panel-muted p-2.5">
            <div className="flex items-start gap-2"><FolderPlus size={16} className="mt-0.5 shrink-0 text-sky-700" /><div><p className="text-xs font-black text-slate-900">No matching folder yet</p><p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-600">Create it after the project has saved.</p></div></div>
            <Button size="sm" className="mt-2 h-7 w-full gap-1.5 text-[10px]" disabled={syncStatus.saving || actionId === 'create-folder'} onClick={() => void createFolder()}>
              {actionId === 'create-folder' ? <Loader2 size={13} className="animate-spin" /> : <FolderPlus size={13} />} Create Folder
            </Button>
          </div>
        )}

        {resolution?.status === 'ambiguous' && (
          <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
            <p className="text-xs font-black text-slate-900">Choose the matching folder</p>
            <p className="text-[10px] font-semibold leading-relaxed text-slate-600">Several folders use P{project.priorityNumber}; the helper will not guess.</p>
            {resolution.candidates.map((candidate) => (
              <button key={candidate.candidateId} type="button" onClick={() => void selectCandidate(candidate.candidateId)} className="forge-panel-muted flex w-full items-center gap-2 p-2 text-left text-[10px] font-bold text-slate-800 hover:border-sky-400">
                {actionId === candidate.candidateId ? <Loader2 size={13} className="animate-spin" /> : <Folder size={13} className="text-sky-700" />}
                <span className="min-w-0 truncate">{candidate.folderName}</span>
              </button>
            ))}
          </div>
        )}

        {resolution && (resolution.status === 'matched' || resolution.status === 'created') && (
          <>
            <button
              type="button"
              onClick={() => void openProjectFolder(resolution)}
              disabled={actionId !== null}
              className="forge-panel-muted forge-focus-ring group flex w-full shrink-0 items-center gap-2 px-2.5 py-2 text-left transition-colors hover:border-sky-400 hover:bg-sky-50 disabled:opacity-60"
              aria-label={`Open ${resolution.folderName} in File Explorer`}
              title={`Open ${resolution.folderName} in File Explorer`}
            >
              {actionId === 'open-folder' ? <Loader2 size={14} className="shrink-0 animate-spin text-sky-700" /> : <FolderOpen size={14} className="shrink-0 text-sky-700" />}
              <span className="min-w-0 flex-1 truncate text-[10px] font-black text-slate-900">{resolution.folderName}</span>
              <ExternalLink size={11} className="shrink-0 text-slate-400 transition-colors group-hover:text-sky-700" />
            </button>

            <p className="shrink-0 text-center text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
              {files.length} files · {groups.model.length} models · {groups.print_ready.length} print-ready
            </p>

            {importableCount > 1 && <Button variant="outline" size="sm" className="h-7 w-full shrink-0 gap-1.5 px-2 text-[10px]" disabled={actionId !== null} onClick={() => void importAll()}><FileInput size={13} /> Import all ({importableCount})</Button>}

            {files.length === 0 ? (
              <div className="forge-empty min-h-0 flex-1 p-3 text-center text-[10px] font-semibold leading-relaxed text-slate-600">No supported local files found.</div>
            ) : (
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {(['print_ready', 'model'] as const).map((group) => groups[group].length > 0 && (
                  <section key={group} className="space-y-1">
                    <p className="sticky top-0 z-[1] bg-white/95 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-slate-500 backdrop-blur-sm">{group === 'model' ? 'Model files' : 'Print-ready files'} · {groups[group].length}</p>
                    {groups[group].map((file) => {
                      const hint = displayedSlicerHintFor(project, file, health?.defaultApplications);
                      const importing = actionId === `import:${file.fileId}`;
                      const opening = actionId === `open:${file.fileId}`;
                      const copying = actionId === `copy:${file.fileId}`;
                      const displayPath = fileDisplayPath(file);
                      return (
                        <div key={file.fileId} className="flex min-w-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                          <p className="min-w-0 flex-1 truncate font-mono text-[9px] font-bold text-slate-800" title={displayPath}>{displayPath}</p>
                          <div className="flex shrink-0 items-center gap-1">
                            {file.group === 'print_ready' && file.importEligible && (
                              <button type="button" className={fileActionClass} disabled={actionId !== null} onClick={() => void performImport(file)} aria-label={`Import ${displayPath}`} title={`Import ${displayPath}`}>
                                {importing ? <Loader2 size={13} className="animate-spin" /> : <FileInput size={14} />}
                              </button>
                            )}
                            <button type="button" className={fileActionClass} disabled={actionId !== null} onClick={() => void openFile(file)} aria-label={`${openLabel(hint)}: ${displayPath}`} title={`${openLabel(hint)}: ${displayPath}`}>
                              {opening ? <Loader2 size={13} className="animate-spin" /> : <SlicerIcon hint={hint} />}
                            </button>
                            {file.group === 'print_ready' && (
                              <button type="button" className={fileActionClass} disabled={actionId !== null} onClick={() => void copyToPrinter(file)} aria-label={`Move ${displayPath} to printer media`} title={`Move to Printer (copies file): ${displayPath}`}>
                                {copying ? <Loader2 size={13} className="animate-spin" /> : <Usb size={14} />}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
};
