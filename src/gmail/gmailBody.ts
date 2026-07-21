/** Remove the quoted history Gmail includes in reply bodies before displaying or caching it. */
export const stripQuotedReplyContent = (body: string): string => {
  const normalized = body.replace(/\r/g, '').trim();
  if (!normalized) return '';

  const lines = normalized.split('\n');
  const replyBoundary = lines.findIndex((line, index) =>
    /^\s*On .+wrote:\s*$/i.test(line) ||
    /^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}\s*$/i.test(line) ||
    (/^\s*From:\s*.+$/i.test(line) && lines.slice(Math.max(0, index - 2), index).some((previous) => /^\s*-{2,}/.test(previous)))
  );
  const visibleLines = replyBoundary >= 0 ? lines.slice(0, replyBoundary) : lines;
  const firstQuotedLine = visibleLines.findIndex((line) => /^\s*>/.test(line));
  const withoutQuotedLines = firstQuotedLine >= 0 ? visibleLines.slice(0, firstQuotedLine) : visibleLines;
  const signatureBoundary = withoutQuotedLines.findIndex((line, index) =>
    index > 0 &&
    !withoutQuotedLines[index - 1].trim() &&
    /^\s*(kind regards|best regards|warm regards|regards|all the best)\s*,?\s*$/i.test(line)
  );
  const messageLines = signatureBoundary >= 0 ? withoutQuotedLines.slice(0, signatureBoundary) : withoutQuotedLines;
  return messageLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
