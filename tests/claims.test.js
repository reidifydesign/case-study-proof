import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractClaims, hasWindow, hasBaseline, isRelative, makeLexicon, namesMetric,
  causalMatches, hedged, vagueWords, placeholderIn
} from '../src/claims.js';

const lex = makeLexicon();
const kinds = (t) => extractClaims(t).map((c) => `${c.kind}:${c.raw}`);

test('finds percentages, multipliers, currency, counts and measures', () => {
  assert.deepEqual(kinds('Sessions rose 40%.'), ['percent:40%']);
  assert.deepEqual(kinds('It ran 3x faster.'), ['multiplier:3x']);
  assert.deepEqual(kinds('We saved $40k and 12 new leads came in.'), ['currency:$40k', 'count:12 new leads']);
  assert.deepEqual(kinds('LCP was 1.2s.'), ['measure:1.2s']);
  assert.deepEqual(kinds('Lighthouse scored 98/100.'), ['score:98/100']);
  assert.deepEqual(kinds('It now ranks top 3 for the term.'), ['rank:top 3']);
  assert.deepEqual(kinds('Enquiries doubled.'), ['change-word:doubled']);
  assert.deepEqual(kinds('Budget was Rs 5 lakh.'), ['currency:Rs 5 lakh']);
  assert.deepEqual(kinds('It cut ordering time in half.'), ['change-word:in half']);
});

test('handles ranges, number words and thousands separators', () => {
  const c = extractClaims('Up 30-40% on sessions, about forty percent on leads.');
  assert.equal(c[0].value, 40);
  assert.equal(c[0].low, 30);
  assert.equal(c[1].value, 40);
  assert.equal(extractClaims('A 1,200% rise.')[0].value, 1200);
});

test('does not treat years, versions or plain numbers as claims', () => {
  assert.deepEqual(kinds('In 2026 our leads grew.'), []);
  assert.deepEqual(kinds('Version 2.1 shipped on 3 June with 5 pages.'), []);
  assert.deepEqual(kinds('It was a 6 week project for 4 designers.'), []);
});

test('a range that is really a year before a percentage is not a range', () => {
  const c = extractClaims('from 41% in March 2026 to 52% in June 2026');
  assert.deepEqual(c.map((x) => x.value), [41, 52]);
  assert.equal(c[1].low, undefined);
});

test('windows: dates, quarters, durations and relative periods', () => {
  for (const t of ['in March 2026', 'on 12 Sep 2026', '2026-03-31', 'in Q2 2026', 'over the last 30 days', 'within 6 weeks of launch', 'year on year', 'since March']) {
    assert.ok(hasWindow(t), t);
  }
  for (const t of ['after launch', 'recently', 'over time', 'sessions rose sharply']) assert.ok(!hasWindow(t), t);
});

test('baselines', () => {
  for (const t of ['from 1,200 to 1,680', 'compared with last year', 'versus the old site', 'before the rebuild', 'on the previous quarter']) {
    assert.ok(hasBaseline(t), t);
  }
  assert.ok(!hasBaseline('Sessions rose 40%'));
});

test('a level is not a relative change', () => {
  const t = 'Bounce rate fell to 38%';
  assert.equal(isRelative(t, extractClaims(t)[0]), false);
  const u = 'Bounce rate fell by 38%';
  assert.equal(isRelative(u, extractClaims(u)[0]), true);
  const v = 'A conversion rate of 3.2%';
  assert.equal(isRelative(v, extractClaims(v)[0]), false);
});

test('named metrics use the lexicon and a user list', () => {
  assert.ok(namesMetric('organic sessions rose 40%', lex));
  assert.ok(!namesMetric('overall performance improved 60%', lex));
  assert.ok(namesMetric('gallery saves rose 40%', makeLexicon(['gallery saves'])));
});

test('causal wording counts only when the sentence is about an outcome', () => {
  assert.ok(causalMatches('The new pages drove a 212% increase in sales.', lex).length);
  assert.ok(causalMatches('Thanks to the rebuild, enquiries doubled.', lex).length);
  assert.ok(causalMatches('The redesign reduced bounce rate.', lex).length);
  assert.equal(causalMatches('We chose a serif because the brand is editorial.', lex).length, 0);
  assert.equal(causalMatches('Bounce rate reduced from 60% to 48%.', lex).length, 0);
  assert.equal(causalMatches('It is a data-driven process.', lex).length, 0);
});

test('hedged wording is recognised', () => {
  assert.ok(hedged('Sales rose, which coincided with the launch.'));
  assert.ok(hedged('We did not test whether it caused the rise.'));
  assert.ok(!hedged('It caused the rise.'));
});

test('vague intensifiers, but not "statistically significant"', () => {
  assert.equal(vagueWords('We saw significant growth.'), 'significant');
  assert.equal(vagueWords('The difference was statistically significant.'), null);
  assert.equal(vagueWords('Sessions rose 40%.'), null);
});

test('placeholders', () => {
  assert.equal(placeholderIn('Fill [[CONFIRM: the date]] in'), '[[CONFIRM: the date]]');
  assert.equal(placeholderIn('TODO add quote'), 'TODO');
  assert.equal(placeholderIn('Sessions rose 40%'), null);
});
