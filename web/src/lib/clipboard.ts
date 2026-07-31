export const copyRichTextToClipboard = async (plainText: string, html: string) => {
  if (navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
    try {
      const clipboardItem = new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      });

      await navigator.clipboard.write([clipboardItem]);
      return;
    } catch {
      // Some browsers expose the rich clipboard API but reject HTML writes.
    }
  }

  await navigator.clipboard.writeText(plainText);
};
