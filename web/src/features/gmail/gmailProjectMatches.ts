import type { GmailThreadListItem } from '@/api/google/gmail/types';
import type { GmailInboxProject } from '@/api/supabase/gmailRecords';
import { extractProjectSuggestions } from './gmailParsing';

const dayMs = 24 * 60 * 60 * 1000;
// Compare calendar days in South Africa, including emails near midnight.
const localDay = (value: string) => Math.floor((Date.parse(value) + 2 * 60 * 60 * 1000) / dayMs);
const emailKey = (value: string) => value.trim().toLowerCase();
const nameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

export const suggestedGmailProject = (
  item: GmailThreadListItem,
  projects: readonly GmailInboxProject[]
): GmailInboxProject | null => {
  const incoming = item.snapshot.messages.filter(message => message.direction === 'incoming'
    && message.senderEmail.trim() && emailKey(message.senderEmail) !== emailKey(item.snapshot.accountEmail));
  const emailDay = Math.min(...incoming.map(message => localDay(message.messageDate)).filter(Number.isFinite));
  if (!Number.isFinite(emailDay)) return null;
  // Do not let an existing project's name influence the identity we are matching.
  const identity = extractProjectSuggestions(item.snapshot, []);
  if (identity.studentNumberCandidates.length > 1) return null;
  const contact = emailKey(identity.email);
  const name = nameKey(identity.studentName);
  let best: GmailInboxProject[] = [];
  let bestScore = 0;
  for (const project of projects) {
    if (!project.id || project.gmailThreadId || !Number.isFinite(localDay(project.createdAt))
      || Math.abs(localDay(project.createdAt) - emailDay) > 1) continue;
    const number = project.studentNumber.trim().replace(/^u/i, '');
    // A conflicting student number is stronger evidence than a matching name/email.
    if (identity.studentNumber && number && identity.studentNumber !== number) continue;
    const score = identity.studentNumber && identity.studentNumber === number ? 3
      : contact && contact === emailKey(project.email || '') ? 2
      : name.split(' ').length >= 2 && name === nameKey(project.studentName) ? 1 : 0;
    if (score > bestScore) { best = [project]; bestScore = score; }
    else if (score && score === bestScore) best.push(project);
  }
  // Ambiguous matches stay manual; never guess between repeat projects.
  return best.length === 1 ? best[0] : null;
};
