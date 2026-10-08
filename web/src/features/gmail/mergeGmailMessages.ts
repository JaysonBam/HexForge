import type { GmailThreadMessage } from '@/api/google/gmail/types';

export const mergeGmailMessages = (live: GmailThreadMessage[], cached: GmailThreadMessage[]): GmailThreadMessage[] => {
  const statuses = new Map(cached.flatMap(message => message.attachments).map(attachment => [
    `${attachment.messageId}:${attachment.partId}`, attachment
  ]));
  return live.map(message => ({ ...message, attachments: message.attachments.map(attachment => {
    const saved = statuses.get(`${attachment.messageId}:${attachment.partId}`);
    return saved ? { ...attachment, downloadStatus: saved.downloadStatus, savedFilename: saved.savedFilename, downloadError: saved.downloadError } : attachment;
  }) }));
};
