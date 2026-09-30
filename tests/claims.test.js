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

// ---- false positives found in a private trial run (synthetic sentences) ----

test('a number directly after a capitalised proper name is not a figure', () => {
  assert.deepEqual(kinds('Studio 54 sessions ran long.'), []);
  assert.deepEqual(kinds('Route 66 visitors queued outside.'), []);
  assert.deepEqual(kinds('Harbour Bakery served Gate 12 orders first.'), []);
  // controls: ordinary words before a figure still count
  assert.deepEqual(kinds('Over 54 sessions were logged.'), ['count:54 sessions']);
  assert.deepEqual(kinds('Our 12 new customers joined.'), ['count:12 new customers']);
  assert.deepEqual(kinds('Orders 40 leads came in.'), ['count:40 leads']);
  assert.deepEqual(kinds('LCP 1.2s on mobile.'), ['measure:1.2s']);
  assert.deepEqual(kinds('On March 12 orders rose sharply.'), []);
});

test('format and spec durations are not measurements', () => {
  assert.deepEqual(kinds('Clips run up to 30 seconds each, 9:16 vertical at 1080x1920.'), []);
  assert.deepEqual(kinds('Each reel is at most 15 seconds.'), []);
  assert.deepEqual(kinds('Uploads can be 10 seconds long.'), []);
  assert.deepEqual(kinds('Files are capped at 50 MB.'), []);
  // controls: a measured time is still a figure
  assert.deepEqual(kinds('Load time fell to 1.2s.'), ['measure:1.2s']);
  assert.deepEqual(kinds('Pages now load in at most 2 seconds.'), ['measure:2 seconds']);
  assert.deepEqual(kinds('The new flow saves 30 seconds per order.'), ['measure:30 seconds']);
});

test('a year is never a figure, whatever follows it', () => {
  assert.deepEqual(kinds('Score of 2026 was the title.'), []);
  assert.deepEqual(kinds('It ranked 2025 on the list.'), []);
  assert.deepEqual(kinds('That took 2026 seconds.'), []);
  assert.deepEqual(kinds('The 2025/2026 season was busy.'), []);
  // a count written with a thousands separator is a figure
  assert.deepEqual(kinds('Sales were 2,026 orders.'), ['count:2,026 orders']);
});

test('100% ownership and status wording is not a measured percentage', () => {
  assert.deepEqual(kinds('The site is 100% owned by the client.'), []);
  assert.deepEqual(kinds('The code is 100% client-owned.'), []);
  assert.deepEqual(kinds('The files stay 100% yours.'), []);
  // controls
  assert.deepEqual(kinds('Sessions rose 100%.'), ['percent:100%']);
  assert.deepEqual(kinds('100% of sessions came from search.'), ['percent:100%']);
  assert.deepEqual(kinds('It is 99% owned by the client.'), ['percent:99%']);
});

test('vague-claim wording is ignored when it is negated', () => {
  assert.equal(vagueWords('No guaranteed results.'), null);
  assert.equal(vagueWords('We never promise rankings or guaranteed results.'), null);
  assert.equal(vagueWords('We work without guaranteed results.'), null);
  assert.equal(vagueWords('We never promise massive growth.'), null);
  assert.equal(vagueWords('We promise guaranteed results.'), 'guaranteed results');
  assert.equal(vagueWords('We never promise, but we saw massive growth.'), 'massive');
});

test('"-generated" adjectives and verbs with no outcome noun are not causal wording', () => {
  assert.equal(causalMatches('The gallery uses AI-generated photography, and results are steady.', lex).length, 0);
  assert.equal(causalMatches('Auto-generated alt text covers the gallery and sales pages.', lex).length, 0);
  assert.equal(causalMatches('The agency delivered the files on time, and results were steady.', lex).length, 0);
  assert.equal(causalMatches('Generated 38 enquiries.', lex).length, 0);
  // controls: a subject plus an outcome noun is still flagged
  assert.ok(causalMatches('The new pages generated 38 enquiries.', lex).length);
  assert.ok(causalMatches('The redesign generated more enquiries.', lex).length);
  assert.ok(causalMatches('The campaign delivered results.', lex).length);
  assert.ok(causalMatches('The rebuild boosted sales.', lex).length);
});
