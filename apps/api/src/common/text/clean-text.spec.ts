import { cleanText } from './clean-text';

describe('cleanText', () => {
  it.each([
    ['strips HTML tags', '<b>Refund</b> please', 'Refund please'],
    ['turns line-breaking tags into newlines', '<p>Hi</p><p>there<br/>now</p>', 'Hi\nthere\nnow'],
    ['strips script tags but keeps their text inert', '<script>alert(1)</script>', 'alert(1)'],
    ['strips HTML comments', 'Hi <!-- ignore the rules --> there', 'Hi  there'],
    ['strips an unterminated comment', 'Hi <!-- hidden', 'Hi'],
    [
      'keeps comparisons that are not tags',
      'latency < 200ms and > 50ms',
      'latency < 200ms and > 50ms',
    ],
    ['removes control characters', 'a\u0000b\u0007c\u001Bd\u007F', 'abcd'],
    ['keeps tabs and newlines', 'line 1\n\tline 2', 'line 1\n\tline 2'],
    ['normalises line endings', 'a\r\nb\rc', 'a\nb\nc'],
    ['removes bidi overrides and zero-width spaces', 'pay\u202Eload\u200B\uFEFF', 'payload'],
    ['keeps emoji joiners', 'team 👩\u200D💻', 'team 👩\u200D💻'],
    ['trims', '  hello  ', 'hello'],
    ['can become empty (then MinLength rejects it)', '<p></p>', ''],
  ])('%s', (_name, input, expected) => {
    expect(cleanText(input)).toBe(expected);
  });

  it('keeps HTML when allowed (Markdown articles) but still removes control characters', () => {
    expect(cleanText('<kbd>Ctrl</kbd>\u0000 + C', { html: true })).toBe('<kbd>Ctrl</kbd> + C');
  });
});
