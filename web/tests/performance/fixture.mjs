import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

export function createFixture({ delay = 120, threadCount = 30, tailDelay = 480, attachmentBytes = Buffer.from('test') } = {}) {
  const requests = [];
  const studentProject = { id: 'TEST1', state: 'QUOTE', priorityNumber: 1, studentName: 'Fixture Student', studentNumber: '12345678', email: 'student@example.com', course: 'TEST 101', lecturer: 'Fixture Lecturer', createdAt: '2026-10-07T08:00:00Z', printLabel: 'Fixture', needsPayment: false, gmailThreadId: 'thread-0', gmailAccountEmail: 'printing@example.com', parts: [] };
  const projects = Array.from({ length: 80 }, (_, i) => ({ ...studentProject, id: i ? `TEST${i + 1}` : 'TEST1', priorityNumber: i + 1 }));
  const parts = projects.flatMap(p => Array.from({ length: 4 }, (_, i) => ({ id: `${p.id}-part-${i}`, projectId: p.id, partNumber: 4 - i, partName: `Part ${i}`, printStatus: 'VERIFIED', primaryMaterial: 'PLA', primaryMaterialCost: 5, primaryServiceCost: 10 })));
  const snapshots = projects.flatMap(p => [1, 2].map(v => ({ project_id: p.id, snapshot_version: v, status: 'ISSUED', total_cost: v * 100, currency: 'ZAR', generated_at: '2026-10-07T08:00:00Z', line_summary: [] })));
  const runs = parts.flatMap(p => [1, 2].map(v => ({ id: Number(p.partNumber) * 10 + v, project_id: p.projectId, part_id: p.id, started_by: 'Fixture', started_at: `2026-10-0${v}T08:00:00Z`, outcome: 'PRINTED' })));
  const attachments = Array.from({ length: 4 }, (_, i) => ({ messageId: 'message-0', attachmentId: `attachment-${i}`, partId: `${i + 1}`, filename: `fixture-${i}.stl`, mimeType: 'application/octet-stream', size: attachmentBytes.length, downloadStatus: 'pending' }));
  const messageRows = [{ project_id: 'TEST1', gmail_message_id: 'message-0', gmail_thread_id: 'thread-0', sender_name: 'Fixture Student', sender_email: 'student@example.com', recipient_emails: ['printing@example.com'], subject: 'Fixture print request', body_text: 'Please print the fixture.', message_date: '2026-10-07T08:00:00Z', direction: 'incoming', has_attachments: true, message_id_header: '<fixture@example.com>' }];
  const attachmentRows = attachments.map(a => ({ project_id: 'TEST1', gmail_message_id: a.messageId, gmail_attachment_id: a.attachmentId, mime_part_id: a.partId, filename: a.filename, mime_type: a.mimeType, size_bytes: a.size, download_status: 'pending' }));
  const failures = new Map();
  const hiddenThreads = [];
  const mailbox = {
    historyId: '1',
    threadIds: Array.from({ length: threadCount }, (_, i) => `thread-${threadCount - 1 - i}`),
    changes: [],
    historyPages: null,
    threadPages: null,
    threadResponses: new Map(),
    unreadThreadIds: new Set(),
    spamThreadIds: new Set(),
    trashThreadIds: new Set()
  };
  let activeGmail = 0;
  const gmailQueue = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method || 'GET';
    const path = url.pathname;
    const table = path.split('/').at(-1);
    const gmailPath = url.searchParams.get('path');
    const name = gmailPath || table;
    const record = { name, method, url: url.toString(), body: init.body ? JSON.parse(init.body) : null, start: performance.now(), end: 0, bytes: 0 };
    requests.push(record);
    const isThread = gmailPath?.startsWith('/threads/');
    if (isThread) {
      if (activeGmail >= 6) await new Promise(resolve => gmailQueue.push(resolve));
      activeGmail += 1;
    }
    const latency = isThread ? delay * 2 + (gmailPath.includes(`thread-${threadCount - 1}?`) ? tailDelay : 0) : delay;
    await wait(latency);
    if (isThread) { activeGmail -= 1; gmailQueue.shift()?.(); }
    let payload = [];
    let status = 200;
    if (failures.has(name)) {
      const failure = failures.get(name);
      status = failure?.status || 500;
      payload = { message: failure?.message || failure };
    }
    else if (gmailPath === '/profile') payload = { emailAddress: 'printing@example.com', historyId: mailbox.historyId };
    else if (gmailPath?.startsWith('/history?')) {
      const params = new URL(gmailPath, 'https://fixture.invalid').searchParams;
      payload = mailbox.historyPages
        ? mailbox.historyPages[Number(params.get('pageToken') || 0)]
        : { historyId: mailbox.historyId, history: mailbox.changes.filter(change => Number(change.id) > Number(params.get('startHistoryId'))) };
    }
    else if (gmailPath?.startsWith('/messages?')) payload = { messages: mailbox.threadIds.map(id => ({ id: id.replace('thread', 'message'), threadId: id })) };
    else if (gmailPath?.startsWith('/threads?')) {
      const params = new URL(gmailPath, 'https://fixture.invalid').searchParams;
      const matchingIds = mailbox.threadIds.filter(id =>
        (params.get('includeSpamTrash') === 'true' || (!mailbox.spamThreadIds.has(id) && !mailbox.trashThreadIds.has(id)))
        && (!(params.get('q') || '').includes('-in:trash') || !mailbox.trashThreadIds.has(id)));
      payload = mailbox.threadPages
        ? mailbox.threadPages[Number(params.get('pageToken') || 0)]
        : (() => {
          const offset = Number(params.get('pageToken') || 0);
          const end = offset + Number(params.get('maxResults'));
          return { threads: matchingIds.slice(offset, end).map(id => ({ id })),
            ...(end < matchingIds.length ? { nextPageToken: String(end) } : {}) };
        })();
    }
    else if (isThread) {
      const id = gmailPath.split('/')[2].split('?')[0];
      payload = { id, messages: [{ id: id.replace('thread', 'message'), threadId: id, internalDate: String(1791356400000 + Number(id.split('-')[1]) * 1000), payload: { headers: [{ name: 'From', value: 'Fixture Student <student@example.com>' }, { name: 'To', value: 'printing@example.com' }, { name: 'Subject', value: 'Fixture print request' }, { name: 'Message-ID', value: '<fixture@example.com>' }], parts: [{ partId: '0', mimeType: 'text/plain', body: { data: Buffer.from('Please print the fixture.').toString('base64url') } }, ...attachments.map(a => ({ partId: a.partId, filename: a.filename, mimeType: a.mimeType, body: { attachmentId: a.attachmentId, size: a.size } }))] } }] };
      if (mailbox.threadResponses.has(id)) payload = mailbox.threadResponses.get(id);
      else payload.messages[0].labelIds = [
        ...(mailbox.unreadThreadIds.has(id) ? ['UNREAD'] : []),
        ...(mailbox.spamThreadIds.has(id) ? ['SPAM'] : []),
        ...(mailbox.trashThreadIds.has(id) ? ['TRASH'] : [])
      ];
    } else if (gmailPath?.includes('/attachments/')) payload = { data: attachmentBytes.toString('base64url'), size: attachmentBytes.length };
    else if (gmailPath?.startsWith('/messages/message-')) {
      const id = gmailPath.split('/')[2].split('?')[0];
      payload = { id, threadId: id.replace('message', 'thread'), internalDate: String(1791356400000 + Number(id.split('-')[1]) * 1000), payload: { headers: [{ name: 'Subject', value: `Fixture print ${id}` }, { name: 'Date', value: '2026-10-07T08:00:00Z' }] } };
    }
    else if (table === 'read_active_project_cache') {
      payload = projects.filter(p => !['CLOSED','CANCELLED','READY_FOR_COLLECTION','PARTIALLY_COLLECTED'].includes(p.state)).map(p => {
        const data = { project: p, parts: parts.filter(part => part.projectId === p.id), snapshots: snapshots.filter(q => q.project_id === p.id), print_runs: runs.filter(r => r.project_id === p.id).sort((a,b) => b.started_at.localeCompare(a.started_at)) };
        const version = createHash('md5').update(JSON.stringify(data)).digest('hex');
        return { project_id: p.id, version, project_data: record.body?.known_versions?.[p.id] === version ? null : data };
      });
    }
    else if (table === 'transition_project_state') payload = { ok: true, errors: [], warnings: [] };
    else if (table === 'gmail_hidden_threads' && method === 'POST') {
      const row = record.body;
      const linked = projects.some(project => project.gmailThreadId === row.gmail_thread_id
        && project.gmailAccountEmail?.trim().toLowerCase() === row.gmail_account_email);
      if (linked) { status = 400; payload = { message: 'Linked emails cannot be hidden.' }; }
      else {
        const existing = hiddenThreads.find(existing => existing.gmail_account_email === row.gmail_account_email && existing.gmail_thread_id === row.gmail_thread_id);
        const saved = { ...row, hidden_by_email: 'printing@example.com', hidden_at: new Date(Date.now()).toISOString() };
        if (existing) Object.assign(existing, saved); else hiddenThreads.push(saved);
        status = 204;
      }
    }
    else if (table === 'gmail_hidden_threads' && method === 'DELETE') {
      const account = url.searchParams.get('gmail_account_email')?.slice(3);
      const threadId = url.searchParams.get('gmail_thread_id')?.slice(3);
      for (let i = hiddenThreads.length - 1; i >= 0; i -= 1)
        if (hiddenThreads[i].gmail_account_email === account && hiddenThreads[i].gmail_thread_id === threadId
          && (!url.searchParams.has('hidden_at') || (hiddenThreads[i].hidden_at && hiddenThreads[i].hidden_at < url.searchParams.get('hidden_at').slice(3)))) hiddenThreads.splice(i, 1);
      status = 204;
    }
    else if (table === 'projects' && method === 'PATCH') {
      const project = projects.find(row => row.id === url.searchParams.get('id')?.slice(3));
      if (project) {
        Object.assign(project, record.body);
        for (let i = hiddenThreads.length - 1; i >= 0; i -= 1)
          if (hiddenThreads[i].gmail_thread_id === project.gmailThreadId && hiddenThreads[i].gmail_account_email === project.gmailAccountEmail?.toLowerCase()) hiddenThreads.splice(i, 1);
      }
      status = 204;
    }
    else if (method !== 'GET') { payload = null; status = 204; }
    else {
      payload = ({ projects, parts, gmail_hidden_threads: hiddenThreads, project_cost_snapshots: snapshots, print_runs: runs, project_gmail_messages: messageRows, project_gmail_attachments: attachmentRows, audit_events: [{ id: 1, project_id: 'TEST1', action_type: 'REOPEN_REVIEW' }] })[table] ?? [];
      for (const [column, filter] of url.searchParams) {
        if (filter.startsWith('gte.')) payload = payload.filter(row => String(row[column] ?? new Date().toISOString()) >= filter.slice(4));
        if (filter === 'not.is.null') payload = payload.filter(row => row[column] != null);
        if (filter.startsWith('eq.')) payload = payload.filter(row => String(row[column]) === filter.slice(3));
        if (filter.startsWith('in.')) {
          const included = filter.slice(3).replace(/[()]/g, '').split(',');
          payload = payload.filter(row => included.includes(String(row[column])));
        }
        if (filter.startsWith('not.in.')) {
          const excluded = filter.slice(7).replace(/[()]/g, '').split(',');
          payload = payload.filter(row => !excluded.includes(String(row[column])));
        }
      }
      const select = url.searchParams.get('select');
      if (select && select !== '*') {
        const withParts = select.includes('parts!parts_projectId_fkey(printStatus)');
        const columns = select.replace(/parts!parts_projectId_fkey\(printStatus\)/, '').split(',').filter(Boolean);
        payload = payload.map(row => ({
          ...Object.fromEntries(columns.map(column => { const [alias, source = alias] = column.split(':'); return [alias, row[source]]; })),
          ...(withParts ? { parts: parts.filter(part => part.projectId === row.id).map(part => ({ printStatus: part.printStatus })) } : {})
        }));
      }
      if (url.searchParams.has('order')) {
        const [column, direction] = url.searchParams.get('order').split('.');
        payload = [...payload].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (direction === 'desc' ? -1 : 1));
      }
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || payload.length);
      payload = payload.slice(offset, offset + limit);
    }
    const body = status === 204 ? null : JSON.stringify(payload);
    record.end = performance.now(); record.bytes = body?.length || 0;
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  };
  const helper = {
    resolveProject: async () => { await wait(delay); return { status: 'matched', projectKey: 'fixture', folderName: 'Fixture', sync: { isInSync: true } }; },
    createProjectFolder: async () => { throw new Error('Fixture folder already exists'); },
    saveProjectAttachment: async (_key, filename) => { await wait(delay); return { status: 'saved', filename }; }
  };
  return { fetch, helper, requests, failures, hiddenThreads, mailbox, studentProject, attachments, projects, parts, snapshots, runs, wait };
}
