import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'case-study-proof.js');
const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT });
const BEFORE = path.join('examples', 'before', 'case-study.md');
const AFTER = path.join('examples', 'after', 'case-study.md');

test('the clean example passes with exit 0', () => {
  const r = cli('check', AFTER, '--today', '2026-09-30');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
  assert.match(r.stdout, /6 of 6 figures match/);
});

test('the flawed example fails with exit 1 and names each rule it breaks', () => {
  const r = cli('check', BEFORE, '--today', '2026-09-30', '--no-color');
  assert.equal(r.status, 1);
  for (const rule of ['unsourced-number', 'causal-no-evidence', 'missing-date', 'no-baseline', 'unnamed-metric', 'number-mismatch', 'dangling-ref', 'direction-mismatch', 'vague-claim', 'placeholder-left', 'undated-document', 'vague-source', 'unused-evidence']) {
    assert.ok(r.stdout.includes(rule), `${rule} missing from output`);
  }
  assert.match(r.stdout, /fix: /);
});

test('check is the default command when given a file', () => {
  const r = cli(AFTER, '--today', '2026-09-30');
  assert.equal(r.status, 0);
});

test('--strict fails on warnings only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-'));
  fs.writeFileSync(path.join(dir, 'c.md'), '---\ndate: 2026-09-14\n---\n\nWe saw significant growth.\n');
  fs.writeFileSync(path.join(dir, 'evidence.json'), '[]');
  assert.equal(cli('check', path.join(dir, 'c.md'), '--today', '2026-09-30').status, 0);
  assert.equal(cli('check', path.join(dir, 'c.md'), '--today', '2026-09-30', '--strict').status, 1);
});

test('--json is valid and carries findings, claims and stats', () => {
  const r = cli('check', BEFORE, '--json', '--today', '2026-09-30');
  const j = JSON.parse(r.stdout);
  assert.equal(j.tool, 'case-study-proof');
  assert.ok(j.files[0].findings.length > 10);
  assert.ok(j.files[0].findings.every((f) => f.rule && f.severity && f.message && f.fix));
  assert.ok(j.files[0].claims.some((c) => c.status === 'mismatch'));
});

test('map prints a claims-to-evidence table, and markdown with --markdown', () => {
  const t = cli('map', AFTER);
  assert.equal(t.status, 0);
  assert.match(t.stdout, /matches evidence/);
  const m = cli('map', AFTER, '--markdown');
  assert.match(m.stdout, /^\| Line \| Figure \| Evidence \| Status \|/);
});

test('rules lists every rule', () => {
  const r = cli('rules');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /causal-no-evidence/);
  assert.match(r.stdout, /why: /);
});

test('init writes the skeleton, which then fails on its own placeholders, and never overwrites', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csp-')), 'cs');
  const a = cli('init', dir, '--today', '2026-09-30');
  assert.equal(a.status, 0, a.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'case-study.md')));
  assert.ok(fs.existsSync(path.join(dir, 'evidence.json')));
  const chk = cli('check', path.join(dir, 'case-study.md'), '--today', '2026-09-30');
  assert.equal(chk.status, 1);
  assert.match(chk.stdout, /placeholder-left/);
  const again = cli('init', dir);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /not overwriting/);
});

test('usage errors exit 2', () => {
  assert.equal(cli('check').status, 2);
  assert.equal(cli('check', 'nope.md').status, 2);
  assert.equal(cli('--bogus').status, 2);
  assert.equal(cli('check', AFTER, '--evidence', 'missing.json').status, 2);
  assert.equal(cli('check', AFTER, '--today', 'soon').status, 2);
});

test('--version and --help', () => {
  assert.match(cli('--version').stdout, /^\d+\.\d+\.\d+/);
  assert.match(cli('--help').stdout, /Usage/);
});

test('a missing evidence file is a warning, not a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-'));
  fs.writeFileSync(path.join(dir, 'c.md'), '---\ndate: 2026-09-14\n---\n\nPlain words only.\n');
  const r = cli('check', path.join(dir, 'c.md'), '--today', '2026-09-30');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no-evidence-file/);
});

test('--sentences-only drops undated-document and no-evidence-file but keeps sentence findings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-'));
  fs.writeFileSync(path.join(dir, 'c.md'), 'We saw significant growth, and orders rose 40% in June 2026.\n');
  const full = JSON.parse(cli('check', path.join(dir, 'c.md'), '--json', '--today', '2026-09-30').stdout);
  const fullRules = full.files[0].findings.map((f) => f.rule);
  assert.ok(fullRules.includes('undated-document'));
  assert.ok(fullRules.includes('no-evidence-file'));
  const only = JSON.parse(cli('check', path.join(dir, 'c.md'), '--json', '--sentences-only', '--today', '2026-09-30').stdout);
  const onlyRules = only.files[0].findings.map((f) => f.rule);
  assert.ok(!onlyRules.includes('undated-document'));
  assert.ok(!onlyRules.includes('no-evidence-file'));
  assert.ok(onlyRules.includes('unsourced-number'));
});

test('info-level findings are shown as notes and never fail a run, even with --strict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-'));
  fs.writeFileSync(path.join(dir, 'c.md'), '---\ndate: 2026-09-14\n---\n\nThe rebuild played a part in the rise.\n');
  fs.writeFileSync(path.join(dir, 'evidence.json'), '[]');
  const r = cli('check', path.join(dir, 'c.md'), '--today', '2026-09-30', '--strict', '--no-color');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /INFO\s+attribution-wording/);
  assert.match(r.stdout, /PASS\s+0 errors, 0 warnings, 1 note\./);
  const j = JSON.parse(cli('check', path.join(dir, 'c.md'), '--json', '--today', '2026-09-30').stdout);
  assert.equal(j.files[0].stats.info, 1);
});

test('rules lists the info level rule and the new warnings', () => {
  const r = cli('rules');
  assert.match(r.stdout, /attribution-wording {2}\(info\)/);
  assert.match(r.stdout, /outcome-claim-no-measure {2}\(warn\)/);
  assert.match(r.stdout, /verification-no-method {2}\(warn\)/);
});
