import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDocument, matchClaim, extractRefs, RULES } from '../src/check.js';
import { extractClaims } from '../src/claims.js';
import { validateEvidence, candidates, isoDate } from '../src/evidence.js';

const TODAY = new Date(Date.UTC(2026, 8, 30));
const FRONT = '---\ndate: 2026-09-14\n---\n\n';
const E1 = {
  id: 'E1', metric: 'organic sessions', source: 'exports/s.csv', observed_on: '2026-07-02',
  period: { from: '2026-06-01', to: '2026-06-30' }, baseline_period: { from: '2026-03-01', to: '2026-03-31' },
  before: 1200, after: 1680, design: 'observational'
};
const run = (body, evidence = [E1], extra = {}) => checkDocument(FRONT + body, { evidence, today: TODAY, ...extra });
const rules = (r) => r.findings.map((f) => f.rule);

test('a fully evidenced sentence passes', () => {
  const r = run('Organic sessions went from 1,200 in March 2026 to 1,680 in June 2026, up 40% [E1].\n');
  assert.deepEqual(rules(r), []);
  assert.equal(r.stats.verified, 1);
});

test('unsourced-number: a figure with no reference', () => {
  assert.ok(rules(run('Organic sessions rose 40% in June 2026.\n')).includes('unsourced-number'));
});

test('an inline link counts as a source but is not verified', () => {
  const r = run('Organic sessions rose 40% in June 2026 ([GA4](https://example.test/report)).\n');
  assert.ok(!rules(r).includes('unsourced-number'));
  assert.equal(r.claims[0].status, 'inline-source');
});

test('number-mismatch: text and evidence disagree', () => {
  const r = run('Organic sessions rose 45% from March 2026 to June 2026 [E1].\n');
  assert.ok(rules(r).includes('number-mismatch'));
  assert.match(r.findings.find((f) => f.rule === 'number-mismatch').message, /E1 change 40/);
});

test('number-mismatch tolerates honest rounding only', () => {
  const ok = run('Organic sessions rose 40% from March 2026 to June 2026 [E1].\n');
  assert.ok(!rules(ok).includes('number-mismatch'));
  const off = run('Organic sessions rose 41% from March 2026 to June 2026 [E1].\n');
  assert.ok(rules(off).includes('number-mismatch'));
  const e = { ...E1, before: 100, after: 138.7 };
  assert.ok(!rules(run('Organic sessions rose 39% from March 2026 to June 2026 [E1].\n', [e])).includes('number-mismatch'));
  assert.ok(rules(run('Organic sessions rose 40% from March 2026 to June 2026 [E1].\n', [{ ...e, after: 137.2 }])).includes('number-mismatch'));
});

test('dangling-ref: unknown evidence id', () => {
  const r = run('Organic sessions rose 40% in June 2026 [E9].\n');
  assert.ok(rules(r).includes('dangling-ref'));
  assert.ok(rules(r).includes('unsourced-number'));
});

test('causal-no-evidence and causal-weak-evidence', () => {
  assert.ok(rules(run('The rebuild led to more enquiries.\n')).includes('causal-no-evidence'));
  const weak = run('Thanks to the rebuild, organic sessions rose 40% from March 2026 to June 2026 [E1].\n');
  assert.ok(rules(weak).includes('causal-weak-evidence'));
  assert.ok(!rules(weak).includes('causal-no-evidence'));
});

test('a controlled design satisfies the causal rule', () => {
  const e = { ...E1, design: 'ab-test' };
  const r = run('The new checkout drove organic sessions up 40% from March 2026 to June 2026 [E1].\n', [e]);
  assert.ok(!rules(r).some((x) => x.startsWith('causal')));
});

test('hedged wording and rationale sentences are not causal flags', () => {
  assert.deepEqual(rules(run('Sessions rose in the weeks after launch. We did not test whether the rebuild caused it.\n')).filter((x) => x.startsWith('causal')), []);
  assert.deepEqual(rules(run('We chose a serif because the brand is editorial.\n', [])), []);
});

test('missing-date: no window in the sentence or the evidence', () => {
  assert.ok(rules(run('Organic sessions rose 40% [E1].\n', [{ ...E1, period: undefined }])).includes('missing-date'));
  assert.ok(rules(run('Organic sessions rose 40% from 1,200 [E1].\n')).every((x) => x !== 'missing-date'));
  assert.ok(rules(run('Organic sessions rose 40% after launch.\n')).includes('missing-date'));
});

test('unnamed-metric: error without evidence name, warning with one', () => {
  const a = run('Overall performance improved 60% from March 2026 to June 2026.\n');
  assert.equal(a.findings.find((f) => f.rule === 'unnamed-metric').severity, 'error');
  const b = run('Overall performance improved 40% from March 2026 to June 2026 [E1].\n');
  assert.equal(b.findings.find((f) => f.rule === 'unnamed-metric').severity, 'warn');
});

test('no-baseline: relative change with no starting point', () => {
  assert.ok(rules(run('Organic sessions rose 40% in June 2026 ([GA4](https://x.test)).\n', [{ ...E1, baseline_period: undefined }])).includes('no-baseline'));
  assert.ok(!rules(run('Organic sessions rose 40% in June 2026 [E1].\n')).includes('no-baseline'));
});

test('direction-mismatch', () => {
  const r = run('Organic sessions fell 40% from March 2026 to June 2026 [E1].\n');
  assert.ok(rules(r).includes('direction-mismatch'));
  const ok = run('Load time fell 69% from March 2026 to June 2026 [E2].\n', [{ ...E1, id: 'E2', metric: 'load time', before: 3100, after: 950 }]);
  assert.ok(!rules(ok).includes('direction-mismatch'));
});

test('multiplier and change-word checks use the ratio', () => {
  const e = { ...E1, before: 100, after: 200 };
  const d = run('Organic sessions doubled from March 2026 to June 2026 [E1].\n', [e]);
  assert.ok(!rules(d).includes('number-mismatch'));
  const t = run('Organic sessions tripled from March 2026 to June 2026 [E1].\n', [e]);
  assert.ok(rules(t).includes('number-mismatch'));
  assert.ok(!rules(run('Organic sessions rose 2x from March 2026 to June 2026 [E1].\n', [e])).includes('number-mismatch'));
});

test('time units convert between seconds and milliseconds', () => {
  const e = { ...E1, id: 'E3', metric: 'LCP', before: 3100, after: 1200, unit: 'ms' };
  const r = run('LCP was 3.1s in March 2026 and 1.2s in June 2026 [E3].\n', [e]);
  assert.ok(!rules(r).includes('number-mismatch'), JSON.stringify(r.findings));
});

test('vague-claim only when there is no figure', () => {
  assert.ok(rules(run('We saw significant growth.\n')).includes('vague-claim'));
  assert.ok(!rules(run('The difference was statistically significant.\n')).includes('vague-claim'));
});

test('placeholder-left and undated-document', () => {
  assert.ok(rules(run('[[CONFIRM: the result]]\n')).includes('placeholder-left'));
  const r = checkDocument('Plain text.\n', { evidence: [], today: TODAY });
  assert.ok(rules(r).includes('undated-document'));
});

test('no-evidence-file: warns once and treats references as unverifiable', () => {
  const r = checkDocument(FRONT + 'Sessions rose 40% in June 2026 [E1].\n', { evidence: null, today: TODAY });
  assert.ok(rules(r).includes('no-evidence-file'));
  assert.ok(rules(r).includes('dangling-ref'));
});

test('unused-evidence', () => {
  const r = run('Nothing to see here.\n');
  assert.ok(rules(r).includes('unused-evidence'));
});

test('proof-ignore suppresses with a reason and errors without one', () => {
  const ok = run('<!-- proof-ignore: unsourced-number, missing-date -- client quote, see the signed email -->\nThey said sessions rose 50%.\n');
  assert.ok(!rules(ok).includes('unsourced-number'));
  assert.equal(ok.suppressed >= 1, true);
  const bad = run('<!-- proof-ignore: unsourced-number -->\nThey said sessions rose 50%.\n');
  assert.ok(rules(bad).includes('ignore-without-reason'));
  assert.ok(rules(bad).includes('unsourced-number'));
});

test('config can ignore a rule and add metric words', () => {
  const r = run('Gallery saves rose 40% from March 2026 to June 2026 [E1].\n', [E1], { config: { metrics: ['gallery saves'], ignoreRules: ['unused-evidence'] } });
  assert.ok(!rules(r).includes('unnamed-metric'));
});

test('extractRefs only takes known ids or E-numbers, never markdown links', () => {
  const known = new Map([['survey-1', {}]]);
  const a = extractRefs('Up 40% [E1] and [survey-1] in [a link](https://x.test) and [note].', known);
  assert.deepEqual(a.refs, ['E1', 'survey-1']);
  assert.match(a.stripped, /\[a link\]\(https:\/\/x\.test\) and \[note\]\./);
});

test('every rule has a severity, a reason and a fix', () => {
  for (const [id, r] of Object.entries(RULES)) {
    assert.ok(['error', 'warn'].includes(r.severity), id);
    assert.ok(r.title && r.why && r.fix, id);
    assert.ok(!/—/.test(r.title + r.why + r.fix), `${id} has an em dash`);
  }
});

test('evidence validation: missing fields, bad and future dates, vague sources', () => {
  const p = validateEvidence([
    { id: 'A' },
    { id: 'A', metric: 'm', source: 'internal', observed_on: '2099-01-01', period: { from: '2026-02-01', to: '2026-01-01' }, value: 1 },
    { id: 'C', metric: 'm', source: 'exports/x.csv', observed_on: 'yesterday', value: 1, note: 'TODO' }
  ], { today: TODAY });
  const has = (rule, re) => p.some((x) => x.rule === rule && re.test(x.message));
  assert.ok(has('evidence-incomplete', /no source/));
  assert.ok(has('evidence-incomplete', /used twice/));
  assert.ok(has('vague-source', /internal/));
  assert.ok(has('future-date', /2099/));
  assert.ok(has('evidence-incomplete', /starts after it ends/));
  assert.ok(has('evidence-incomplete', /not a YYYY-MM-DD/));
  assert.ok(p.some((x) => x.rule === 'placeholder-left'));
});

test('candidates derive change, ratio and difference from before and after', () => {
  const c = candidates({ before: 1200, after: 1680 });
  assert.ok(Math.abs(c.pct - 40) < 1e-9);
  assert.ok(Math.abs(c.ratio - 1.4) < 1e-9);
  assert.ok(c.list.some((x) => x.label === 'difference' && x.n === 480));
  assert.equal(isoDate('2026-02-30'), null);
});

test('matchClaim lists what the evidence does hold when it fails', () => {
  const r = matchClaim(extractClaims('up 50%')[0], [E1]);
  assert.equal(r.ok, false);
  assert.ok(r.tried.some((t) => /change 40/.test(t)));
});
