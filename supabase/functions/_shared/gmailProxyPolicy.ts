export type AllowedGmailRequest = {
  method: 'GET' | 'POST';
  operation: 'gmail_read' | 'gmail_write' | 'gmail_attachment';
  limit: number;
};

const idPattern = /^[A-Za-z0-9_-]{1,1024}$/;

const hasOnlyParams = (url: URL, allowed: string[]) =>
  [...url.searchParams.keys()].every((key) => allowed.includes(key));

export const classifyGmailProxyRequest = (
  path: string,
  method: string
): AllowedGmailRequest | null => {
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 3000) return null;

  let url: URL;
  try {
    url = new URL(path, 'https://gmail.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://gmail.invalid' || url.hash) return null;

  if (method === 'GET' && url.pathname === '/profile' && !url.search) {
    return { method: 'GET', operation: 'gmail_read', limit: 120 };
  }

  const threadMatch = url.pathname.match(/^\/threads\/([^/]+)$/);
  if (
    method === 'GET'
    && threadMatch
    && idPattern.test(threadMatch[1])
    && hasOnlyParams(url, ['format'])
    && url.searchParams.get('format') === 'full'
  ) {
    return { method: 'GET', operation: 'gmail_read', limit: 120 };
  }

  if (
    method === 'GET'
    && (url.pathname === '/messages' || url.pathname === '/threads')
    && hasOnlyParams(url, ['maxResults', 'q', 'pageToken'])
  ) {
    const maxResults = Number(url.searchParams.get('maxResults'));
    const query = url.searchParams.get('q') || '';
    const pageToken = url.searchParams.get('pageToken');
    if (
      Number.isInteger(maxResults)
      && maxResults >= 1
      && maxResults <= 100
      && query.length >= 1
      && query.length <= 1500
      && (!pageToken || idPattern.test(pageToken))
    ) {
      return { method: 'GET', operation: 'gmail_read', limit: 120 };
    }
  }

  const attachmentMatch = url.pathname.match(/^\/messages\/([^/]+)\/attachments\/([^/]+)$/);
  if (
    method === 'GET'
    && attachmentMatch
    && idPattern.test(attachmentMatch[1])
    && idPattern.test(attachmentMatch[2])
    && !url.search
  ) {
    return { method: 'GET', operation: 'gmail_attachment', limit: 30 };
  }

  const messageMatch = url.pathname.match(/^\/messages\/([^/]+)$/);
  if (
    method === 'GET'
    && messageMatch
    && idPattern.test(messageMatch[1])
    && hasOnlyParams(url, ['format', 'metadataHeaders'])
  ) {
    const format = url.searchParams.get('format');
    const metadataHeaders = url.searchParams.getAll('metadataHeaders');
    const validMetadata = format === 'metadata'
      && metadataHeaders.length > 0
      && metadataHeaders.every((header) => ['Subject', 'Date'].includes(header));
    if ((format === 'full' && metadataHeaders.length === 0) || validMetadata) {
      return { method: 'GET', operation: 'gmail_read', limit: 120 };
    }
  }

  if (method === 'POST' && !url.search && (url.pathname === '/drafts' || url.pathname === '/messages/send')) {
    return { method: 'POST', operation: 'gmail_write', limit: 30 };
  }

  return null;
};
