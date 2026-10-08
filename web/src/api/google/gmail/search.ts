export const isSupportedGmailAttachment = (filename: string): boolean =>
  /\.(stl|3mf|zip)$/i.test(filename.trim());

// Epoch boundaries avoid Gmail's Pacific-time interpretation of calendar dates.
const calendarYearFormat = new Intl.DateTimeFormat('en', {
  timeZone: 'Africa/Johannesburg', year: 'numeric'
});
export const gmailCalendarYear = () => Number(calendarYearFormat.format(Date.now()));
export const gmailYearStart = (year = gmailCalendarYear()) => Date.UTC(year, 0, 1) - 2 * 60 * 60 * 1000;

export const buildCurrentYearPrintEmailQuery = (term: string, year = gmailCalendarYear()): string => {
  const searchTerm = /\s/.test(term) ? `"${term}"` : term;
  return `after:${gmailYearStart(year) / 1000} before:${gmailYearStart(year + 1) / 1000} -in:trash ${searchTerm}`;
};

export const getGmailMessageDirection = (
  senderEmail: string,
  accountEmail: string,
  hasSentLabel = false
): 'incoming' | 'outgoing' =>
  hasSentLabel || senderEmail.trim().toLowerCase() === accountEmail.trim().toLowerCase()
    ? 'outgoing'
    : 'incoming';
