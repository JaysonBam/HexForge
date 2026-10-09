import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { bundleApi } from './bundle.mjs';
import { createFixture } from './fixture.mjs';

let fixture;
let owner = { id: 'owner-a', email: 'printing@example.com' };
globalThis.fetch = (...args) => fixture.fetch(...args);
globalThis.window = { dispatchEvent() {}, setTimeout };
const api = await import(pathToFileURL(await bundleApi('regression')).href);
api.supabase.auth.getSession = async () => ({ data: { session: { access_token: 'fixture-only', user: owner } }, error: null });
function reset() { fixture = createFixture({ delay: 5, threadCount: 12, tailDelay: 20 }); owner = { id: `owner-${Math.random()}`, email: 'printing@example.com' }; }

await test('shared project metadata keeps current links, including completed projects', async () => {
  reset();
  fixture.projects.forEach(project => { project.gmailThreadId = null; project.gmailAccountEmail = null; });
  Object.assign(fixture.projects[0], { state: 'CLOSED', gmailThreadId: 'thread-11', gmailAccountEmail: 'Printing@Example.com' });
  Object.assign(fixture.projects[1], { state: 'CANCELLED', gmailThreadId: 'thread-10', gmailAccountEmail: 'printing@example.com' });
  Object.assign(fixture.projects[2], { gmailThreadId: 'thread-9', gmailAccountEmail: 'manager@example.com' });
  const [items, links] = await Promise.all([api.listRecent3dPrintThreads(), api.getGmailInboxProjects()]);
  assert.deepEqual(api.visibleGmailThreads(items, api.buildLinkedGmailThreadKeys(links)).map(row => row.threadId),
    Array.from({ length: 10 }, (_, index) => `thread-${9 - index}`));
  const read = fixture.requests.find(request => request.name === 'projects');
  const query = new URL(read.url).searchParams;
  assert.equal(query.get('select'), 'id,priorityNumber,studentName,studentNumber,email,createdAt,gmailThreadId,gmailAccountEmail');
  assert.equal(links.find(link=>link.id==='TEST1').priorityNumber,1);
  assert.match(query.get('or'), /gmailThreadId.not.is.null/);
  assert.equal(query.has('state'), false);
  assert.equal(fixture.requests.filter(request => request.name === 'projects').length, 1);
  assert.ok(!fixture.requests.some(request => request.name === 'project_gmail_messages'));
});

await test('link checks observe fresh local/remote links, unlinking and deletion without evicting Gmail bodies', async () => {
  reset();
  const items = await api.listRecent3dPrintThreads();
  let links = await api.getGmailInboxProjects();
  assert.equal(api.visibleGmailThreads(items, api.buildLinkedGmailThreadKeys(links)).length, 11);
  fixture.projects.forEach(project => { project.gmailThreadId = null; });
  Object.assign(fixture.projects[0], { gmailThreadId: 'thread-11', gmailAccountEmail: 'printing@example.com' });
  links = await api.getGmailInboxProjects();
  assert.equal(api.visibleGmailThreads(items, api.buildLinkedGmailThreadKeys(links))[0].threadId, 'thread-10');
  fixture.projects.shift();
  links = await api.getGmailInboxProjects();
  assert.equal(api.visibleGmailThreads(items, api.buildLinkedGmailThreadKeys(links)).length, 12);
  const from = fixture.requests.length;
  assert.deepEqual(await api.listRecent3dPrintThreads(), items);
  assert.equal(fixture.requests.length - from, 2);
  assert.ok(fixture.requests.slice(from).every(request => !request.name.startsWith('/threads/')));
  const after = fixture.requests.length;
  const keys = api.buildLinkedGmailThreadKeys(links);
  for (let i = 0; i < 10; i += 1) {
    api.visibleGmailThreads(items, keys);
    assert.equal(api.visibleGmailThreads(items, keys, false), items);
  }
  assert.equal(fixture.requests.length, after);
});

await test('linked-thread check includes project links beyond the Supabase page limit', async () => {
  reset();
  fixture.projects.length = 0;
  fixture.projects.push(...Array.from({ length: 1005 }, (_, index) => ({
    id: `PROJECT-${String(index).padStart(4, '0')}`, gmailThreadId: `thread-${index}`, gmailAccountEmail: 'printing@example.com'
  })));
  const links = await api.getGmailInboxProjects();
  assert.equal(links.length, 1005);
  assert.equal(api.buildLinkedGmailThreadKeys(links).size, 1005);
  assert.equal(fixture.requests.length, 2);
});

await test('failed project-link checks reject rather than silently classifying everything as unlinked', async () => {
  reset();
  fixture.failures.set('projects', 'links unavailable');
  await assert.rejects(api.getGmailInboxProjects(), /links unavailable/);
  fixture.failures.clear();
  assert.equal((await api.getGmailInboxProjects()).length, 80);
});

await test('hidden-list writes persist without refetching emails, are reversible, and refuse linked threads', async () => {
  reset();
  const items = await api.listRecent3dPrintThreads();
  const linked = api.buildLinkedGmailThreadKeys(await api.getGmailInboxProjects());
  const gmailCalls = () => fixture.requests.filter(request => request.name.startsWith('/')).length;
  const from = gmailCalls();
  await api.setGmailThreadHidden('Printing@Example.com', 'thread-11', true);
  await api.setGmailThreadHidden('printing@example.com', 'thread-11', true);
  let hidden = api.buildLinkedGmailThreadKeys(await api.getHiddenGmailThreads());
  assert.equal(hidden.size, 1);
  assert.equal(api.visibleGmailThreads(items, linked, true, hidden, true)[0].threadId, 'thread-10');
  assert.equal(fixture.hiddenThreads[0].hidden_by_email, 'printing@example.com');
  assert.deepEqual(Object.keys(fixture.requests.find(request => request.method === 'POST' && request.name === 'gmail_hidden_threads').body).sort(), ['gmail_account_email', 'gmail_thread_id']);
  await assert.rejects(api.setGmailThreadHidden('printing@example.com', 'thread-0', true), /Linked emails cannot be hidden/);
  assert.equal(fixture.hiddenThreads.length, 1);
  await api.setGmailThreadHidden('printing@example.com', 'thread-11', false);
  hidden = api.buildLinkedGmailThreadKeys(await api.getHiddenGmailThreads());
  assert.equal(hidden.size, 0);
  assert.equal(gmailCalls(), from);
});

await test('hidden-list refresh sees remote changes and project linking clears the hidden entry', async () => {
  reset();
  const items = await api.listRecent3dPrintThreads();
  fixture.hiddenThreads.push({ gmail_account_email: 'printing@example.com', gmail_thread_id: 'thread-11' });
  const first = await api.getHiddenGmailThreads();
  assert.equal(first.length, 1);
  const query = new URL(fixture.requests.at(-1).url).searchParams;
  assert.equal(query.get('select'), 'gmailThreadId:gmail_thread_id,gmailAccountEmail:gmail_account_email');
  await api.projectReads.updateProjectRecord('TEST1', { gmailThreadId: 'thread-11', gmailAccountEmail: 'printing@example.com' });
  const hidden = api.buildLinkedGmailThreadKeys(await api.getHiddenGmailThreads());
  const linked = api.buildLinkedGmailThreadKeys(await api.getGmailInboxProjects());
  assert.equal(hidden.size, 0);
  assert.equal(api.visibleGmailThreads(items, linked, false, hidden, true)[0].threadId, 'thread-11');
});

await test('hidden-list reads paginate and failed reads or writes leave email data intact', async () => {
  reset();
  fixture.hiddenThreads.push(...Array.from({ length: 1005 }, (_, index) => ({
    gmail_account_email: 'printing@example.com', gmail_thread_id: `hidden-${index}`
  })));
  assert.equal((await api.getHiddenGmailThreads()).length, 1005);
  assert.equal(fixture.requests.length, 2);
  fixture.failures.set('gmail_hidden_threads', 'hide list unavailable');
  await assert.rejects(api.getHiddenGmailThreads(), /hide list unavailable/);
  await assert.rejects(api.setGmailThreadHidden('printing@example.com', 'thread-11', true), /hide list unavailable/);
  assert.equal(fixture.hiddenThreads.length, 1005);
});

await test('attachment decoding preserves every binary byte and unpadded base64url', async () => {
  reset();
  const bytes = Buffer.from(Array.from({ length: 513 }, (_, index) => index % 256));
  fixture = createFixture({ delay: 0, attachmentBytes: bytes });
  const decoded = await api.downloadGmailAttachment(fixture.attachments[0]);
  assert.deepEqual(Buffer.from(decoded), bytes);
});

await test('workspace reads overlap and preserve every part, quote version and print attempt', async () => {
  reset();
  const loaded = await api.getProjects();
  const reads = fixture.requests.slice(0, 4);
  assert.equal(reads.length, 4);
  assert.ok(Math.max(...reads.map(r => r.start)) < Math.min(...reads.map(r => r.end)));
  assert.equal(loaded.projects.length, 80);
  assert.equal(loaded.projects[0].parts.length, 4);
  assert.deepEqual(loaded.projects[0].parts.map(p => p.partNumber), [1,2,3,4]);
  assert.deepEqual(loaded.projects[0].quoteSnapshots.map(q => q.snapshot_version), [1,2]);
  assert.equal(loaded.projects[0].quoteSnapshot.snapshot_version, 2);
  assert.equal(loaded.projects[0].parts[0].printRuns.length, 2);
  assert.ok(loaded.projects[0].parts[0].printRuns[0].started_at > loaded.projects[0].parts[0].printRuns[1].started_at);
});

await test('authoritative reload is restricted to the changed project and all its related rows', async () => {
  reset();
  const scoped = await api.projectReads.getProjectById('TEST1');
  assert.deepEqual(scoped.projects.map(p => p.id), ['TEST1']);
  assert.equal(scoped.projects[0].parts.length, 4);
  assert.equal(scoped.projects[0].quoteSnapshots.length, 2);
  assert.ok(scoped.projects[0].parts.every(p => p.printRuns.every(r => r.project_id === 'TEST1')));
});

await test('dashboard summary preserves lanes, order and every status count without financial or history data', async () => {
  reset();
  fixture.projects[0].state = 'CLOSED';
  fixture.projects[1].state = 'READY_FOR_COLLECTION';
  fixture.projects[2].state = 'IN_PRODUCTION';
  fixture.parts.find(part => part.projectId === fixture.projects[2].id).printStatus = 'PRINTING';
  const full = await api.getProjects();
  const from = fixture.requests.length;
  const summary = await api.projectReads.getProjectSummaries();
  assert.equal(fixture.requests.length - from, 1);
  assert.equal(summary.length, 78);
  assert.ok(summary.every(project => !('quoteSnapshots' in project) && project.parts.every(part => Object.keys(part).length === 1)));
  for (const project of summary) assert.deepEqual(api.getPartCounts(project), api.getPartCounts(full.projects.find(p => p.id === project.id)));
  const laneIds = projects => Object.fromEntries(Object.entries(api.buildDashboardLanes(projects)).map(([key, rows]) => [key, rows.map(project => project.id)]));
  assert.deepEqual(laneIds(summary), laneIds(full.projects));
  const contacts = await api.projectReads.getProjectSummaries(false);
  assert.equal(contacts.length, 80);
  assert.equal(contacts[0].email, fixture.projects[0].email);
  assert.ok(contacts.every(project => project.parts.length === 0));
  fixture.failures.set('projects', 'summary unavailable');
  await assert.rejects(api.projectReads.getProjectSummaries(), /summary unavailable/);
});

await test('required read errors reject, optional-history errors stay visible without hiding core data', async () => {
  reset(); fixture.failures.set('project_cost_snapshots', 'snapshot unavailable');
  const loaded = await api.getProjects();
  assert.equal(loaded.projects.length, 80); assert.equal(loaded.quoteSnapshotError, 'snapshot unavailable');
  fixture.failures.set('parts', 'parts unavailable');
  await assert.rejects(api.getProjects(), /parts unavailable/);
});

await test('picker publishes complete usable snapshots early and returns the unchanged sorted full results', async () => {
  reset();
  const progress = [];
  const items = await api.listRecent3dPrintThreads({ forceRefresh: true, onProgress: rows => progress.push(rows) });
  assert.equal(progress[0][0].threadId, 'thread-11'); assert.equal(items.length, 12);
  assert.equal(progress[0][0].snapshot.messages.length, 1);
  assert.equal(progress[0][0].snapshot.messages[0].attachments.length, 4);
  assert.deepEqual(items.map(i => i.threadId), Array.from({length:12}, (_,i) => `thread-${11-i}`));
});

await test('the shared list stops at fifty current-year threads without reading the rest of the year', async () => {
  reset();
  fixture.mailbox.threadIds = Array.from({ length: 70 }, (_, i) => `thread-${69 - i}`);
  const items = await api.listRecent3dPrintThreads();
  assert.equal(items.length, 50);
  assert.equal(new Set(items.map(item => item.threadId)).size, 50);
  assert.equal(items[0].threadId, 'thread-69');
  assert.equal(items.at(-1).threadId, 'thread-20');
  const listing = fixture.requests.filter(request => request.name.startsWith('/threads?'));
  assert.equal(listing.length, 1);
  assert.equal(api.classifyGmailProxyRequest(listing[0].name, 'GET')?.operation, 'gmail_read');
  const params = new URL(listing[0].name, 'https://fixture.invalid').searchParams;
  assert.equal(params.get('maxResults'), '50');
  assert.equal(params.get('includeSpamTrash'), 'true');
  assert.equal(params.get('q'), api.buildCurrentYearPrintEmailQuery('3d').replace(/\s+3d$/, '') + ' {3d "3d print" "3d printing" print printing printer stl 3mf slicer filament}');
  assert.ok(!fixture.requests.some(request => request.name.startsWith('/messages?')));
});

await test('the shared list includes Spam but excludes Trash using the same read and cache path', async () => {
  reset(); api.resetGmailInbox();
  fixture.mailbox.spamThreadIds.add('thread-11');
  fixture.mailbox.trashThreadIds.add('thread-10');
  fixture.mailbox.spamThreadIds.add('thread-0'); fixture.mailbox.unreadThreadIds.add('thread-0');
  await api.refreshGmailInbox();
  let state=api.getGmailInboxState();
  assert.equal(state.items[0].threadId,'thread-11');
  assert.equal(state.items.length,11); assert.ok(!state.threadIds.includes('thread-10'));
  assert.equal(state.items.find(item=>item.threadId==='thread-11').snapshot.hasSpam,true);
  assert.equal(state.items.find(item=>item.threadId==='thread-9').snapshot.hasSpam,false);
  assert.equal(api.gmailInboxActionCount(state),11); // Linked unread mail in Spam counts too.
  const listing=fixture.requests.find(r=>r.name.startsWith('/threads?'));
  assert.equal(api.classifyGmailProxyRequest(listing.name,'GET')?.operation,'gmail_read');
  const from=fixture.requests.length; await api.refreshGmailInbox();
  state=api.getGmailInboxState(); assert.equal(state.items.length,11);
  assert.equal(fixture.requests.length-from,4); // No separate Spam poll or cache.
  assert.ok(!fixture.requests.slice(from).some(r=>r.name.startsWith('/threads/')));
});

await test('moving cached mail to Spam keeps it visible, while Trash removes it on the next shared check', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  fixture.mailbox.spamThreadIds.add('thread-11'); fixture.mailbox.trashThreadIds.add('thread-10');
  fixture.mailbox.historyId='2'; fixture.mailbox.changes=[{id:'2',labelsAdded:[
    {message:{threadId:'thread-11'},labelIds:['SPAM']}, {message:{threadId:'thread-10'},labelIds:['TRASH']}
  ]}];
  const from=fixture.requests.length; await api.refreshGmailInbox();
  const state=api.getGmailInboxState();
  assert.ok(state.threadIds.includes('thread-11')); assert.ok(!state.threadIds.includes('thread-10'));
  assert.equal(api.gmailInboxActionCount(state),10);
  assert.deepEqual(fixture.requests.slice(from).filter(r=>r.name.startsWith('/threads/')).map(r=>r.name),['/threads/thread-11?format=full']);
  assert.equal(state.items.find(item=>item.threadId==='thread-11').snapshot.hasSpam,true);
  fixture.mailbox.spamThreadIds.delete('thread-11'); fixture.mailbox.historyId='3';
  fixture.mailbox.changes.push({id:'3',labelsRemoved:[{message:{threadId:'thread-11'},labelIds:['SPAM']}]});
  const beforeRemoval=fixture.requests.length; await api.refreshGmailInbox();
  assert.equal(api.getGmailInboxState().items.find(item=>item.threadId==='thread-11').snapshot.hasSpam,false);
  assert.equal(fixture.requests.slice(beforeRemoval).filter(r=>r.name.startsWith('/threads/')).length,1);
});

await test('thread listing follows short pages and stops as soon as fifty distinct threads are found', async () => {
  reset();
  fixture.mailbox.threadPages = [
    { threads: Array.from({ length: 23 }, (_, i) => ({ id: `thread-${59 - i}` })), nextPageToken: '1' },
    { threads: [{ id: 'thread-37' }, ...Array.from({ length: 37 }, (_, i) => ({ id: `thread-${36 - i}` }))], nextPageToken: '2' }
  ];
  const items = await api.listRecent3dPrintThreads();
  assert.equal(items.length, 50);
  assert.equal(items[0].threadId, 'thread-59');
  assert.equal(items.at(-1).threadId, 'thread-10');
  const listing = fixture.requests.filter(request => request.name.startsWith('/threads?'));
  assert.equal(listing.length, 2);
  assert.ok(listing.every(request => api.classifyGmailProxyRequest(request.name, 'GET')?.operation === 'gmail_read'));
  const params = new URL(listing[1].name, 'https://fixture.invalid').searchParams;
  assert.equal(params.get('pageToken'), '1');
  assert.equal(params.get('maxResults'), '27');
});

await test('thread listing stops at the actual available count and propagates later-page failures', async () => {
  reset();
  fixture.mailbox.threadPages = [
    { threads: [{ id: 'thread-2' }], nextPageToken: '1' },
    { threads: [{ id: 'thread-1' }, { id: 'thread-0' }] }
  ];
  assert.equal((await api.listRecent3dPrintThreads()).length, 3);
  const nextPage = fixture.requests.find(request => request.name.startsWith('/threads?') && request.name.includes('pageToken=1')).name;
  fixture.failures.set(nextPage, 'list page unavailable');
  const progress = [];
  await assert.rejects(api.listRecent3dPrintThreads({ onProgress: rows => progress.push(rows) }), /list page unavailable/);
  assert.equal(progress.length, 0);
});

await test('picker verifies Gmail before showing reusable rows, including explicit Refresh and account changes', async () => {
  reset(); await api.listRecent3dPrintThreads({ forceRefresh: true });
  let count = fixture.requests.length;
  const progress = [];
  assert.equal((await api.listRecent3dPrintThreads({ onProgress: items => {
    progress.push(items);
    assert.ok(fixture.requests.slice(count).every(r => r.end > 0));
  } })).length, 12);
  assert.equal(progress.length, 1);
  assert.equal(fixture.requests.length, count + 2);
  assert.ok(fixture.requests.slice(count).every(r => !r.name.startsWith('/threads/')));
  count = fixture.requests.length;
  await api.listRecent3dPrintThreads({ forceRefresh: true });
  assert.equal(fixture.requests.length, count + 2);
  count = fixture.requests.length; owner = { ...owner, id: 'different-owner' };
  await api.listRecent3dPrintThreads(); assert.ok(fixture.requests.length > count);
});

await test('five new threads reuse five old snapshots without flashing the old list', async () => {
  reset(); fixture.mailbox.threadIds = Array.from({length:5},(_,i)=>`thread-${4-i}`);
  const old = await api.listRecent3dPrintThreads();
  fixture.mailbox.threadIds = Array.from({ length:10 }, (_, i) => `thread-${9-i}`);
  fixture.mailbox.historyId = '2';
  fixture.mailbox.changes = [{ id:'2', messagesAdded: Array.from({length:5},(_,i)=>({ message:{threadId:`thread-${i+5}`} })) }];
  const from = fixture.requests.length;
  const progress = [];
  const all = await api.listRecent3dPrintThreads({ onProgress: rows => progress.push(rows) });
  assert.equal(all.length, 10); assert.equal(progress.length, 1); assert.equal(progress[0].length, 10);
  assert.equal(fixture.requests.length - from, 8);
  assert.equal(fixture.requests.slice(from).filter(r=>r.name.startsWith('/threads/')).length, 5);
  assert.equal(all.find(row=>row.threadId==='thread-0'), old.find(row=>row.threadId==='thread-0'));
});

await test('a new reply in an existing thread is fetched even when matching search IDs stay the same', async () => {
  reset(); await api.listRecent3dPrintThreads();
  fixture.mailbox.historyId = '2';
  fixture.mailbox.changes = [{id:'2', messagesAdded:[{message:{threadId:'thread-0'}}]}];
  fixture.mailbox.threadResponses.set('thread-0', { id:'thread-0', messages:[{ id:'reply-0', threadId:'thread-0', internalDate:'1791356401000', payload:{ headers:[{name:'Subject',value:'New reply'}], mimeType:'text/plain', body:{data:Buffer.from('New message body').toString('base64url')} } }] });
  const from = fixture.requests.length;
  const rows = await api.listRecent3dPrintThreads();
  assert.equal(fixture.requests.length-from, 4);
  assert.equal(rows.find(row=>row.threadId==='thread-0').snapshot.messages[0].id, 'reply-0');
});

await test('deleted threads disappear, label/deletion events refresh known content, and history pages are consumed', async () => {
  reset(); await api.listRecent3dPrintThreads();
  fixture.mailbox.threadIds = fixture.mailbox.threadIds.filter(id=>id!=='thread-1');
  fixture.mailbox.historyId = '3';
  fixture.mailbox.historyPages = [
    { historyId:'3', nextPageToken:'1', history:[{labelsRemoved:[{message:{threadId:'thread-0'}}]}] },
    { historyId:'3', history:[{messagesDeleted:[{message:{threadId:'thread-1'}}]}] }
  ];
  const from = fixture.requests.length;
  const rows = await api.listRecent3dPrintThreads();
  assert.equal(rows.length, 11); assert.ok(rows.every(row=>row.threadId!=='thread-1'));
  assert.equal(fixture.requests.length-from, 5);
  assert.equal(fixture.requests.slice(from).filter(r=>r.name.startsWith('/threads/')).length, 1);
});

await test('expired Gmail history forces a full current read; verification failures display no saved rows', async () => {
  reset(); await api.listRecent3dPrintThreads(); fixture.mailbox.historyId='2';
  fixture.failures.set('/history?startHistoryId=1&maxResults=500', {status:404,message:'Expired cursor'});
  let from=fixture.requests.length;
  assert.equal((await api.listRecent3dPrintThreads()).length, 12);
  assert.equal(fixture.requests.length-from, 15);
  fixture.failures.set('/profile', 'Cannot verify mailbox');
  const progress=[];
  await assert.rejects(api.listRecent3dPrintThreads({onProgress:rows=>progress.push(rows)}), /Cannot verify mailbox/);
  assert.equal(progress.length,0);
});

await test('active project validation preserves complete data and transfers only changed records', async () => {
  reset(); fixture.projects.slice(20).forEach(p=>p.state='CLOSED');
  const full = await api.getProjects();
  const saved = await api.projectReads.getActiveProjectCache();
  assert.equal(Object.keys(saved).length,20);
  for(const entry of Object.values(saved)) assert.deepEqual(entry.project,full.projects.find(p=>p.id===entry.project.id));
  let from=fixture.requests.length;
  const unchanged=await api.projectReads.getActiveProjectCache(saved);
  assert.equal(fixture.requests.length-from,1);
  assert.ok(fixture.requests.at(-1).bytes<2200);
  assert.equal(unchanged.TEST1.project,saved.TEST1.project);
  fixture.parts[0].specialInstruction='Changed by another workstation';
  fixture.projects[1].state='CLOSED';
  const changed=await api.projectReads.getActiveProjectCache(saved);
  assert.equal(Object.keys(changed).length,19);
  assert.notEqual(changed.TEST1.version,saved.TEST1.version);
  assert.equal(changed.TEST3.project,saved.TEST3.project);
  assert.ok(changed.TEST1.project.parts.some(p=>p.specialInstruction==='Changed by another workstation'));
});

await test('three-hour reconciliation refreshes thread content from the single persistent cache', async () => {
  reset(); await api.listRecent3dPrintThreads();
  const originalNow=Date.now; const future=originalNow()+3*60*60*1000+1;
  Date.now=()=>future;
  try {
    const progress=[];
    const from=fixture.requests.length; await api.listRecent3dPrintThreads({onProgress:rows=>progress.push(rows)});
    assert.equal(fixture.requests.length-from,14);
    assert.equal(progress[0][0].threadId,'thread-11');
  } finally { Date.now=originalNow; }
});

await test('concurrent picker opens share verification; an abandoned caller cannot publish results', async () => {
  reset(); const controller=new AbortController(); const progress=[];
  const abandoned=api.listRecent3dPrintThreads({signal:controller.signal,onProgress:rows=>progress.push(rows)});
  const observed=api.listRecent3dPrintThreads(); controller.abort();
  await assert.rejects(abandoned,/abort/i);
  assert.equal((await observed).length,12); assert.equal(progress.length,0);
  assert.equal(fixture.requests.length,14);
});

await test('failed changed-thread fetch publishes no old rows; UTF-8 email bodies are preserved', async () => {
  reset(); await api.listRecent3dPrintThreads();
  fixture.mailbox.historyId='2'; fixture.mailbox.changes=[{id:'2',messagesAdded:[{message:{threadId:'thread-11'}}]}];
  fixture.failures.set('/threads/thread-11?format=full','Unavailable new reply');
  const progress=[];
  await assert.rejects(api.listRecent3dPrintThreads({onProgress:rows=>progress.push(rows)}),/Unavailable new reply/);
  assert.equal(progress.length,0);
  fixture.failures.clear();
  const text='André — PLA filament 🖨️\nPrint these parts: café, 日本語.';
  fixture.mailbox.threadResponses.set('thread-11',{id:'thread-11',messages:[{id:'message-11',threadId:'thread-11',internalDate:'1791356499000',payload:{mimeType:'text/plain',body:{data:Buffer.from(text).toString('base64url')}}}]});
  const rows=await api.listRecent3dPrintThreads();
  assert.equal(rows[0].snapshot.messages[0].body,text);
});

await test('live correspondence displays before cache writes finish, while writes preserve the foreign key order', async () => {
  reset(); let progressRequests;
  const thread = await api.syncProjectGmailThread(fixture.studentProject, { onThread: () => { progressRequests = fixture.requests.length; } });
  assert.equal(thread.id, 'thread-0'); assert.equal(progressRequests, 1);
  const writes = fixture.requests.filter(r => r.method !== 'GET');
  assert.deepEqual(writes.map(r => r.name), ['projects','project_gmail_messages','project_gmail_attachments']);
  assert.ok(writes[0].end <= writes[1].start && writes[1].end <= writes[2].start);
});

await test('correspondence cache is account scoped and attachment updates invalidate it', async () => {
  reset(); await api.loadProjectGmailMessages('TEST1');
  const count = fixture.requests.length;
  await api.loadProjectGmailMessages('TEST1'); assert.equal(fixture.requests.length, count);
  await api.updateAttachmentDownloadStatus({ projectId:'TEST1', attachment: fixture.attachments[0], status:'downloaded' });
  const afterWrite = fixture.requests.length;
  await api.loadProjectGmailMessages('TEST1'); assert.equal(fixture.requests.length, afterWrite + 2);
  owner = { ...owner, id:'another-account' };
  await api.loadProjectGmailMessages('TEST1'); assert.equal(fixture.requests.length, afterWrite + 4);
});

await test('selected attachment preparation skips unrelated correspondence reads and retains ownership enforcement', async () => {
  reset(); const selected = await api.prepareGmailAttachmentDownload(fixture.studentProject, fixture.helper, undefined, [fixture.attachments[0]]);
  assert.equal(selected.attachments.length, 1); assert.equal(fixture.requests.length, 0);
  owner.email = 'different@example.com';
  await assert.rejects(api.prepareGmailAttachmentDownload(fixture.studentProject, fixture.helper), /not linked to your Gmail account/);
  assert.equal(fixture.requests.length, 0);
});

await test('download fetches overlap, local writes retain order and every final status is awaited', async () => {
  reset(); const saves = [];
  const helper = { ...fixture.helper, saveProjectAttachment: async (_key, name) => { saves.push(name); await fixture.wait(5); return { status:'saved', filename:name }; } };
  const result = await api.downloadPreparedGmailAttachments(fixture.studentProject, helper, { resolution:{status:'matched', projectKey:'fixture'}, attachments:fixture.attachments });
  assert.equal(result.saved, 4); assert.equal(result.failed, 0);
  assert.deepEqual(saves, fixture.attachments.map(a => a.filename));
  const downloads = fixture.requests.filter(r => r.name.includes('/attachments/'));
  assert.ok(downloads[1].start < downloads[0].end);
  assert.ok(downloads.every(r => downloads.filter(other => other.start <= r.start && other.end > r.start).length <= 3));
  const statuses = fixture.requests.filter(r => r.method === 'PATCH');
  assert.equal(statuses.length, 4); assert.ok(statuses.every(r => r.end > 0 && r.body.download_status === 'downloaded'));
});

await test('one failed download does not prevent other files saving or their statuses persisting', async () => {
  reset(); fixture.failures.set('/messages/message-0/attachments/attachment-1', 'file unavailable');
  const result = await api.downloadPreparedGmailAttachments(fixture.studentProject, fixture.helper, { resolution:{status:'matched', projectKey:'fixture'}, attachments:fixture.attachments });
  assert.equal(result.saved, 3); assert.equal(result.failed, 1); assert.equal(result.warnings.length, 1);
  assert.equal(fixture.requests.filter(r => r.body?.download_status === 'failed').length, 1);
});

await test('invalid attachment ownership makes no provider or helper request', async () => {
  reset(); owner.email = 'wrong@example.com';
  await assert.rejects(api.downloadPreparedGmailAttachments(fixture.studentProject, fixture.helper, { resolution:{status:'matched', projectKey:'fixture'}, attachments:fixture.attachments }), /not linked to your Gmail account/);
  assert.equal(fixture.requests.length, 0);
});

await test('dashboard and import share one check and wait for verified linked unread status', async () => {
  reset(); api.resetGmailInbox();
  fixture.hiddenThreads.push({gmail_account_email:'printing@example.com',gmail_thread_id:'thread-10'});
  const states=[]; const unsubscribe=api.subscribeGmailInbox(()=>states.push(api.getGmailInboxState()));
  await Promise.all([api.refreshGmailInbox(),api.refreshGmailInbox()]); unsubscribe();
  const state=api.getGmailInboxState();
  assert.equal(state.complete,true); assert.equal(state.items.length,12);
  assert.equal(api.gmailInboxActionCount(state),10);
  const counted=states.find(state=>state.verified);
  assert.equal(counted.items.length,0); assert.equal(api.gmailInboxActionCount(counted),null);
  assert.equal(fixture.requests.length,16);
  assert.equal(fixture.requests.filter(r=>r.name.startsWith('/threads?')).length,1);
  assert.ok(!fixture.requests.some(r=>r.name.startsWith('/messages?')));
});

await test('unlinked action counts wait for verified senders so sent-only threads cannot inflate the badge', async () => {
  reset(); api.resetGmailInbox(); fixture.projects.forEach(project => {project.gmailThreadId=null;});
  fixture.hiddenThreads.push({gmail_account_email:'printing@example.com',gmail_thread_id:'thread-10'});
  const states=[]; const unsubscribe=api.subscribeGmailInbox(()=>states.push(api.getGmailInboxState()));
  await api.refreshGmailInbox(); unsubscribe();
  const counted=states.find(state=>state.verified);
  assert.equal(counted.items.length,0); assert.equal(api.gmailInboxActionCount(counted),null);
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),11);
});

await test('sent-only threads are cached but excluded from action counts; a new external reply refreshes only that thread', async () => {
  reset(); api.resetGmailInbox();
  const sent = {id:'sent',threadId:'thread-11',internalDate:'1791356400000',labelIds:['SENT','UNREAD'],
    payload:{headers:[{name:'From',value:'Printing <PRINTING@example.com>'},{name:'To',value:'student@example.com'}]}};
  fixture.mailbox.threadResponses.set('thread-11',{id:'thread-11',messages:[sent]});
  await api.refreshGmailInbox();
  assert.equal(api.getGmailInboxState().items.length,12);
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),10);
  let from=fixture.requests.length;
  await api.refreshGmailInbox();
  assert.equal(fixture.requests.length-from,4);
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),10);
  fixture.mailbox.threadResponses.set('thread-11',{id:'thread-11',messages:[sent,
    {id:'response',threadId:'thread-11',internalDate:'1791356401000',labelIds:['UNREAD'],
      payload:{headers:[{name:'From',value:'Student <student@example.com>'}]}}
  ]});
  fixture.mailbox.historyId='2';
  fixture.mailbox.changes=[{id:'2',messagesAdded:[{message:{threadId:'thread-11'}}]}];
  from=fixture.requests.length; await api.refreshGmailInbox();
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),11);
  assert.equal(fixture.requests.slice(from).filter(r=>r.name.startsWith('/threads/')).length,1);
});

await test('one project metadata read supplies recent unlinked suggestions and all existing links without full project data', async () => {
  reset(); api.resetGmailInbox();
  Object.assign(fixture.projects[0],{gmailThreadId:null,gmailAccountEmail:null,createdAt:'2026-10-07T08:00:00Z'});
  Object.assign(fixture.projects[1],{gmailThreadId:null,createdAt:'2025-12-30T21:59:00Z'});
  Object.assign(fixture.projects[2],{gmailThreadId:null,createdAt:'2025-12-30T22:00:00Z'});
  Object.assign(fixture.projects[3],{createdAt:'2020-01-01T08:00:00Z'});
  await api.refreshGmailInbox();
  const state=api.getGmailInboxState();
  assert.ok(state.projects.some(p=>p.id==='TEST1'));
  assert.ok(!state.projects.some(p=>p.id==='TEST2'));
  assert.ok(state.projects.some(p=>p.id==='TEST3'));
  assert.ok(state.linked.some(p=>p.id==='TEST4'));
  const reads=fixture.requests.filter(r=>r.name==='projects');
  assert.equal(reads.length,1);
  assert.equal(new URL(reads[0].url).searchParams.get('select'),
    'id,priorityNumber,studentName,studentNumber,email,createdAt,gmailThreadId,gmailAccountEmail');
  assert.ok(!fixture.requests.some(r=>['parts','project_cost_snapshots','print_runs'].includes(r.name)));
  assert.equal(api.suggestedGmailProject(state.items[0],state.projects)?.id,'TEST1');
});

await test('suggested linking uses the loaded snapshot, persists messages and attachments, clears hiding and updates the shared cache', async () => {
  reset(); api.resetGmailInbox();
  Object.assign(fixture.projects[0],{gmailThreadId:null,gmailAccountEmail:null});
  fixture.hiddenThreads.push({gmail_account_email:'printing@example.com',gmail_thread_id:'thread-11'});
  await api.refreshGmailInbox();
  const item=api.getGmailInboxState().items.find(item=>item.threadId==='thread-11');
  assert.equal(api.suggestedGmailProject(item,api.getGmailInboxState().projects)?.id,'TEST1');
  const from=fixture.requests.length;
  await api.linkProjectGmailThread('TEST1',item.snapshot,true);
  const state=api.getGmailInboxState();
  assert.equal(state.projects.find(p=>p.id==='TEST1').gmailThreadId,'thread-11');
  assert.equal(state.linked.find(p=>p.id==='TEST1').priorityNumber,1);
  assert.equal(state.hiddenKeys.has(JSON.stringify(['printing@example.com','thread-11'])),false);
  assert.equal(api.suggestedGmailProject(item,state.projects),null);
  const writes=fixture.requests.slice(from);
  assert.deepEqual(writes.map(r=>r.name),['projects','project_gmail_messages','project_gmail_attachments']);
  assert.equal(new URL(writes[0].url).searchParams.get('gmailThreadId'),'is.null');
  assert.equal(fixture.hiddenThreads.length,0);
  assert.equal(writes[2].body.length,4);
});

await test('a suggestion cannot overwrite a concurrently linked or deleted project, and failed writes leave the cache unchanged', async () => {
  for (const mode of ['linked','deleted','failed']) {
    reset(); api.resetGmailInbox();
    Object.assign(fixture.projects[0],{gmailThreadId:null,gmailAccountEmail:null});
    await api.refreshGmailInbox();
    const thread=api.getGmailInboxState().items[0].snapshot;
    if (mode==='linked') fixture.projects[0].gmailThreadId='remote-thread';
    else if (mode==='deleted') fixture.projects.splice(0,1);
    else fixture.failures.set('projects','write failed');
    const from=fixture.requests.length;
    await assert.rejects(api.linkProjectGmailThread('TEST1',thread,true),/already has an email thread|write failed/);
    assert.equal(api.getGmailInboxState().projects.find(p=>p.id==='TEST1').gmailThreadId,null);
    assert.equal(fixture.requests.length-from,1);
    if (mode==='linked') assert.equal(fixture.projects[0].gmailThreadId,'remote-thread');
  }
});

await test('any unread message in a linked thread needs action, even with a newer sent message', async () => {
  reset(); api.resetGmailInbox();
  fixture.mailbox.threadResponses.set('thread-0',{id:'thread-0',messages:[
    {id:'older-unread',threadId:'thread-0',internalDate:'1791356400000',labelIds:['UNREAD'],payload:{headers:[{name:'From',value:'student@example.com'}]}},
    {id:'newer-read',threadId:'thread-0',internalDate:'1791356401000',labelIds:['SENT'],payload:{headers:[{name:'From',value:'printing@example.com'}]}}
  ]});
  fixture.mailbox.unreadThreadIds.add('thread-10');
  fixture.hiddenThreads.push({gmail_account_email:'printing@example.com',gmail_thread_id:'thread-10'});
  await api.refreshGmailInbox();
  const state=api.getGmailInboxState();
  assert.equal(state.items.find(item=>item.threadId==='thread-0').snapshot.hasUnread,true);
  assert.equal(api.gmailInboxActionCount(state),11);
  assert.equal(fixture.requests.length,16); // Same provider calls as the read-only case.
});

await test('cached linked unread status follows label changes and only refetches the changed thread', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),11);
  fixture.mailbox.unreadThreadIds.add('thread-0'); fixture.mailbox.historyId='2';
  fixture.mailbox.changes=[{id:'2',labelsAdded:[{message:{threadId:'thread-0'},labelIds:['UNREAD']}]}];
  let from=fixture.requests.length;
  await api.refreshGmailInbox();
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),12);
  assert.equal(fixture.requests.slice(from).filter(r=>r.name.startsWith('/threads/')).length,1);
  from=fixture.requests.length; await api.refreshGmailInbox();
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),12);
  assert.equal(fixture.requests.length-from,4); // List/profile/links/hides; no additional unread query.
  fixture.mailbox.unreadThreadIds.delete('thread-0'); fixture.mailbox.historyId='3';
  fixture.mailbox.changes.push({id:'3',labelsRemoved:[{message:{threadId:'thread-0'},labelIds:['UNREAD']}]});
  from=fixture.requests.length; await api.refreshGmailInbox();
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),11);
  assert.equal(fixture.requests.slice(from).filter(r=>r.name.startsWith('/threads/')).length,1);
});

await test('linking a hidden unread thread clears the hide and keeps it actionable without another Gmail read', async () => {
  reset(); api.resetGmailInbox(); fixture.mailbox.unreadThreadIds.add('thread-11');
  await api.refreshGmailInbox();
  const from=fixture.requests.length;
  await api.setGmailThreadHidden('printing@example.com','thread-11',true);
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),10);
  await api.projectReads.updateProjectRecord('TEST1',{gmailThreadId:'thread-11',gmailAccountEmail:'printing@example.com'});
  const state=api.getGmailInboxState();
  assert.equal(state.hiddenKeys.has(JSON.stringify(['printing@example.com','thread-11'])),false);
  assert.equal(api.gmailInboxActionCount(state),11);
  assert.ok(!fixture.requests.slice(from).some(r=>r.name.startsWith('/')));
});

await test('old browser snapshots verify missing unread flags once rather than treating them as read', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  const key='gmail-threads:'+owner.id;
  const saved=await api.readSnapshot(key);
  saved.items.forEach(item=>{delete item.snapshot.hasUnread;});
  await api.writeSnapshot(key,saved);
  fixture.mailbox.unreadThreadIds.add('thread-0');
  let from=fixture.requests.length; await api.refreshGmailInbox();
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),12);
  assert.equal(fixture.requests.slice(from).filter(r=>r.name.startsWith('/threads/')).length,12);
  from=fixture.requests.length; await api.refreshGmailInbox();
  assert.equal(fixture.requests.length-from,4);
});

await test('old browser snapshots verify missing Spam flags once, then reuse the same cache', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  const key='gmail-threads:'+owner.id;
  const saved=await api.readSnapshot(key);
  saved.items.forEach(item=>{delete item.snapshot.hasSpam;});
  await api.writeSnapshot(key,saved);
  fixture.mailbox.spamThreadIds.add('thread-0');
  let from=fixture.requests.length; await api.refreshGmailInbox();
  assert.equal(api.getGmailInboxState().items.find(item=>item.threadId==='thread-0').snapshot.hasSpam,true);
  assert.equal(fixture.requests.slice(from).filter(r=>r.name.startsWith('/threads/')).length,12);
  from=fixture.requests.length; await api.refreshGmailInbox();
  assert.equal(fixture.requests.length-from,4);
  assert.ok(!fixture.requests.slice(from).some(r=>r.name.startsWith('/threads/')));
});

await test('project button priorities follow successful local saves and fresh remote reads without Gmail body requests', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  assert.equal(api.getGmailInboxState().linked.find(link=>link.id==='TEST1').priorityNumber,1);
  let from=fixture.requests.length;
  await api.projectReads.updateProjectRecord('TEST1',{priorityNumber:123});
  assert.equal(api.getGmailInboxState().linked.find(link=>link.id==='TEST1').priorityNumber,123);
  assert.ok(!fixture.requests.slice(from).some(r=>r.name.startsWith('/')));
  await api.projectReads.updateProjectRecord('TEST1',{gmailThreadId:'thread-1'});
  assert.equal(api.getGmailInboxState().linked.find(link=>link.id==='TEST1').priorityNumber,123);
  fixture.projects[0].priorityNumber=456;
  from=fixture.requests.length; await api.refreshGmailInbox();
  assert.equal(api.getGmailInboxState().linked.find(link=>link.id==='TEST1').priorityNumber,456);
  assert.ok(!fixture.requests.slice(from).some(r=>r.name.startsWith('/threads/')));
});

await test('the ten-minute refresh reuses bodies and observes remote hides, links and deletions', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  let from=fixture.requests.length;
  await api.refreshGmailInbox(true); assert.equal(fixture.requests.length,from);
  const originalNow=Date.now; Date.now=()=>originalNow()+10*60*1000+1;
  try {
    fixture.projects[0].gmailThreadId='thread-11';
    fixture.hiddenThreads.push({gmail_account_email:'printing@example.com',gmail_thread_id:'thread-10'});
    fixture.mailbox.threadIds=fixture.mailbox.threadIds.filter(id=>id!=='thread-9');
    await api.refreshGmailInbox(true);
    const state=api.getGmailInboxState();
    assert.equal(api.gmailInboxActionCount(state),8);
    assert.equal(state.items.length,11);
    assert.equal(state.linked.find(link=>link.id==='TEST1').gmailThreadId,'thread-11');
    assert.equal(fixture.requests.length-from,4);
    assert.ok(!fixture.requests.slice(from).some(r=>r.name.startsWith('/threads/')));
  } finally {Date.now=originalNow;}
});

await test('successful local hide/link/unlink writes update the shared count without a Gmail read', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  const from=fixture.requests.length;
  await api.setGmailThreadHidden('printing@example.com','thread-11',true);
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),10);
  const thread=api.getGmailInboxState().items.find(item=>item.threadId==='thread-11').snapshot;
  await api.projectReads.updateProjectRecord('TEST1',{gmailThreadId:thread.id,gmailAccountEmail:thread.accountEmail});
  let state=api.getGmailInboxState();
  assert.ok(state.linked.some(link=>link.id==='TEST1'&&link.gmailThreadId==='thread-11'));
  assert.equal(state.hiddenKeys.has(JSON.stringify(['printing@example.com','thread-11'])),false);
  // TEST1 changed its old thread, but 79 other projects still link that thread.
  assert.equal(api.gmailInboxActionCount(state),10);
  await api.projectReads.updateProjectRecord('TEST1',{gmailThreadId:null,gmailAccountEmail:null});
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),11);
  fixture.failures.set('gmail_hidden_threads','save failed');
  await assert.rejects(api.setGmailThreadHidden('printing@example.com','thread-11',true),/save failed/);
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),11);
  assert.ok(!fixture.requests.slice(from).some(r=>r.name.startsWith('/')));
});

await test('a save racing revalidation cannot restore outdated hidden or linked membership', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  const pending=api.refreshGmailInbox();
  await fixture.wait(8);
  await api.projectReads.updateProjectRecord('TEST1',{gmailThreadId:'thread-11',gmailAccountEmail:'printing@example.com'});
  await pending;
  assert.ok(api.getGmailInboxState().linked.some(link=>link.id==='TEST1'&&link.gmailThreadId==='thread-11'));
  assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),10);
});

await test('verification errors show no saved emails and do not claim an accurate action count', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  fixture.failures.set('gmail_hidden_threads','hidden list unavailable');
  await api.refreshGmailInbox();
  let state=api.getGmailInboxState();
  assert.equal(state.verified,false); assert.equal(state.status,'error'); assert.deepEqual(state.items,[]);
  fixture.failures.clear(); fixture.failures.set('/profile',{status:401,message:'access needed'});
  await api.refreshGmailInbox();
  state=api.getGmailInboxState(); assert.equal(state.status,'auth'); assert.equal(state.verified,false);
});

await test('account changes and sign-out discard shared mailbox state', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  owner={id:'other-inbox-owner',email:'printing@example.com'};
  fixture.mailbox.threadIds=['thread-4'];
  await api.refreshGmailInbox(true);
  assert.deepEqual(api.getGmailInboxState().threadIds,['thread-4']);
  owner=null; await api.refreshGmailInbox();
  assert.equal(api.getGmailInboxState().status,'auth'); assert.deepEqual(api.getGmailInboxState().items,[]);
});

await test('January replaces the single browser snapshot and excludes previous-year hide entries', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  fixture.hiddenThreads.push({gmail_account_email:'printing@example.com',gmail_thread_id:'thread-11',hidden_at:'2026-12-01T00:00:00Z'});
  const originalNow=Date.now; Date.now=()=>Date.parse('2027-01-01T00:00:00+02:00');
  try {
    fixture.mailbox.threadIds=['thread-11'];
    await api.refreshGmailInbox(true);
    const state=api.getGmailInboxState();
    assert.equal(state.year,2027); assert.equal(state.hiddenKeys.size,0); assert.equal(api.gmailInboxActionCount(state),1);
    const saved=await api.readSnapshot('gmail-threads:'+owner.id);
    assert.equal(saved.year,2027); assert.equal(saved.items.length,1);
    await api.setGmailThreadHidden('printing@example.com','thread-11',true);
    assert.equal(fixture.hiddenThreads.length,1);
    assert.equal(api.gmailInboxActionCount(api.getGmailInboxState()),0);
  } finally {Date.now=originalNow;api.resetGmailInbox();}
});

await test('retired unread/import caches are removed without clearing project snapshots', async () => {
  reset();
  await api.writeSnapshot('unread-gmail-v1:old',{emails:['old']});
  await api.writeSnapshot('recent-gmail-v2:old',{items:['old']});
  await api.writeSnapshot('active-projects:other',{projects:['keep']});
  await api.listRecent3dPrintThreads();
  assert.equal(await api.readSnapshot('unread-gmail-v1:old'),undefined);
  assert.equal(await api.readSnapshot('recent-gmail-v2:old'),undefined);
  assert.deepEqual(await api.readSnapshot('active-projects:other'),{projects:['keep']});
});

await test('Create project uses the same import extraction and module defaults without fetching Gmail', async () => {
  reset(); api.resetGmailInbox(); await api.refreshGmailInbox();
  const item=api.getGmailInboxState().items[0];
  item.snapshot.messages[0].body='Name: Ada Lovelace\nStudent number: 12345678\nModule: ABC 123';
  const from=fixture.requests.length;
  const form=api.gmailProjectFormValues(item,[],[{id:'module',code:'ABC123',lecturer:'Fixture Lecturer',modulePayment:true,defaultFilamentSource:'STUDENT'}]);
  assert.equal(form.studentName,'Ada Lovelace');assert.equal(form.studentNumber,'12345678');
  assert.equal(form.email,'student@example.com');assert.equal(form.course,'ABC 123');
  assert.equal(form.lecturer,'Fixture Lecturer');assert.equal(form.needsPayment,false);
  assert.equal(fixture.requests.length,from);
});
