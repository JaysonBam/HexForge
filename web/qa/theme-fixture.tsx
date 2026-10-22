// Local visual-review entry only. This file is never imported by the production app.
// Uses the real screens and providers; every data request stays inside this fixture.
import { createRoot } from 'react-dom/client';
import App from '../src/app/App';
import { supabase } from '../src/api/supabase/client';

const query = new URLSearchParams(location.search);
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'preview@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Preview Technician' }, identities: [], created_at: '2026-10-22T07:00:00Z' };
const session = location.pathname === '/login' ? null : { access_token: 'fixture-only', refresh_token: 'fixture-only', token_type: 'bearer', expires_at: 9999999999, user };
supabase.auth.getSession = async () => ({ data: { session }, error: null }) as never;
supabase.auth.onAuthStateChange = ((callback: (event: string, value: unknown) => void) => {
  queueMicrotask(() => callback('INITIAL_SESSION', session));
  return { data: { subscription: { unsubscribe() {} } } };
}) as never;

const projects = [
  { id: 'REVIEW', studentName: 'Alex Morgan', state: 'REVIEW', notes: 'Please keep both materials together. Confirm the fit before printing the full set.' },
  { id: 'QUEUE', studentName: 'Sam Ndlovu', state: 'READY_FOR_PRINTING', printLabel: 'Tray B2' },
  { id: 'ACTIVE', studentName: 'Jamie Jacobs', state: 'IN_PRODUCTION', printLabel: 'Box A1', gmailThreadId: 'thread-1', gmailAccountEmail: user.email, gmailMainContactEmail: 'student@example.com', gmailThreadSubject: 'MEC 310 prototype assembly' },
  { id: 'COLLECT', studentName: 'Taylor Williams', state: 'READY_FOR_COLLECTION', printLabel: 'Collection shelf C3', receiptNumber: 'REC-2026-041' },
  { id: 'QUOTE', studentName: 'Jordan Patel', state: 'AWAITING_PAYMENT', gmailThreadId: 'thread-1', gmailAccountEmail: user.email, gmailThreadSubject: 'Prototype quote', gmailMainContactEmail: 'student@example.com' },
  { id: 'CLOSED', studentName: 'Casey Dlamini', state: 'CLOSED', receiptNumber: 'REC-2026-032', printLabel: 'Collected' },
  { id: 'CANCEL', studentName: 'Riley Smith', state: 'CANCELLED', archived: true },
  { id: 'EMPTY', studentName: 'Lee Botha', state: 'REVIEW' }
].map((project, index) => ({ priorityNumber: 41 + index, studentNumber: `2401000${index + 1}`, email: 'student@example.com', course: index % 2 ? 'IGM 320' : 'MEC 310', lecturer: 'Dr Smith', needsPayment: true, archived: false, defaultFilamentSource: 'misc', createdAt: '2026-10-22T07:00:00Z', ...project }));

const groups = [['DRAFT', 'VERIFIED'], ['READY', 'READY'], ['READY', 'PRINTING', 'PRINTED'], ['PRINTED', 'COLLECTED'], ['VERIFIED', 'VERIFIED'], ['COLLECTED'], [], []];
const names = ['Base plate', 'Mounting bracket', 'Cover plate'];
const parts = projects.flatMap((project, i) => groups[i].map((printStatus, p) => ({
  id: `${project.id}-${p}`, projectId: project.id, partNumber: p + 1, partName: names[p], primaryMaterial: 'PLA', primaryBrand: 'Polymaker', primaryOwnFilament: false, primaryFilamentSource: 'misc', primaryEstimatedWeight: 42 + p * 8, primaryWeight: 42 + p * 8, primaryLength: 14.2, primaryMaterialCost: 21 + p * 4, primaryServiceCost: 21 + p * 4, printingTime: '01:25',
  ...(p === 1 ? { secondaryMaterial: 'PETG', secondaryEstimatedWeight: 12, secondaryWeight: 12, secondaryMaterialCost: 6, secondaryServiceCost: 1.2, secondaryFilamentSource: 'student_provided', secondaryOwnFilament: true } : {}),
  specialInstruction: p === 0 ? 'Keep the top face smooth; use supports on the mounting holes.' : '', checkedBy: printStatus === 'DRAFT' ? undefined : 'Preview Technician', printerName: 'Bambu X1 Carbon', startedBy: 'Preview Technician', removedBy: 'Preview Technician', collectedBy: printStatus === 'COLLECTED' ? 'Preview Technician' : undefined, collectedAt: printStatus === 'COLLECTED' ? '2026-10-22T09:15:00Z' : undefined, printStatus
})));
const snapshots = projects.filter(p => !['REVIEW', 'CANCELLED'].includes(p.state)).map(project => ({ project_id: project.id, snapshot_version: 1, status: 'ISSUED', currency: 'ZAR', total_cost: 82, generated_at: '2026-10-22T08:00:00Z', line_summary: parts.filter(p => p.projectId === project.id).map(p => ({ part_id: p.id, part_number: p.partNumber, part_name: p.partName, total_grams: p.primaryEstimatedWeight, total_cost: p.primaryServiceCost, materials: [{ slot: 'primary', material_bucket: 'misc', filament_source: 'misc', material: 'PLA', grams: p.primaryEstimatedWeight, cost: p.primaryServiceCost }] })) }));
const runs = parts.filter(p => ['PRINTING', 'PRINTED', 'COLLECTED'].includes(p.printStatus)).map((p, i) => ({ id: i + 1, part_id: p.id, project_id: p.projectId, machine_name: 'Bambu X1 Carbon', started_by: 'Preview Technician', started_at: '2026-10-22T08:00:00Z', finished_at: p.printStatus === 'PRINTING' ? null : '2026-10-22T09:25:00Z', ended_by: p.printStatus === 'PRINTING' ? null : 'Preview Technician', outcome: p.printStatus === 'PRINTING' ? null : 'PRINTED' }));
const config = [
  { key: 'settings_staff', value: ['Preview Technician', 'Desk Assistant'] },
  { key: 'settings_printers', value: ['Bambu X1 Carbon', 'Ultimaker S5'] },
  { key: 'settings_brands', value: ['Polymaker', 'eSUN'] },
  { key: 'settings_modules', value: [{ id: 'mec', code: 'MEC 310', lecturer: 'Dr Smith', modulePayment: false, defaultFilamentSource: 'LAB' }, { id: 'igm', code: 'IGM 320', lecturer: 'Prof Jones', modulePayment: true, defaultFilamentSource: 'MODULE' }] },
  { key: 'settings_filaments', value: [{ id: 'pla', type: 'PLA', pricePerGram: 0.5 }, { id: 'petg', type: 'PETG', pricePerGram: 0.5 }, { id: 'abs', type: 'ABS', pricePerGram: 0.7 }] },
  { key: 'settings_provided_filament_price_per_gram', value: 0.1 }
];
const messages = [{ project_id: 'ACTIVE', gmail_message_id: 'message-1', gmail_thread_id: 'thread-1', sender_name: 'Jamie Jacobs', sender_email: 'student@example.com', recipient_emails: [user.email], subject: 'MEC 310 prototype assembly', body_text: 'Hi team,\n\nPlease print the updated prototype. Keep the mounting holes clear. I will collect the parts on Friday.\n\nThank you,\nJamie', message_date: '2026-10-22T07:00:00Z', direction: 'incoming', has_attachments: true }];
const attachments = [{ project_id: 'ACTIVE', gmail_message_id: 'message-1', gmail_attachment_id: 'attachment-1', filename: 'prototype-assembly.3mf', mime_type: 'application/octet-stream', size_bytes: 245000, download_status: 'pending' }];
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = init?.method || 'GET';
  const table = url.pathname.split('/').at(-1);
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/v1/') && query.has('helper')) {
    const helper = query.get('helper');
    const folderName = '43 - Jamie Jacobs - 24010003';
    const relativePath = `Currently Printing/${folderName}`;
    if (table === 'health') return json({ apiVersion: 'v1', helperVersion: '1.2.0', state: helper === 'root' ? 'root_unavailable' : 'connected', configured: true, rootAvailable: helper !== 'root', installationId: 'fixture-only', port: 47821 });
    if (table === 'resolve' || table === 'sync') return json(helper === 'ambiguous'
      ? { status: 'ambiguous', candidates: [{ candidateId: 'one', folderName, relativePath, workflowFolder: 'currently_printing' }, { candidateId: 'two', folderName: folderName + ' (copy)', relativePath: relativePath + ' (copy)', workflowFolder: 'currently_printing' }] }
      : { status: 'matched', projectKey: 'fixture-project', folderName, relativePath, workflowFolder: 'currently_printing', sync: { isInSync: true, expectedWorkflowFolder: 'currently_printing', expectedFolderName: folderName, locationMismatch: false, nameMismatch: false, suggestedActionLabel: 'In sync' } });
    if (table === 'files') return json({ folderName, relativePath, totalFiles: 2, counts: { model: 1, print_ready: 1 }, truncated: false, files: [
      { fileId: 'model', filename: 'Prototype assembly.stl', relativePath: 'Prototype assembly.stl', relativeDirectory: '', size: 245000, modifiedAt: '2026-10-22T07:00:00Z', kind: 'stl', group: 'model', importEligible: false },
      { fileId: 'plate', filename: 'Base plate.gcode.3mf', relativePath: 'Base plate.gcode.3mf', relativeDirectory: '', size: 520000, modifiedAt: '2026-10-22T08:00:00Z', kind: 'gcode.3mf', group: 'print_ready', importEligible: true }
    ] });
    return json({ error: { code: 'PREVIEW_ONLY', message: 'Desktop actions are disabled in this preview.' } }, 503);
  }
  if (url.hostname !== 'theme-fixture.invalid') return json({ error: { message: 'Local helper offline in the preview' } }, 503);
  if (query.has('loading') && ['read_active_project_cache', 'config', 'projects'].includes(table!)) await new Promise(resolve => setTimeout(resolve, 60000));
  if (query.has('failure') && ['read_active_project_cache', 'projects', 'config'].includes(table!)) return json({ message: 'Connection unavailable. Please try again.' }, 503);
  if (table === 'read_active_project_cache') return json(query.has('empty') ? [] : projects.filter(p => !['CLOSED', 'CANCELLED', 'READY_FOR_COLLECTION'].includes(p.state)).map(project => ({ project_id: project.id, version: project.id, project_data: { project, parts: parts.filter(p => p.projectId === project.id), snapshots: snapshots.filter(s => s.project_id === project.id), print_runs: runs.filter(r => r.project_id === project.id) } })));
  if (table === 'gmail-connection') return json({ connected: true, account_email: user.email });
  if (table === 'gmail-proxy') {
    const path = url.searchParams.get('path') || '';
    if (path.includes('/profile')) return json({ emailAddress: user.email, historyId: '1' });
    if (path.includes('/threads/')) return json({ id: 'thread-1', messages: [{ id: 'message-1', threadId: 'thread-1', internalDate: '1792652400000', payload: { headers: [{ name: 'From', value: 'Jamie Jacobs <student@example.com>' }, { name: 'Subject', value: 'MEC 310 prototype assembly' }], body: { data: btoa('Please print the updated prototype.') }, mimeType: 'text/plain' } }] });
    return json({ messages: [{ id: 'message-1', threadId: 'thread-1' }], threads: [{ id: 'thread-1' }], historyId: '1', resultSizeEstimate: 1 });
  }
  if (method === 'POST' && ['project_gmail_messages', 'project_gmail_attachments'].includes(table!)) return json(JSON.parse(String(init?.body || '[]')));
  if (method === 'PATCH' && table === 'projects') {
    const project = projects.find(p => `eq.${p.id}` === url.searchParams.get('id'));
    if (project) Object.assign(project, JSON.parse(String(init?.body || '{}')));
    return json(project || null);
  }
  if (method !== 'GET') return json({ message: 'Writes are disabled in this visual preview.' }, 403);
  let rows: unknown = ({ projects: query.has('empty') ? [] : projects.map(p => ({ ...p, parts: parts.filter(part => part.projectId === p.id).map(part => ({ printStatus: part.printStatus })) })), parts, config, project_cost_snapshots: snapshots, print_runs: runs, project_gmail_messages: messages, project_gmail_attachments: attachments, profiles: { ...user, status: 'active', profile_url: null }, audit_events: [{ id: 1, project_id: 'ACTIVE', action_type: 'START_PRINT', technician_name: 'Preview Technician', created_at: '2026-10-22T08:00:00Z', payload: { part_name: 'Mounting bracket', machine_name: 'Bambu X1 Carbon' } }] } as Record<string, unknown>)[table!] ?? [];
  if (Array.isArray(rows)) {
    for (const [column, filter] of url.searchParams) {
      if (filter.startsWith('eq.')) rows = (rows as Record<string, unknown>[]).filter(row => String(row[column]) === filter.slice(3));
      if (filter.startsWith('in.')) { const values = filter.slice(3).replace(/[()]/g, '').split(','); rows = (rows as Record<string, unknown>[]).filter(row => values.includes(String(row[column]))); }
    }
  }
  return json(rows);
};
localStorage.setItem('misc-print-ops.active-staff-session', JSON.stringify({ name: 'Preview Technician', lastUsedAt: new Date().toISOString() }));
createRoot(document.getElementById('root')!).render(<App />);
