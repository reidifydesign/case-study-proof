// Output formatting: text for people, JSON for scripts, and the claims-to-evidence map.
import { RULES } from './check.js';

const useColor = (opts) => opts.color !== false && process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (on, code, s) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);

export function formatText(results, opts = {}) {
  const c = useColor(opts);
  const out = [];
  let errors = 0;
  let warnings = 0;
  let notes = 0;
  let suppressed = 0;
  let claims = 0;
  let verified = 0;
  const explained = new Set();
  const label = (f) => (f.severity === 'error' ? paint(c, 31, 'FAIL') : f.severity === 'warn' ? paint(c, 33, 'WARN') : paint(c, 36, 'INFO'));
  const fixLine = (f) => {
    if (!opts.explain && explained.has(f.rule)) return;
    explained.add(f.rule);
    out.push(`            fix: ${f.fix}`);
  };
  for (const r of results) {
    out.push(paint(c, 1, r.file) + (r.evidenceFile ? paint(c, 2, `  (evidence: ${r.evidenceFile})`) : ''));
    if (!r.findings.length) out.push('  no findings');
    const textFindings = r.findings.filter((f) => f.file === 'text');
    const evFindings = r.findings.filter((f) => f.file !== 'text');
    const lines = [...new Set(textFindings.map((f) => f.line))];
    for (const line of lines) {
      const group = textFindings.filter((f) => f.line === line);
      out.push(`  L${line}  ${paint(c, 2, group[0].excerpt || '')}`.trimEnd());
      for (const f of group) {
        out.push(`    ${label(f)}  ${f.rule}  ${f.message}`);
        fixLine(f);
      }
    }
    if (evFindings.length) {
      out.push(`  evidence file${r.evidenceFile ? `  ${paint(c, 2, r.evidenceFile)}` : ''}`);
      for (const f of evFindings) {
        out.push(`    ${label(f)}  ${f.rule}  ${f.message}`);
        fixLine(f);
      }
    }
    out.push('');
    errors += r.stats.errors;
    warnings += r.stats.warnings;
    notes += r.stats.info || 0;
    suppressed += r.suppressed;
    claims += r.stats.claims;
    verified += r.stats.verified;
  }
  const pass = errors === 0 && !(opts.strict && warnings > 0);
  out.push(
    `${pass ? paint(c, 32, 'PASS') : paint(c, 31, 'FAIL')}  ${errors} errors, ${warnings} warnings` +
      (notes ? `, ${notes} ${notes === 1 ? 'note' : 'notes'}` : '') +
      (suppressed ? `, ${suppressed} suppressed` : '') +
      `. ${verified} of ${claims} figures match their evidence.`
  );
  if (!opts.explain && results.some((r) => r.findings.length)) out.push('Each fix is shown once per rule. Use --explain to repeat it, or "rules" for the full list.');
  return out.join('\n');
}

export function formatJson(results, opts = {}) {
  return JSON.stringify(
    {
      tool: 'case-study-proof',
      strict: !!opts.strict,
      files: results.map((r) => ({
        file: r.file,
        evidenceFile: r.evidenceFile || null,
        stats: r.stats,
        suppressed: r.suppressed,
        findings: r.findings.map(({ unitStart, endLine, ...f }) => f),
        claims: r.claims
      }))
    },
    null,
    2
  );
}

const STATUS = {
  verified: 'matches evidence',
  mismatch: 'DOES NOT MATCH evidence',
  unsourced: 'no evidence reference',
  'unknown-ref': 'reference not in evidence file',
  'inline-source': 'inline link only, not checked',
  derived: 'worked out from the figures above'
};

export function formatMap(r, { markdown = false } = {}) {
  const rows = r.claims.map((c) => [`L${c.line}`, c.claim, c.refs.join(' ') || '-', STATUS[c.status] || c.status]);
  const head = ['Line', 'Figure', 'Evidence', 'Status'];
  const lines = [];
  if (markdown) {
    lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
    for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  } else {
    const w = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
    const fmt = (row) => row.map((x, i) => x.padEnd(w[i])).join('  ').trimEnd();
    lines.push(fmt(head), fmt(w.map((n) => '-'.repeat(n))));
    for (const row of rows) lines.push(fmt(row));
  }
  if (!rows.length) lines.push('(no figures found)');
  const unused = r.evidenceIds.filter((id) => !r.citedIds.includes(id));
  if (unused.length) lines.push('', `Evidence never cited: ${unused.join(', ')}`);
  return lines.join('\n');
}

export function formatRules() {
  const lines = [];
  for (const [id, r] of Object.entries(RULES)) {
    lines.push(`${id}  (${r.severity})`, `  ${r.title}`, `  why: ${r.why}`, `  fix: ${r.fix}`, '');
  }
  return lines.join('\n').trimEnd();
}
