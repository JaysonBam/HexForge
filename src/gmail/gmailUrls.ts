export const getGmailThreadUrl = (threadId: string): string =>
  `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;

export const openGmailThread = (threadId: string): void => {
  window.open(getGmailThreadUrl(threadId), '_blank', 'noopener,noreferrer');
};
