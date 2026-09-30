import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, splitSentences, toPlain } from '../src/parse.js';

test('reads front matter and skips it from the body', () => {
  const d = parseDocument('---\ntitle: A\ndate: 2026-01-02\nevidence: e.json\n---\n\nHello there.\n');
  assert.equal(d.front.title, 'A');
  assert.equal(d.front.date, '2026-01-02');
  assert.equal(d.front.evidence, 'e.json');
  assert.equal(d.sentences.length, 1);
  assert.equal(d.sentences[0].line, 7);
});

test('does not split on decimals or abbreviations', () => {
  const s = splitSentences('LCP fell to 1.2s vs. 3.1s before. We kept going, e.g. on mobile. Done.');
  assert.deepEqual(s.map((x) => x.text.trim()), ['LCP fell to 1.2s vs. 3.1s before.', 'We kept going, e.g. on mobile.', 'Done.']);
});

test('keeps an evidence ref that follows the full stop with the sentence before it', () => {
  const s = splitSentences('Sessions grew 40%. [E1] Bounce rate fell. [E2, E3] Next.');
  assert.equal(s.length, 3);
  assert.match(s[0].text, /\[E1\]$/);
  assert.match(s[1].text, /\[E2, E3\]$/);
});

test('skips code fences, html comments and images', () => {
  const d = parseDocument('Real 40% sentence.\n\n```\nfake 99% in code\n```\n\n<!-- hidden 77% note -->\n\n![alt 55%](x.png)\n\n<!--\nmulti\nline 12%\n-->\n\nLast one.\n');
  const all = d.sentences.map((s) => s.text).join(' | ');
  assert.match(all, /Real 40%/);
  assert.match(all, /Last one/);
  assert.doesNotMatch(all, /99%|77%|55%|12%/);
});

test('treats each list item and table row as its own unit, with line numbers', () => {
  const d = parseDocument('- first 10 leads\n- second one\n\n| Metric | After |\n| --- | --- |\n| Sessions | 1,680 |\n');
  const lines = d.sentences.map((s) => [s.kind, s.line]);
  assert.deepEqual(lines, [['list', 1], ['list', 2], ['table', 4], ['table', 6]]);
});

test('records proof-ignore directives with their reasons and targets', () => {
  const d = parseDocument('<!-- proof-ignore: unsourced-number -- client quote -->\nThey said 50%.\n\nInline 60%. <!-- proof-ignore: missing-date, unsourced-number -- a note -->\n');
  assert.equal(d.directives.length, 2);
  assert.equal(d.directives[0].standalone, true);
  assert.equal(d.directives[0].target, 2);
  assert.equal(d.directives[0].reason, 'client quote');
  assert.deepEqual(d.directives[1].rules, ['missing-date', 'unsourced-number']);
  assert.equal(d.directives[1].standalone, false);
});

test('toPlain drops code spans, link targets and emphasis markers', () => {
  assert.equal(toPlain('Sessions **rose** 40% in `2026` ([GA4](https://x.test/a_b)).'), 'Sessions rose 40% in (GA4).');
});
