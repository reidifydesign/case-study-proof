import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocument } from './check.js';
import { loadEvidenceFile, isoDate } from './evidence.js';
import { parseFrontMatter } from './parse.js';
import { formatText, formatJson, formatMap, formatRules } from './report.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const HELP = `case-study-proof ${VERSION}
Lints a case study (Markdown) for unsourced numbers, causal wording without evidence,
missing dates and unnamed metrics, against an evidence file.

Usage
  case-study-proof check <case-study.md> [more.md] [options]
  case-study-proof map <case-study.md> [--markdown] [--evidence file.json]
  case-study-proof init [dir]          write a claims-to-evidence skeleton
  case-study-proof rules               list every rule with why and how to fix

Options
  --evidence <file>   evidence JSON (default: front matter "evidence:", then
                      <name>.evidence.json, then evidence.json beside the case study)
  --strict            warnings also fail the run
  --sentences-only    read the sentences only: no undated-document or no-evidence-file warning
  --json              machine-readable output
  --explain           repeat the fix under every finding (default: once per rule)
  --today YYYY-MM-DD  treat this as today (for repeatable runs)
  --no-color          no colour
  -v, --version       print the version
  -h, --help          this text

Exit codes: 0 clean, 1 findings at error level (or warnings with --strict), 2 usage error.
`;

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--evidence' || a === '--today') {
      o[a.slice(2)] = argv[++i];
      if (o[a.slice(2)] === undefined) throw new Error(`${a} needs a value`);
    } else if (a === '--strict' || a === '--json' || a === '--markdown' || a === '--explain') o[a.slice(2)] = true;
    else if (a === '--sentences-only') o.sentencesOnly = true;
    else if (a === '--no-color') o.color = false;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a.startsWith('-') && a !== '-') throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

function findEvidence(file, front, explicit) {
  if (explicit) return path.resolve(explicit);
  const dir = path.dirname(path.resolve(file));
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const tries = [
    front.evidence && path.resolve(dir, front.evidence),
    path.join(dir, `${base}.evidence.json`),
    path.join(dir, 'evidence.json')
  ].filter(Boolean);
  return tries.find((t) => fs.existsSync(t)) || null;
}

function loadConfig(file) {
  const tries = [
    path.join(path.dirname(path.resolve(file)), 'case-study-proof.config.json'),
    path.resolve('case-study-proof.config.json')
  ];
  for (const t of tries) {
    if (fs.existsSync(t)) {
      try {
        return JSON.parse(fs.readFileSync(t, 'utf8'));
      } catch (e) {
        throw new Error(`cannot read ${t}: ${e.message}`);
      }
    }
  }
  return {};
}

function todayFrom(opts) {
  if (opts.today) {
    const d = isoDate(opts.today);
    if (!d) throw new Error('--today must be YYYY-MM-DD');
    return d;
  }
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

function runOne(file, opts) {
  const text = fs.readFileSync(file, 'utf8');
  const { front } = parseFrontMatter(text.replace(/\r\n?/g, '\n').split('\n'));
  const evFile = findEvidence(file, front, opts.evidence);
  if (opts.evidence && !fs.existsSync(evFile)) throw new Error(`evidence file not found: ${opts.evidence}`);
  const evidence = evFile ? loadEvidenceFile(evFile) : null;
  const res = checkDocument(text, { evidence, evidenceFile: evFile, today: todayFrom(opts), config: loadConfig(file), sentencesOnly: !!opts.sentencesOnly });
  return { file, evidenceFile: evFile ? (path.relative(process.cwd(), evFile) || evFile).split(path.sep).join('/') : null, ...res };
}

function init(dir, opts) {
  const shown = dir || 'case-study';
  const target = path.resolve(shown);
  const date = todayFrom(opts).toISOString().slice(0, 10);
  const names = ['case-study.md', 'evidence.json'];
  for (const name of names) {
    if (fs.existsSync(path.join(target, name))) throw new Error(`${path.join(target, name)} already exists, not overwriting`);
  }
  fs.mkdirSync(target, { recursive: true });
  for (const name of names) {
    const text = fs.readFileSync(path.join(ROOT, 'templates', name), 'utf8').replace('{{DATE}}', date);
    fs.writeFileSync(path.join(target, name), text);
  }
  return [
    `wrote ${path.join(shown, 'case-study.md')}`,
    `wrote ${path.join(shown, 'evidence.json')}`,
    `next: fill the [[CONFIRM: ...]] slots, then run: case-study-proof check ${path.join(shown, 'case-study.md')}`
  ].join('\n');
}

export function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`case-study-proof: ${e.message}\n`);
    console.error(HELP);
    return 2;
  }
  if (opts.version) {
    console.log(VERSION);
    return 0;
  }
  let [cmd, ...rest] = opts._;
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (!cmd) {
    console.error(HELP);
    return 2;
  }
  if (!['check', 'map', 'init', 'rules'].includes(cmd)) {
    rest = opts._;
    cmd = 'check';
  }
  try {
    if (cmd === 'rules') {
      console.log(formatRules());
      return 0;
    }
    if (cmd === 'init') {
      console.log(init(rest[0], opts));
      return 0;
    }
    if (!rest.length) throw new Error(`${cmd} needs a Markdown file`);
    for (const f of rest) if (!fs.existsSync(f)) throw new Error(`file not found: ${f}`);
    const results = rest.map((f) => runOne(f, opts));
    if (cmd === 'map') {
      for (const r of results) console.log(formatMap(r, { markdown: opts.markdown }));
      return 0;
    }
    console.log(opts.json ? formatJson(results, opts) : formatText(results, opts));
    const fail = results.some((r) => r.stats.errors > 0 || (opts.strict && r.stats.warnings > 0));
    return fail ? 1 : 0;
  } catch (e) {
    console.error(`case-study-proof: ${e.message}`);
    return 2;
  }
}
