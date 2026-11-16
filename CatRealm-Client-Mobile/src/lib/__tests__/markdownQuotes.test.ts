import { isQuoteLine, isQuoteRestLine } from '../markdownQuotes';

test('faces that start with > are not quotes', () => {
  for (const face of ['>~>', '>_<', '>.<', '>w<', '>>>_<', '>>>.>', '>:3']) {
    expect(isQuoteLine(face)).toBe(false);
    expect(isQuoteRestLine(face)).toBe(false);
  }
});

test('> and >>> followed by a space, or alone, are still quotes', () => {
  expect(isQuoteLine('> quoted')).toBe(true);
  expect(isQuoteLine('>')).toBe(true);
  expect(isQuoteRestLine('>>> the rest')).toBe(true);
  expect(isQuoteRestLine('>>>')).toBe(true);
});
