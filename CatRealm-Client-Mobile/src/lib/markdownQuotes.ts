/**
 * Quote markers, as on desktop (chat/MessageFormatter.tsx): `> ` quotes one line and `>>> `
 * quotes the rest of the message. The marker needs a space after it (or nothing at all), so
 * faces like `>~>`, `>_<` or `>>>.<` stay text.
 */
export const isQuoteLine = (line: string) => /^>(\s|$)/.test(line);
export const isQuoteRestLine = (line: string) => /^>>>(\s|$)/.test(line);
