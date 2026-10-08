// Test-only entry point for API, cache and download contract regressions.
export { getProjects } from '../../src/api/supabase/projects';
export * as projectReads from '../../src/api/supabase/projects';
export { getPartCounts, buildDashboardLanes } from '../../src/domain/operations';
export {
  loadProjectGmailMessages,
  updateAttachmentDownloadStatus,
  syncProjectGmailThread
} from '../../src/features/gmail/gmailProjectService';
export * from '../../src/features/gmail/gmailInboxStore';
export { gmailProjectFormValues } from '../../src/features/gmail/gmailProjectForm';
export { buildCurrentYearPrintEmailQuery, gmailCalendarYear, gmailYearStart } from '../../src/api/google/gmail/search';
export { readSnapshot, writeSnapshot, removeReadSnapshots } from '../../src/lib/persistentReads';
export { listRecent3dPrintThreads, downloadGmailAttachment } from '../../src/api/google/gmail/threads';
export {
  prepareGmailAttachmentDownload,
  downloadPreparedGmailAttachments
} from '../../src/features/gmail/gmailAttachmentDownload';
export { supabase } from '../../src/api/supabase/client';
export { getLinkedProjectGmailThreads, getHiddenGmailThreads, setGmailThreadHidden } from '../../src/api/supabase/gmailRecords';
export { buildLinkedGmailThreadKeys, visibleGmailThreads } from '../../src/features/gmail/linkedGmailThreads';
export { classifyGmailProxyRequest } from '../../../supabase/functions/_shared/gmailProxyPolicy.ts';
