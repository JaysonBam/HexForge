import {
  LOCAL_HELPER_CLIENT_HEADER,
  LOCAL_HELPER_CLIENT_VALUE,
  LOCAL_HELPER_DEFAULT_PORT,
  LOCAL_HELPER_IDEMPOTENCY_HEADER,
  isCopyOperation,
  isAttachmentSaveResult,
  isHelperErrorPayload,
  isHelperHealth,
  isProjectFilesResponse,
  isProjectResolution,
  type CopyOperation,
  type AttachmentSaveResult,
  type HelperHealth,
  type LocalProjectFile,
  type ProjectDescriptor,
  type ProjectFilesResponse,
  type ProjectResolution,
  type SlicerHint
} from '../../shared/localHelperProtocol';

const PORT_STORAGE_KEY = 'hexForge.fileHelperPort';

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace: 'loopback';
};

export class LocalHelperError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(
    code: string,
    message: string,
    status?: number
  ) {
    super(message);
    this.name = 'LocalHelperError';
    this.code = code;
    this.status = status;
  }
}

export const getStoredHelperPort = (): number => {
  const configuredDefault = Number(import.meta.env.VITE_HEXFORGE_FILE_HELPER_PORT || LOCAL_HELPER_DEFAULT_PORT);
  const fallback = Number.isInteger(configuredDefault) && configuredDefault >= 1024 && configuredDefault <= 65535
    ? configuredDefault
    : LOCAL_HELPER_DEFAULT_PORT;
  try {
    const stored = Number(window.localStorage.getItem(PORT_STORAGE_KEY));
    return Number.isInteger(stored) && stored >= 1024 && stored <= 65535 ? stored : fallback;
  } catch {
    return fallback;
  }
};

export const storeHelperPort = (port: number): void => {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
  window.localStorage.setItem(PORT_STORAGE_KEY, String(port));
};

const combineAbort = (timeoutMs: number, externalSignal?: AbortSignal) => {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  };
};

export class LocalHelperClient {
  readonly baseUrl: string;
  readonly port: number;
  private readonly fetcher: typeof fetch;

  constructor(port: number, fetcher: typeof fetch = fetch) {
    this.port = port;
    this.fetcher = ((input: URL | RequestInfo, init?: RequestInit) =>
      fetcher.call(globalThis, input, init)) as typeof fetch;
    this.baseUrl = `http://127.0.0.1:${port}/v1`;
  }

  private async requestJson<T>(args: {
    path: string;
    method?: 'GET' | 'POST';
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
    idempotent?: boolean;
    validate: (value: unknown) => value is T;
    acceptedStatuses?: number[];
  }): Promise<T> {
    const abort = combineAbort(args.timeoutMs ?? 2_000, args.signal);
    try {
      const requestInit: LocalNetworkRequestInit = {
        method: args.method ?? 'GET',
        mode: 'cors',
        cache: 'no-store',
        targetAddressSpace: 'loopback',
        signal: abort.signal,
        headers: {
          [LOCAL_HELPER_CLIENT_HEADER]: LOCAL_HELPER_CLIENT_VALUE,
          ...(args.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(args.idempotent ? { [LOCAL_HELPER_IDEMPOTENCY_HEADER]: crypto.randomUUID() } : {})
        },
        body: args.body === undefined ? undefined : JSON.stringify(args.body)
      };
      const response = await this.fetcher(`${this.baseUrl}${args.path}`, requestInit);
      const value: unknown = await response.json().catch(() => null);
      const accepted = response.ok || args.acceptedStatuses?.includes(response.status);
      if (!accepted) {
        if (isHelperErrorPayload(value)) throw new LocalHelperError(value.error.code, value.error.message, response.status);
        throw new LocalHelperError('INVALID_RESPONSE', `Helper request failed with status ${response.status}.`, response.status);
      }
      if (!args.validate(value)) throw new LocalHelperError('INVALID_RESPONSE', 'The helper returned an invalid response.', response.status);
      return value;
    } catch (error) {
      if (error instanceof LocalHelperError) throw error;
      if (abort.signal.aborted) throw new LocalHelperError('TIMEOUT', 'The local helper did not respond in time.');
      throw new LocalHelperError('UNAVAILABLE', error instanceof Error ? error.message : 'The local helper is unavailable.');
    } finally {
      abort.cleanup();
    }
  }

  health(signal?: AbortSignal): Promise<HelperHealth> {
    return this.requestJson({ path: '/health', signal, timeoutMs: 5_000, validate: isHelperHealth });
  }

  resolveProject(project: ProjectDescriptor, signal?: AbortSignal, candidateId?: string): Promise<ProjectResolution> {
    return this.requestJson({
      path: '/projects/resolve',
      method: 'POST',
      body: { project, ...(candidateId ? { candidateId } : {}) },
      signal,
      validate: isProjectResolution
    });
  }

  createProjectFolder(project: ProjectDescriptor, signal?: AbortSignal): Promise<ProjectResolution> {
    return this.requestJson({
      path: '/projects/create',
      method: 'POST',
      body: { project },
      signal,
      idempotent: true,
      validate: isProjectResolution,
      acceptedStatuses: [409]
    });
  }

  syncProjectFolder(projectKey: string, project: ProjectDescriptor, signal?: AbortSignal): Promise<ProjectResolution> {
    return this.requestJson({
      path: `/projects/${encodeURIComponent(projectKey)}/sync`,
      method: 'POST',
      body: { project },
      signal,
      idempotent: true,
      timeoutMs: 30_000,
      validate: isProjectResolution
    });
  }

  listProjectFiles(projectKey: string, signal?: AbortSignal): Promise<ProjectFilesResponse> {
    return this.requestJson({
      path: `/projects/${encodeURIComponent(projectKey)}/files`,
      signal,
      timeoutMs: 8_000,
      validate: isProjectFilesResponse
    });
  }

  async saveProjectAttachment(
    projectKey: string,
    filename: string,
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Promise<AttachmentSaveResult> {
    const abort = combineAbort(120_000, signal);
    try {
      const url = new URL(`${this.baseUrl}/projects/${encodeURIComponent(projectKey)}/attachments`);
      url.searchParams.set('filename', filename);
      url.searchParams.set('size', String(bytes.byteLength));
      const requestInit: LocalNetworkRequestInit = {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        targetAddressSpace: 'loopback',
        signal: abort.signal,
        headers: {
          [LOCAL_HELPER_CLIENT_HEADER]: LOCAL_HELPER_CLIENT_VALUE,
          [LOCAL_HELPER_IDEMPOTENCY_HEADER]: crypto.randomUUID(),
          'Content-Type': 'application/octet-stream'
        },
        body: bytes.slice().buffer as ArrayBuffer
      };
      const response = await this.fetcher(url, requestInit);
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (isHelperErrorPayload(value)) throw new LocalHelperError(value.error.code, value.error.message, response.status);
        throw new LocalHelperError('ATTACHMENT_SAVE_FAILED', `The helper could not save the attachment (${response.status}).`, response.status);
      }
      if (!isAttachmentSaveResult(value)) throw new LocalHelperError('INVALID_RESPONSE', 'The helper returned an invalid attachment result.');
      return value;
    } catch (error) {
      if (error instanceof LocalHelperError) throw error;
      if (abort.signal.aborted) throw new LocalHelperError('TIMEOUT', 'Saving the Gmail attachment timed out.');
      throw new LocalHelperError('UNAVAILABLE', error instanceof Error ? error.message : 'The local helper is unavailable.');
    } finally {
      abort.cleanup();
    }
  }

  openProjectFolder(projectKey: string): Promise<{ ok: true }> {
    return this.requestJson({
      path: `/projects/${encodeURIComponent(projectKey)}/open-folder`,
      method: 'POST',
      body: {},
      idempotent: true,
      validate: (value): value is { ok: true } => Boolean(value) && typeof value === 'object' && (value as { ok?: unknown }).ok === true
    });
  }

  async readFile(file: LocalProjectFile, signal?: AbortSignal): Promise<File> {
    const abort = combineAbort(120_000, signal);
    try {
      const requestInit: LocalNetworkRequestInit = {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        targetAddressSpace: 'loopback',
        signal: abort.signal,
        headers: { [LOCAL_HELPER_CLIENT_HEADER]: LOCAL_HELPER_CLIENT_VALUE }
      };
      const response = await this.fetcher(`${this.baseUrl}/files/${encodeURIComponent(file.fileId)}/content`, requestInit);
      if (!response.ok) {
        const value: unknown = await response.json().catch(() => null);
        if (isHelperErrorPayload(value)) throw new LocalHelperError(value.error.code, value.error.message, response.status);
        throw new LocalHelperError('CONTENT_FAILED', `The local file could not be read (${response.status}).`, response.status);
      }
      return new File([await response.blob()], file.filename, { lastModified: Date.parse(file.modifiedAt) || Date.now() });
    } catch (error) {
      if (error instanceof LocalHelperError) throw error;
      if (abort.signal.aborted) throw new LocalHelperError('TIMEOUT', 'Reading the local file timed out.');
      throw new LocalHelperError('UNAVAILABLE', error instanceof Error ? error.message : 'The local file could not be read.');
    } finally {
      abort.cleanup();
    }
  }

  openFile(fileId: string, slicerHint: SlicerHint): Promise<{ ok: true }> {
    return this.requestJson({
      path: `/files/${encodeURIComponent(fileId)}/open`,
      method: 'POST',
      body: { slicerHint },
      idempotent: true,
      validate: (value): value is { ok: true } => Boolean(value) && typeof value === 'object' && (value as { ok?: unknown }).ok === true
    });
  }

  startCopy(fileId: string): Promise<CopyOperation> {
    return this.requestJson({
      path: `/files/${encodeURIComponent(fileId)}/copy-to-printer`,
      method: 'POST',
      body: {},
      idempotent: true,
      timeoutMs: 5_000,
      validate: isCopyOperation,
      acceptedStatuses: [202]
    });
  }

  getCopyOperation(operationId: string, signal?: AbortSignal): Promise<CopyOperation> {
    return this.requestJson({ path: `/operations/${encodeURIComponent(operationId)}`, signal, validate: isCopyOperation });
  }

  openSettings(): Promise<{ ok: true }> {
    return this.requestJson({
      path: '/settings/open',
      method: 'POST',
      body: {},
      idempotent: true,
      validate: (value): value is { ok: true } => Boolean(value) && typeof value === 'object' && (value as { ok?: unknown }).ok === true
    });
  }
}
