// Test-only entry point for API, cache and download contract regressions.
export { getProjects } from '../../src/api/supabase/projects';
export * as projectReads from '../../src/api/supabase/projects';
export { getPartCounts, buildDashboardLanes } from '../../src/domain/operations';
export {
  loadProjectGmailMessages,
  updateAttachmentDownloadStatus,
  syncProjectGmailThread
} from '../../src/features/gmail/gmailProjectService';
export { getUnread3dPrintEmailSummary } from '../../src/api/google/gmail/client';
export { listRecent3dPrintThreads, downloadGmailAttachment } from '../../src/api/google/gmail/threads';
export {
  prepareGmailAttachmentDownload,
  downloadPreparedGmailAttachments
} from '../../src/features/gmail/gmailAttachmentDownload';
export { supabase } from '../../src/api/supabase/client';
