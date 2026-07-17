import { createReadStream } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  LOCAL_HELPER_API_VERSION,
  LOCAL_HELPER_CLIENT_HEADER,
  LOCAL_HELPER_CLIENT_VALUE,
  LOCAL_HELPER_IDEMPOTENCY_HEADER,
  LOCAL_HELPER_VERSION,
  WORKFLOW_FOLDER_KEYS,
  type HelperErrorPayload,
  type ProjectDescriptor,
  type ProjectResolution,
  type SlicerHint,
  type WorkflowFolderKey
} from '../../../shared/localHelperProtocol.js';
import type { ConfigStore, HelperConfig } from './config.js';
import type { CopyOperationManager } from './copyOperations.js';
import { classifySupportedFile, scanProjectFiles } from './fileScanner.js';
import {
  chooseClearFolderMatch,
  createProjectFolder,
  findProjectFolderMatches,
  isPathWithinRoot,
  getFolderSyncState,
  syncProjectFolder,
  type WorkflowFolderPaths,
  type FolderMatch
} from './folders.js';
import type { RotatingLogger } from './logger.js';
import { isUuid, OpaqueRegistry } from './registry.js';

const MAX_BODY_BYTES = 32 * 1024;
const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = ['content-type', LOCAL_HELPER_CLIENT_HEADER.toLocaleLowerCase(), LOCAL_HELPER_IDEMPOTENCY_HEADER.toLocaleLowerCase()];
const configuredWorkflowFolders = (config: HelperConfig): WorkflowFolderPaths | null => {
  if (!WORKFLOW_FOLDER_KEYS.every((key) => typeof config.workflowFolders[key] === 'string' && config.workflowFolders[key])) return null;
  return config.workflowFolders as WorkflowFolderPaths;
};

type ApiDependencies = {
  configStore: ConfigStore;
  registry: OpaqueRegistry;
  logger: RotatingLogger;
  copyOperations: CopyOperationManager;
  openFile: (filePath: string, kind: NonNullable<ReturnType<typeof classifySupportedFile>>['kind'], hint: SlicerHint, config: HelperConfig) => Promise<void>;
  openFolder: (folderPath: string) => Promise<void>;
  openSettings: () => void;
};

type CachedResponse = { status: number; payload: unknown; expiresAt: number };

const errorPayload = (code: string, message: string): HelperErrorPayload => ({ error: { code, message } });

const sendJson = (response: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  response.end(body);
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
};

const isProjectDescriptor = (value: unknown): value is ProjectDescriptor => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const project = value as Record<string, unknown>;
  return typeof project.projectId === 'string'
    && /^[A-Z0-9]{5}$/i.test(project.projectId)
    && Number.isInteger(project.priorityNumber)
    && Number(project.priorityNumber) >= 1
    && typeof project.studentName === 'string'
    && project.studentName.trim().length > 0
    && typeof project.studentNumber === 'string'
    && /^u?\d{8}$/i.test(project.studentNumber.trim())
    && (project.expectedWorkflowFolder === undefined || WORKFLOW_FOLDER_KEYS.includes(project.expectedWorkflowFolder as WorkflowFolderKey))
    && (project.expectTbc === undefined || typeof project.expectTbc === 'boolean');
};

const projectResolution = (match: FolderMatch, project: ProjectDescriptor, registry: OpaqueRegistry, status: 'matched' | 'created'): ProjectResolution => ({
  status,
  projectKey: registry.registerProject(match),
  folderName: match.folderName,
  relativePath: match.relativePath,
  workflowFolder: match.workflowFolder,
  sync: getFolderSyncState(match, project)
});

export class LocalApiServer {
  private server: http.Server | null = null;
  private readonly idempotencyCache = new Map<string, CachedResponse>();

  constructor(private readonly dependencies: ApiDependencies) {}

  async start(): Promise<void> {
    if (this.server) return;
    const config = this.dependencies.configStore.get();
    this.server = http.createServer((request, response) => {
      void this.handle(request, response).catch(async (error) => {
        await this.dependencies.logger.error('api_request_failed', {
          method: request.method,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        if (!response.headersSent) sendJson(response, 500, errorPayload('INTERNAL_ERROR', 'The helper could not complete the request.'));
        else response.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(config.port, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
      await this.stop();
      throw new Error('Helper API failed to bind exclusively to IPv4 loopback.');
    }
    await this.dependencies.logger.info('api_started', { port: config.port });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private applyCors(request: IncomingMessage, response: ServerResponse): boolean {
    const origin = request.headers.origin;
    const config = this.dependencies.configStore.get();
    if (!origin || !config.allowedOrigins.includes(origin)) return false;
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');
    return true;
  }

  private handlePreflight(request: IncomingMessage, response: ServerResponse): void {
    if (!this.applyCors(request, response)) {
      sendJson(response, 403, errorPayload('ORIGIN_NOT_ALLOWED', 'This web origin is not allowed to use the helper.'));
      return;
    }
    const requestedMethod = String(request.headers['access-control-request-method'] ?? '').toUpperCase();
    const requestedHeaders = String(request.headers['access-control-request-headers'] ?? '')
      .split(',')
      .map((header) => header.trim().toLocaleLowerCase())
      .filter(Boolean);
    if (!['GET', 'POST'].includes(requestedMethod) || requestedHeaders.some((header) => !ALLOWED_HEADERS.includes(header))) {
      sendJson(response, 403, errorPayload('PREFLIGHT_REJECTED', 'The requested method or headers are not allowed.'));
      return;
    }
    response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    response.setHeader('Access-Control-Allow-Headers', `${LOCAL_HELPER_CLIENT_HEADER}, ${LOCAL_HELPER_IDEMPOTENCY_HEADER}, Content-Type`);
    response.setHeader('Access-Control-Max-Age', '600');
    if (String(request.headers['access-control-request-private-network']).toLocaleLowerCase() === 'true') {
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    response.writeHead(204);
    response.end();
  }

  private async rootState(config: HelperConfig): Promise<{ configured: boolean; available: boolean }> {
    const workflowFolders = configuredWorkflowFolders(config);
    if (!workflowFolders) return { configured: false, available: false };
    try {
      await Promise.all(WORKFLOW_FOLDER_KEYS.map(async (key) => {
        await access(workflowFolders[key]);
        await realpath(workflowFolders[key]);
      }));
      return { configured: true, available: true };
    } catch {
      return { configured: true, available: false };
    }
  }

  private requireIdempotency(request: IncomingMessage, route: string): { key: string; cached: CachedResponse | null } | null {
    const value = String(request.headers[LOCAL_HELPER_IDEMPOTENCY_HEADER.toLocaleLowerCase()] ?? '');
    if (!isUuid(value)) return null;
    const key = `${route}:${value}`;
    const cached = this.idempotencyCache.get(key) ?? null;
    if (cached && cached.expiresAt <= Date.now()) {
      this.idempotencyCache.delete(key);
      return { key, cached: null };
    }
    return { key, cached };
  }

  private cacheResponse(key: string, status: number, payload: unknown): void {
    this.idempotencyCache.set(key, { status, payload, expiresAt: Date.now() + 10 * 60_000 });
  }

  private async validateRegisteredFile(fileId: string) {
    const registeredFile = this.dependencies.registry.getFile(fileId);
    if (!registeredFile) return null;
    const project = this.dependencies.registry.getProject(registeredFile.projectKey);
    if (!project) return null;
    const canonicalProject = await realpath(project.absolutePath);
    const canonicalFile = await realpath(registeredFile.absolutePath);
    const currentStats = await stat(canonicalFile);
    if (!isPathWithinRoot(canonicalProject, canonicalFile)
      || currentStats.size !== registeredFile.size
      || currentStats.mtimeMs !== registeredFile.modifiedMs) return null;
    return { ...registeredFile, absolutePath: canonicalFile, stats: currentStats };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'OPTIONS') {
      this.handlePreflight(request, response);
      return;
    }
    if (!this.applyCors(request, response)) {
      sendJson(response, 403, errorPayload('ORIGIN_NOT_ALLOWED', 'This web origin is not allowed to use the helper.'));
      return;
    }
    if (request.headers[LOCAL_HELPER_CLIENT_HEADER.toLocaleLowerCase()] !== LOCAL_HELPER_CLIENT_VALUE) {
      sendJson(response, 403, errorPayload('CLIENT_HEADER_REQUIRED', 'The required Printing Manager client header is missing.'));
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const config = this.dependencies.configStore.get();

    if (request.method === 'GET' && pathname === '/v1/health') {
      const root = await this.rootState(config);
      sendJson(response, 200, {
        apiVersion: LOCAL_HELPER_API_VERSION,
        helperVersion: LOCAL_HELPER_VERSION,
        state: !root.configured ? 'not_configured' : root.available ? 'connected' : 'root_unavailable',
        configured: root.configured,
        rootAvailable: root.available,
        installationId: config.installationId,
        port: config.port,
        defaultApplications: config.defaultApplications
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/v1/settings/open') {
      const idempotency = this.requireIdempotency(request, pathname);
      if (!idempotency) {
        sendJson(response, 400, errorPayload('IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.'));
        return;
      }
      if (idempotency.cached) {
        sendJson(response, idempotency.cached.status, idempotency.cached.payload);
        return;
      }
      this.dependencies.openSettings();
      const payload = { ok: true };
      this.cacheResponse(idempotency.key, 200, payload);
      sendJson(response, 200, payload);
      return;
    }

    const folderState = await this.rootState(config);
    const workflowFolders = configuredWorkflowFolders(config);
    if (!folderState.configured || !workflowFolders) {
      sendJson(response, 409, errorPayload('NOT_CONFIGURED', 'Choose all four workflow folders in helper settings.'));
      return;
    }
    if (!folderState.available) {
      sendJson(response, 503, errorPayload('ROOT_UNAVAILABLE', 'One or more configured workflow folders are unavailable.'));
      return;
    }

    if (request.method === 'POST' && pathname === '/v1/projects/resolve') {
      const body = await readJsonBody(request) as Record<string, unknown>;
      if (!isProjectDescriptor(body.project)) {
        sendJson(response, 400, errorPayload('INVALID_PROJECT', 'Project metadata is incomplete or invalid.'));
        return;
      }
      if (typeof body.candidateId === 'string') {
        const candidate = this.dependencies.registry.consumeCandidate(body.candidateId);
        const candidateRoot = candidate ? workflowFolders[candidate.workflowFolder] : null;
        if (!candidate || !candidateRoot || !isPathWithinRoot(candidateRoot, candidate.absolutePath)) {
          sendJson(response, 404, errorPayload('UNKNOWN_CANDIDATE', 'The selected folder candidate is no longer available.'));
          return;
        }
        sendJson(response, 200, projectResolution({ ...candidate, score: 0, studentNumberMatch: false }, body.project, this.dependencies.registry, 'matched'));
        return;
      }
      const matches = await findProjectFolderMatches(workflowFolders, body.project);
      const clearMatch = chooseClearFolderMatch(matches);
      if (clearMatch) {
        sendJson(response, 200, projectResolution(clearMatch, body.project, this.dependencies.registry, 'matched'));
        return;
      }
      if (!matches.length) {
        sendJson(response, 200, { status: 'not_found' } satisfies ProjectResolution);
        return;
      }
      sendJson(response, 200, {
        status: 'ambiguous',
        candidates: matches.map((match) => ({
          candidateId: this.dependencies.registry.registerCandidate(match),
          folderName: match.folderName,
          relativePath: match.relativePath,
          workflowFolder: match.workflowFolder
        }))
      } satisfies ProjectResolution);
      return;
    }

    if (request.method === 'POST' && pathname === '/v1/projects/create') {
      const idempotency = this.requireIdempotency(request, pathname);
      if (!idempotency) {
        sendJson(response, 400, errorPayload('IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.'));
        return;
      }
      if (idempotency.cached) {
        sendJson(response, idempotency.cached.status, idempotency.cached.payload);
        return;
      }
      const body = await readJsonBody(request) as Record<string, unknown>;
      if (!isProjectDescriptor(body.project)) {
        sendJson(response, 400, errorPayload('INVALID_PROJECT', 'Project metadata is incomplete or invalid.'));
        return;
      }
      const matches = await findProjectFolderMatches(workflowFolders, body.project);
      const clearMatch = chooseClearFolderMatch(matches);
      let status = 200;
      let payload: ProjectResolution;
      if (clearMatch) payload = projectResolution(clearMatch, body.project, this.dependencies.registry, 'matched');
      else if (matches.length) {
        status = 409;
        payload = {
          status: 'ambiguous',
          candidates: matches.map((match) => ({
            candidateId: this.dependencies.registry.registerCandidate(match),
            folderName: match.folderName,
            relativePath: match.relativePath,
            workflowFolder: match.workflowFolder
          }))
        };
      } else payload = projectResolution(await createProjectFolder(workflowFolders, body.project), { ...body.project, expectedWorkflowFolder: 'to_be_printed', expectTbc: true }, this.dependencies.registry, 'created');
      this.cacheResponse(idempotency.key, status, payload);
      sendJson(response, status, payload);
      return;
    }

    const openProjectFolderMatch = pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/open-folder$/i);
    if (request.method === 'POST' && openProjectFolderMatch) {
      const idempotency = this.requireIdempotency(request, pathname);
      if (!idempotency) {
        sendJson(response, 400, errorPayload('IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.'));
        return;
      }
      if (idempotency.cached) {
        sendJson(response, idempotency.cached.status, idempotency.cached.payload);
        return;
      }
      const project = this.dependencies.registry.getProject(openProjectFolderMatch[1]);
      if (!project) {
        sendJson(response, 404, errorPayload('UNKNOWN_PROJECT', 'Resolve the project folder again.'));
        return;
      }
      try {
        const canonicalRoot = await realpath(workflowFolders[project.workflowFolder]);
        const canonicalProject = await realpath(project.absolutePath);
        if (!isPathWithinRoot(canonicalRoot, canonicalProject)) {
          sendJson(response, 403, errorPayload('PATH_OUTSIDE_ROOT', 'The project folder is outside the configured root.'));
          return;
        }
        await this.dependencies.openFolder(canonicalProject);
        const payload = { ok: true };
        this.cacheResponse(idempotency.key, 200, payload);
        sendJson(response, 200, payload);
      } catch (error) {
        sendJson(response, 409, errorPayload('FOLDER_OPEN_FAILED', error instanceof Error ? error.message : 'The project folder could not be opened.'));
      }
      return;
    }

    const projectFilesMatch = pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/files$/i);
    if (request.method === 'GET' && projectFilesMatch) {
      const projectKey = projectFilesMatch[1];
      const project = this.dependencies.registry.getProject(projectKey);
      if (!project) {
        sendJson(response, 404, errorPayload('UNKNOWN_PROJECT', 'Resolve the project folder again.'));
        return;
      }
      sendJson(response, 200, await scanProjectFiles({
        rootPath: workflowFolders[project.workflowFolder],
        projectKey,
        projectFolder: project,
        config,
        registry: this.dependencies.registry
      }));
      return;
    }

    const contentMatch = pathname.match(/^\/v1\/files\/([0-9a-f]{64})\/content$/i);
    if (request.method === 'GET' && contentMatch) {
      const file = await this.validateRegisteredFile(contentMatch[1]);
      if (!file) {
        sendJson(response, 409, errorPayload('STALE_FILE', 'The file changed or was renamed. Refresh local files and try again.'));
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': file.stats.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file.absolutePath))}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });
      createReadStream(file.absolutePath).pipe(response);
      return;
    }

    const openMatch = pathname.match(/^\/v1\/files\/([0-9a-f]{64})\/open$/i);
    if (request.method === 'POST' && openMatch) {
      const idempotency = this.requireIdempotency(request, pathname);
      if (!idempotency) {
        sendJson(response, 400, errorPayload('IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.'));
        return;
      }
      if (idempotency.cached) {
        sendJson(response, idempotency.cached.status, idempotency.cached.payload);
        return;
      }
      const file = await this.validateRegisteredFile(openMatch[1]);
      const classification = file ? classifySupportedFile(file.absolutePath) : null;
      if (!file || !classification) {
        sendJson(response, 409, errorPayload('STALE_FILE', 'The file changed or is no longer supported.'));
        return;
      }
      const body = await readJsonBody(request) as Record<string, unknown>;
      const hint = ['auto', 'bambu', 'cura', 'system'].includes(String(body.slicerHint)) ? body.slicerHint as SlicerHint : 'auto';
      try {
        await this.dependencies.openFile(file.absolutePath, classification.kind, hint, config);
        const payload = { ok: true };
        this.cacheResponse(idempotency.key, 200, payload);
        sendJson(response, 200, payload);
      } catch (error) {
        sendJson(response, 409, errorPayload('APPLICATION_NOT_CONFIGURED', error instanceof Error ? error.message : 'Application launch failed.'));
      }
      return;
    }

    const copyMatch = pathname.match(/^\/v1\/files\/([0-9a-f]{64})\/copy-to-printer$/i);
    if (request.method === 'POST' && copyMatch) {
      const idempotency = this.requireIdempotency(request, pathname);
      if (!idempotency) {
        sendJson(response, 400, errorPayload('IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.'));
        return;
      }
      if (idempotency.cached) {
        sendJson(response, idempotency.cached.status, idempotency.cached.payload);
        return;
      }
      const file = await this.validateRegisteredFile(copyMatch[1]);
      const classification = file ? classifySupportedFile(file.absolutePath) : null;
      if (!file || !classification || classification.group !== 'print_ready') {
        sendJson(response, 409, errorPayload('NOT_PRINT_READY', 'Only current print-ready files can be copied to printer media.'));
        return;
      }
      const payload = this.dependencies.copyOperations.start(file.absolutePath, file.stats.size);
      this.cacheResponse(idempotency.key, 202, payload);
      sendJson(response, 202, payload);
      return;
    }

    const operationMatch = pathname.match(/^\/v1\/operations\/([0-9a-f-]+)$/i);
    if (request.method === 'GET' && operationMatch) {
      const operation = this.dependencies.copyOperations.get(operationMatch[1]);
      if (!operation) sendJson(response, 404, errorPayload('UNKNOWN_OPERATION', 'The copy operation is no longer available.'));
      else sendJson(response, 200, operation);
      return;
    }

    const syncMatch = pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/sync$/i);
    if (request.method === 'POST' && syncMatch) {
      const idempotency = this.requireIdempotency(request, pathname);
      if (!idempotency) {
        sendJson(response, 400, errorPayload('IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.'));
        return;
      }
      if (idempotency.cached) {
        sendJson(response, idempotency.cached.status, idempotency.cached.payload);
        return;
      }
      const project = this.dependencies.registry.getProject(syncMatch[1]);
      const body = await readJsonBody(request) as Record<string, unknown>;
      if (!project || !isProjectDescriptor(body.project)) {
        sendJson(response, 400, errorPayload('INVALID_SYNC_REQUEST', 'A resolved project and valid expected folder state are required.'));
        return;
      }
      try {
        const current = { ...project, score: 0, studentNumberMatch: false } satisfies FolderMatch;
        const synced = await syncProjectFolder(workflowFolders, current, body.project);
        this.dependencies.registry.updateProject(syncMatch[1], synced);
        const payload = projectResolution(synced, body.project, this.dependencies.registry, 'matched');
        this.cacheResponse(idempotency.key, 200, payload);
        sendJson(response, 200, payload);
      } catch (error) {
        sendJson(response, 409, errorPayload('FOLDER_SYNC_FAILED', error instanceof Error ? error.message : 'Folder move or rename failed.'));
      }
      return;
    }

    sendJson(response, 404, errorPayload('NOT_FOUND', 'The requested helper endpoint does not exist.'));
  }
}
