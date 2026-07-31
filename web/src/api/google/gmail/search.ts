export const isSupportedGmailAttachment = (filename: string): boolean =>
  /\.(stl|3mf|zip)$/i.test(filename.trim());

export const buildRecentPrintEmailQuery = (term: string): string => {
  const searchTerm = /\s/.test(term) ? `"${term}"` : term;
  return `newer_than:30d ${searchTerm}`;
};

export const buildUnreadPrintEmailQuery = (term: string): string => {
  const searchTerm = /\s/.test(term) ? `"${term}"` : term;
  return `newer_than:90d is:unread -from:linkedin.com ${searchTerm}`;
};

export const getGmailMessageDirection = (
  senderEmail: string,
  accountEmail: string,
  hasSentLabel = false
): 'incoming' | 'outgoing' =>
  hasSentLabel || senderEmail.trim().toLowerCase() === accountEmail.trim().toLowerCase()
    ? 'outgoing'
    : 'incoming';
