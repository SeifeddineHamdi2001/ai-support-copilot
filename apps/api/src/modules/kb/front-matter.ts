export interface FrontMatter {
  attributes: Record<string, string>;
  body: string;
}

/**
 * Reads a `---` delimited block of flat `key: value` lines at the top of a Markdown file. That is all the
 * seed documents use, so a full YAML parser is not needed. Without a block, `body` is the whole text.
 */
export function parseFrontMatter(markdown: string): FrontMatter {
  const text = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { attributes: {}, body: text };

  const attributes: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (pair) attributes[pair[1]] = pair[2].replace(/^(["'])(.*)\1$/, '$2').trim();
  }
  return { attributes, body: text.slice(match[0].length) };
}
