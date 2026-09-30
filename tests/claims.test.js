import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractClaims, hasWindow, hasBaseline, isRelative, makeLexicon, namesMetric,
  causalMatches, hedged, vagueWords, placeholderIn, outcomePhrase, attributionWording, verificationClaim, toolNamed
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

// ---- figures the checker used to miss (synthetic sentences) ----

test('score forms such as 105/105 and 48/50 are figures', () => {
  assert.deepEqual(kinds('105/105, automated checks passing at launch.'), ['score:105/105']);
  assert.deepEqual(kinds('48/50 checks passing.'), ['score:48/50']);
  assert.deepEqual(kinds('Customers rated it 9/10.'), ['score:9/10']);
  assert.equal(extractClaims('48/50 checks passing.')[0].value, 48);
  // controls: dates, fractions, hours and fiscal years are not scores
  assert.deepEqual(kinds('Dated 12/09/2026.'), []);
  assert.deepEqual(kinds('Open 24/7 and closed for 1/2 a day.'), []);
  assert.deepEqual(kinds('Fiscal 2025/26 was busy.'), []);
  assert.deepEqual(kinds('Use and/or as needed.'), []);
});

test('N+ counts are figures', () => {
  assert.deepEqual(kinds('128+ students signed up.'), ['count:128+ students']);
  assert.deepEqual(kinds('300+ orders shipped.'), ['count:300+ orders']);
  assert.deepEqual(kinds('1,000+ followers joined.'), ['count:1,000+ followers']);
  assert.deepEqual(kinds('More than 300+ of our buyers returned.'), ['count:300+']);
  const c = extractClaims('128+ students signed up.')[0];
  assert.equal(c.value, 128);
  assert.equal(c.plus, true);
  // controls: durations, years and names are not counts
  assert.deepEqual(kinds('5+ years of practice.'), []);
  assert.deepEqual(kinds('2026+ orders were planned.'), []);
  assert.deepEqual(kinds('Studio 54+ fans queued.'), []);
});

test('from A to B pairs are figures, including small integers and words in between', () => {
  assert.deepEqual(kinds('Orders went from 17 to 41.'), ['pair:from 17 to 41']);
  assert.deepEqual(kinds('Visits rose from 18 the week before to 187 in the first week.'), ['pair:from 18 the week before to 187']);
  const p = extractClaims('Visits rose from 18 the week before to 187 in the first week.')[0];
  assert.deepEqual([p.from, p.to], [18, 187]);
  const k = extractClaims('Visits rose from 1.2k to 1.8k.')[0];
  assert.deepEqual([k.from, k.to], [1200, 1800]);
  const m = extractClaims('Orders rose from 2 million to 3 million.')[0];
  assert.deepEqual([m.from, m.to], [2e6, 3e6]);
  // counts after the pair are part of it, not a second figure
  assert.deepEqual(kinds('Sessions grew from 1,200 to 1,680 sessions.'), ['pair:from 1,200 to 1,680']);
  // percentages and currency keep their own kinds
  assert.deepEqual(kinds('Rate rose from 41% in March 2026 to 52% in June 2026.'), ['percent:41%', 'percent:52%']);
  assert.deepEqual(kinds('Spend rose from $40k to $55k.'), ['currency:$40k', 'currency:$55k']);
});

test('pairs are split at ", <noun phrase> from" so a second pair is not mixed into the first', () => {
  const two = extractClaims('Visits rose from 18 to 187, search clicks from 4 to 9.');
  assert.deepEqual(two.map((c) => [c.from, c.to]), [[18, 187], [4, 9]]);
  const three = extractClaims('Visits rose from 18 to 187 and search clicks from 4 to 9, enquiries from 2 to 6.');
  assert.deepEqual(three.map((c) => [c.from, c.to]), [[18, 187], [4, 9], [2, 6]]);
  // a first pair that has no "to" must not borrow the second pair's
  const one = extractClaims('Visits rose from 18 the week before, search clicks from 4 to 9.');
  assert.deepEqual(one.map((c) => [c.from, c.to]), [[4, 9]]);
});

test('from/to pairs that are not measurements are left alone', () => {
  assert.deepEqual(kinds('Sessions rose from 2025 to 2026.'), []);
  assert.deepEqual(kinds('The project took from 3 to 5 weeks.'), []);
  assert.deepEqual(kinds('The studio is open from 9 to 5.'), []);
  assert.deepEqual(kinds('Shifts run from 9am to 5pm.'), []);
  assert.deepEqual(kinds('It runs from 12 March to 14 March.'), []);
  assert.deepEqual(kinds('Prices vary from 10 to 20 per cent.'), ['percent:10 to 20 per cent']);
  assert.deepEqual(kinds('Load time fell from 3.2s to 1.1s.'), ['measure:3.2s', 'measure:1.1s']);
});

// ---- outcome promises, attribution wording and unexplained verification (synthetic sentences) ----

test('outcome promises with no measure are found', () => {
  for (const t of [
    'The page turns interest into enquiries.',
    'Our pages turn visitors into customers.',
    'Every build is built to convert.',
    'A site designed to convert visitors.',
    'The menu is built to sell.',
    'It makes booking effortless.',
    'Good content builds authority.',
    'The shop earns trust.',
    'Pages that convert browsers to buyers.'
  ]) {
    assert.ok(outcomePhrase(t), t);
  }
});

test('outcome promises: ordinary uses of the same words are left alone', () => {
  for (const t of [
    'The bench is built to last.',
    'Turn the page into a PDF.',
    'It makes a wooden table.',
    'We built a trust-score dashboard.',
    'The tool can convert the file to PDF.',
    'We do not turn interest into enquiries for free.',
    'The brief asked for trust and authority.'
  ]) {
    assert.equal(outcomePhrase(t), null, t);
  }
});

test('attribution wording is found', () => {
  for (const t of [
    'The rebuild played a part in the rise.',
    'It played a big role in launch week.',
    'It was one of several factors.',
    'Sessions rose rather than anything the rebuild did.',
    'It was partly because of the ad spend.'
  ]) {
    assert.ok(attributionWording(t), t);
  }
  for (const t of ['We played a game at the launch.', 'The rebuild was a part of the plan.', 'One of the owners visited.']) {
    assert.equal(attributionWording(t), null, t);
  }
});

test('verification claims and named tools', () => {
  for (const t of ['Verified clean.', 'Zero offenses.', 'Zero offences found.', 'It passed all checks.', 'All 12 checks passed.', 'The site is fully tested.', 'It passed all 12 checks.']) {
    assert.ok(verificationClaim(t), t);
  }
  for (const t of ['We tested the form.', 'No offenders were listed.', 'It was not fully tested.']) {
    assert.equal(verificationClaim(t), null, t);
  }
  for (const t of ['Verified clean with axe-core.', 'Checked using Playwright.', 'Verified by Siteimprove.', 'Passed the WCAG 2.2 AA checks.']) {
    assert.ok(toolNamed(t), t);
  }
  for (const t of ['Verified clean.', 'Checked by the client.', 'Passed all checks by Friday.']) {
    assert.ok(!toolNamed(t), t);
  }
});
