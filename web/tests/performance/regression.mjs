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

await test('unread reminder publishes partial data and retains the exact sorted final top ten', async () => {
  reset(); const progress = [];
  const summary = await api.getUnread3dPrintEmailSummary({ onProgress: value => progress.push(value) });
  assert.equal(progress[0].count, 1); assert.equal(progress[0].complete, false);
  assert.equal(summary.complete, true); assert.equal(summary.count, 10);
  assert.deepEqual(summary.flaggedEmails.map(e => e.id), Array.from({ length:10 }, (_,i) => `message-${11-i}`));
});

await test('unread membership is verified live while unchanged message metadata is reused', async () => {
  reset(); const initial = await api.getUnread3dPrintEmailSummary();
  let from=fixture.requests.length;
  assert.deepEqual((await api.getUnread3dPrintEmailSummary()).flaggedEmails,initial.flaggedEmails);
  assert.equal(fixture.requests.length-from,2);
  fixture.mailbox.threadIds=fixture.mailbox.threadIds.filter(id=>id!=='thread-11');
  from=fixture.requests.length;
  const current=await api.getUnread3dPrintEmailSummary();
  assert.ok(current.flaggedEmails.every(email=>email.id!=='message-11'));
  assert.equal(current.count,10); assert.equal(fixture.requests.length-from,3);
});

await test('three-hour reconciliation refreshes both thread content and unread metadata', async () => {
  reset(); await api.listRecent3dPrintThreads(); await api.getUnread3dPrintEmailSummary();
  const originalNow=Date.now; const future=originalNow()+3*60*60*1000+1;
  Date.now=()=>future;
  try {
    const progress=[];
    let from=fixture.requests.length; await api.listRecent3dPrintThreads({onProgress:rows=>progress.push(rows)});
    assert.equal(fixture.requests.length-from,14);
    assert.equal(progress[0][0].threadId,'thread-11');
    assert.ok(progress[0].every(row=>fixture.requests.slice(from).some(request=>request.name===`/threads/${row.threadId}?format=full` && request.end>0)));
    from=fixture.requests.length; await api.getUnread3dPrintEmailSummary();
    assert.equal(fixture.requests.length-from,12);
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
