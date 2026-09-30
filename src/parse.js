// Turns a Markdown case study into units (headings, paragraphs, list items, table rows, quotes)
// and sentences, keeping line numbers. Code fences, HTML comments and images are skipped.

const DIRECTIVE = /<!--\s*proof-ignore:\s*([\w-]+(?:\s*,\s*[\w-]+)*)\s*(?:--|:)?\s*(.*?)\s*-->/;
const ABBREV = new Set(['vs', 'etc', 'e.g', 'i.e', 'approx', 'avg', 'inc', 'ltd', 'no', 'mr', 'mrs', 'ms', 'dr', 'st', 'fig', 'est']);

export function parseFrontMatter(lines) {
  const front = {};
  if (lines[0] && lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') return { front, end: i + 1 };
      const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
      if (m) front[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { front: {}, end: 0 };
}

export function parseDocument(raw) {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const { front, end } = parseFrontMatter(lines);
  const units = [];
  const directives = [];
  let cur = null;
  let inFence = false;
  let inComment = false;
  let pendingDirectives = [];

  const flush = () => {
    if (cur) units.push(cur);
    cur = null;
  };
  const start = (kind, no, text) => {
    flush();
    cur = { kind, startLine: no, lines: [{ no, text }] };
    for (const d of pendingDirectives) d.target = no;
    pendingDirectives = [];
  };

  for (let i = end; i < lines.length; i++) {
    const no = i + 1;
    let line = lines[i];
    if (inComment) {
      if (line.includes('-->')) {
        inComment = false;
        line = line.slice(line.indexOf('-->') + 3);
      } else continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;

    const dm = DIRECTIVE.exec(line);
    if (dm) {
      const standalone = line.replace(DIRECTIVE, '').trim() === '';
      const d = {
        line: no,
        rules: dm[1].split(',').map((s) => s.trim()),
        reason: dm[2].trim(),
        standalone,
        target: null
      };
      directives.push(d);
      if (standalone) {
        flush();
        pendingDirectives.push(d);
        continue;
      }
      line = line.replace(DIRECTIVE, '');
    }
    // strip single-line comments, open multi-line ones
    line = line.replace(/<!--.*?-->/g, '');
    const open = line.indexOf('<!--');
    if (open !== -1) {
      line = line.slice(0, open);
      inComment = true;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) {
      flush();
      continue;
    }
    let m;
    if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line))) {
      start('heading', no, m[2].replace(/\s+#+\s*$/, ''));
      flush();
    } else if (/^\s*\|/.test(line)) {
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')) {
        flush();
        continue;
      }
      start('table', no, line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join(' | '));
      flush();
    } else if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      start('list', no, m[3]);
    } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      if (cur && cur.kind === 'quote') cur.lines.push({ no, text: m[1] });
      else start('quote', no, m[1]);
    } else if (cur && cur.kind === 'list' && /^\s+/.test(line)) {
      cur.lines.push({ no, text: line.trim() });
    } else if (cur && cur.kind === 'para') {
      cur.lines.push({ no, text: line.trim() });
    } else {
      start('para', no, line.trim());
    }
  }
  flush();

  const sentences = [];
  for (const u of units) {
    const text = u.lines.map((l) => l.text).join('\n');
    const offsets = [];
    let acc = 0;
    for (const l of u.lines) {
      offsets.push({ at: acc, no: l.no });
      acc += l.text.length + 1;
    }
    const lineAt = (off) => {
      let no = offsets[0].no;
      for (const o of offsets) if (o.at <= off) no = o.no;
      return no;
    };
    const parts = u.kind === 'heading' || u.kind === 'table' ? [{ text, start: 0 }] : splitSentences(text);
    for (const p of parts) {
      const lead = p.text.length - p.text.trimStart().length;
      const s = {
        text: p.text.trim(),
        line: lineAt(p.start + lead),
        endLine: lineAt(p.start + p.text.trimEnd().length - 1),
        unitStart: u.startLine,
        kind: u.kind
      };
      if (s.text) sentences.push(s);
    }
  }
  return { front, sentences, directives, lineCount: lines.length };
}

const REFS = String.raw`(?:\s?\[[A-Za-z][\w-]*(?:\s*,\s*[A-Za-z][\w-]*)*\](?!\())*`;

export function splitSentences(text) {
  const re = new RegExp(String.raw`([.!?]+)(["')\u201d\u2019]*)(${REFS})(?=\s|$)`, 'g');
  const out = [];
  let from = 0;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(from, m.index);
    const token = (/(\S+)$/.exec(before) || [, ''])[1].toLowerCase().replace(/\.+$/, '');
    const cleaned = token.replace(/^[("'\[]+/, '');
    if (m[1] === '.' && (ABBREV.has(cleaned) || /^[a-z]$/.test(cleaned))) continue;
    const rest = text.slice(m.index + m[0].length);
    if (/^\s*[a-z]/.test(rest)) continue;
    const endIdx = m.index + m[0].length;
    out.push({ text: text.slice(from, endIdx), start: from });
    from = endIdx;
  }
  if (text.slice(from).trim()) out.push({ text: text.slice(from), start: from });
  return out;
}

// Plain text for analysis: no code spans, link targets or emphasis markers. Evidence refs are
// taken out before this, in extractRefs.
export function toPlain(s) {
  return s
    .replace(/`[^`]*`/g, ' ')
    .replace(/\]\((?:[^)]*)\)/g, ']')
    .replace(/!?\[([^\]]*)\]/g, '$1')
    .replace(/\*{1,3}|(?<!\w)_|_(?!\w)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
