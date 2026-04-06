#!/usr/bin/env node
'use strict';

/**
 * ContextWeave Doctor
 *
 * Verifies that ContextWeave is correctly installed and configured.
 * Run from any project directory:
 *
 *   node /path/to/ContextWeave/doctor.js
 *   node ~/.contextweave/doctor.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, execSync } = require('child_process');

// ── Terminal colors ───────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  green:  s => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:    s => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: s => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:   s => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  bold:   s => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  dim:    s => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
};

// ── Result tracking ───────────────────────────────────────────────────────────
let passes = 0, failures = 0, warnings = 0;

function pass(msg, detail) {
  const d = detail ? c.dim('  ' + detail) : '';
  console.log(`  ${c.green('✓')} ${msg}${d}`);
  passes++;
}

function fail(msg, fix) {
  console.log(`  ${c.red('✗')} ${c.bold(msg)}`);
  if (fix) console.log(`    ${c.yellow('→')} ${fix}`);
  failures++;
}

function warn(msg, fix) {
  console.log(`  ${c.yellow('⚠')} ${msg}`);
  if (fix) console.log(`    ${c.yellow('→')} ${fix}`);
  warnings++;
}

function section(title) {
  console.log(`\n${c.bold(c.cyan(title))}`);
}

// Bd emits permission warnings to stderr that are benign — filter them out
// so they don't pollute the doctor output when scripts exit 0.
function filterBenignStderr(stderr) {
  if (!stderr) return '';
  return stderr
    .split('\n')
    .filter(line => !/Warning:.*has permissions \d+ \(recommended:/.test(line) && line.trim() !== '')
    .join('\n');
}

// ── Shell helpers ─────────────────────────────────────────────────────────────
function which(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'pipe' }); return true; } catch { return false; }
}

function runScript(scriptPath, input, timeoutMs = 20000) {
  return spawnSync('node', [scriptPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env },
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────
const INSTALL_DIR = path.join(os.homedir(), '.contextweave');
const SETTINGS    = path.join(os.homedir(), '.claude', 'settings.json');
const CWD         = process.cwd();

const REQUIRED_SCRIPTS = [
  '1-context-start.js',
  '2-context-before-agent.js',
  '3-context-precompress.js',
  '5-context-end.js',
  '6-context-after-agent.js',
  '7-context-after-tool.js',
  'payload.js',
  'output.js',
  'trace-utils.js',
];

const STALE_FILES = [
  'mappers/gemini.js',
  '8-context-after-model.js',
];

// Mock payloads matching Claude Code's actual hook input shapes
const SESSION_ID = 'contextweave-doctor';
const TRANSCRIPT = '/tmp/contextweave-doctor.jsonl';

const MOCK = {
  SessionStart:     { session_id: SESSION_ID, transcript_path: TRANSCRIPT, cwd: CWD, hook_event_name: 'SessionStart',     source: 'startup' },
  UserPromptSubmit: { session_id: SESSION_ID, transcript_path: TRANSCRIPT, cwd: CWD, hook_event_name: 'UserPromptSubmit', prompt: 'contextweave doctor test' },
  PreToolUse:       { session_id: SESSION_ID, transcript_path: TRANSCRIPT, cwd: CWD, hook_event_name: 'PreToolUse',       tool_name: 'Bash', tool_input: { command: 'echo test' }, tool_use_id: 'doctor-tool-id' },
  PreCompact:       { session_id: SESSION_ID, transcript_path: TRANSCRIPT, cwd: CWD, hook_event_name: 'PreCompact',       trigger: 'manual', custom_instructions: null },
  Stop:             { session_id: SESSION_ID, transcript_path: TRANSCRIPT, cwd: CWD, hook_event_name: 'Stop',             stop_hook_active: false },
};

// =============================================================================
// SECTION 1 — Prerequisites
// =============================================================================
section('1. Prerequisites');

// Node.js version
parseInt(process.version.slice(1)) >= 18
  ? pass(`Node.js ${process.version}`)
  : fail(`Node.js ${process.version} is too old (need ≥ 18)`, 'Install Node.js 18+ from https://nodejs.org');

// bd CLI
const bdOnPath = which('bd');
if (bdOnPath) {
  const r = spawnSync('bd', ['list', '--limit', '0', '--quiet'], { encoding: 'utf8', timeout: 8000 });
  r.status === 0
    ? pass('bd CLI on PATH and responsive')
    : fail('bd CLI on PATH but returned error', `bd list exited ${r.status}: ${(r.stderr || '').trim().slice(0, 120)}`);
} else {
  fail('bd not found on PATH', 'Install Beads: https://github.com/gastownhall/beads');
}

// =============================================================================
// SECTION 2 — Install directory
// =============================================================================
section(`2. Install Directory  (${INSTALL_DIR})`);

const installExists = fs.existsSync(INSTALL_DIR);

if (!installExists) {
  fail(`${INSTALL_DIR} not found`, 'Run: node install.js');
} else {
  pass(`${INSTALL_DIR} exists`);

  for (const script of REQUIRED_SCRIPTS) {
    const p = path.join(INSTALL_DIR, script);
    fs.existsSync(p) ? pass(script) : fail(`${script} missing`, 'Run: node install.js');
  }

  const claudeMapper = path.join(INSTALL_DIR, 'mappers', 'claude.js');
  fs.existsSync(claudeMapper) ? pass('mappers/claude.js') : fail('mappers/claude.js missing', 'Run: node install.js');

  for (const stale of STALE_FILES) {
    if (fs.existsSync(path.join(INSTALL_DIR, stale))) {
      warn(`${stale} is a stale file from a previous version`, 'Run: node install.js to remove it');
    }
  }

  fs.existsSync(path.join(INSTALL_DIR, 'node_modules'))
    ? pass('npm dependencies installed')
    : fail('node_modules missing', `Run: cd ${INSTALL_DIR} && npm install`);
}

which('search-beads')
  ? pass('search-beads on PATH')
  : warn('search-beads not on PATH (optional)', `Run: cd ${INSTALL_DIR} && npm link`);

// =============================================================================
// SECTION 3 — Hook configuration
// =============================================================================
section(`3. Hook Configuration  (~/.claude/settings.json)`);

let hooks = null;

if (!fs.existsSync(SETTINGS)) {
  fail('~/.claude/settings.json not found', 'Create it and add the hooks block from setup-claude.md');
} else {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    pass('settings.json is valid JSON');
  } catch (e) {
    fail(`settings.json parse error: ${e.message}`, 'Fix the JSON syntax');
  }

  if (settings) {
    hooks = settings.hooks || {};

    function checkHookEvent(event, opts = {}) {
      const { requireMatcher, requireAsync } = opts;
      const matchers = hooks[event];

      if (!matchers || matchers.length === 0) {
        fail(`${event}: hook missing`, 'Add it from setup-claude.md');
        return;
      }

      const firstMatcher = matchers[0];
      const cmds = firstMatcher.hooks || [];

      if (cmds.length === 0) {
        fail(`${event}: matcher has no hook commands`, 'Check setup-claude.md');
        return;
      }

      const issues = [];

      if (requireMatcher !== undefined && firstMatcher.matcher !== requireMatcher) {
        issues.push(`matcher is ${JSON.stringify(firstMatcher.matcher)}, expected ${JSON.stringify(requireMatcher)}`);
      }

      for (const cmd of cmds) {
        if (requireAsync && cmd.async !== true) {
          issues.push('missing "async": true (blocks Claude on every tool call)');
        }
        if (cmd.command) {
          const parts = cmd.command.trim().split(/\s+/);
          const scriptPath = parts[parts.length - 1];
          if (!fs.existsSync(scriptPath)) {
            issues.push(`script not found: ${scriptPath}`);
          }
        }
      }

      if (issues.length > 0) {
        fail(`${event}: ${issues[0]}`, issues.length > 1 ? `(+${issues.length - 1} more) — see setup-claude.md` : 'Fix in settings.json');
        for (const issue of issues.slice(1)) {
          fail(`${event}: ${issue}`, 'Fix in settings.json');
        }
      } else {
        const notes = [
          requireMatcher !== undefined ? `matcher=${JSON.stringify(requireMatcher)}` : '',
          requireAsync ? 'async' : '',
        ].filter(Boolean).join(', ');
        pass(`${event}`, notes || undefined);
      }
    }

    checkHookEvent('SessionStart',       { requireMatcher: '' });
    checkHookEvent('UserPromptSubmit',   { requireMatcher: '*' });
    checkHookEvent('PreToolUse',         { requireAsync: true });
    checkHookEvent('PostToolUse',        { requireAsync: true });
    checkHookEvent('PostToolUseFailure', { requireAsync: true });
    checkHookEvent('PreCompact');
    checkHookEvent('Stop',               { requireAsync: true });
    checkHookEvent('SessionEnd',         { requireAsync: true });
  }
}

// =============================================================================
// SECTION 4 — Beads workspace (current directory)
// =============================================================================
section(`4. Beads Workspace  (${CWD})`);

const beadsDir = path.join(CWD, '.beads');
const hasBeads = fs.existsSync(beadsDir);

if (hasBeads) {
  pass('.beads/ directory found');

  const gitignorePath = path.join(CWD, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const lines = fs.readFileSync(gitignorePath, 'utf8').split('\n').map(l => l.trim());
    lines.some(l => l === '.beads' || l === '.beads/')
      ? pass('.beads/ in .gitignore')
      : warn('.beads/ not in .gitignore — may be committed accidentally', 'Run: echo ".beads/" >> .gitignore');
  } else {
    warn('No .gitignore found', 'Create one and add .beads/');
  }

  if (bdOnPath) {
    const r = spawnSync('bd', ['list', '--limit', '1', '--quiet'], { encoding: 'utf8', timeout: 8000, cwd: CWD });
    r.status === 0
      ? pass('bd list works in this project')
      : fail('bd list failed in this project', (r.stderr || '').trim().slice(0, 120) || 'Run `bd list` to diagnose');
  }
} else {
  warn('.beads/ not found — Beads tracing disabled for this directory', `Run: BEADS_DIR="$(pwd)/.beads" bd init --quiet --stealth  &&  echo ".beads/" >> .gitignore`);
}

// =============================================================================
// SECTION 5 — Hook script dry-runs
// =============================================================================
section('5. Hook Script Dry-Runs  (mock Claude payloads → check exit 0)');

const SCRIPT_TESTS = [
  { script: '1-context-start.js',       event: 'SessionStart',     note: 'injects session context',            timeout: 20000 },
  { script: '2-context-before-agent.js',event: 'UserPromptSubmit', note: 'injects per-prompt reminder',        timeout: 15000 },
  { script: '3-context-precompress.js', event: 'PreCompact',       note: 'writes rehydrate marker + guidance', timeout: 10000 },
  { script: '7-context-after-tool.js',  event: 'PreToolUse',       note: 'logs tool calls (trace)',            timeout: 10000 },
  { script: '6-context-after-agent.js', event: 'Stop',             note: 'logs final response (trace)',        timeout: 10000 },
];

if (!installExists) {
  warn('Skipping dry-runs — install directory not found');
} else {
  for (const { script, event, note, timeout } of SCRIPT_TESTS) {
    const scriptPath = path.join(INSTALL_DIR, script);

    if (!fs.existsSync(scriptPath)) {
      fail(`${script}: not found`, 'Run: node install.js');
      continue;
    }

    const result = runScript(scriptPath, MOCK[event], timeout);

    if (result.error) {
      const isTimeout = result.error.code === 'ETIMEDOUT';
      const hint = isTimeout
        ? `timed out after ${timeout / 1000}s — bd prime may be slow on first run; retry`
        : result.error.message;
      fail(`${script}: ${hint}`, isTimeout ? 'Re-run doctor.js; if it persists, check `bd prime --full` manually' : undefined);
      continue;
    }

    if (result.status !== 0) {
      const stderr = filterBenignStderr(result.stderr || '').trim();
      fail(`${script}: exited ${result.status}`, stderr.slice(0, 150) || 'Check script for syntax errors');
      continue;
    }

    // Exit 0 — script worked. Show stdout preview (benign stderr is ignored).
    const stdout = (result.stdout || '').trim();
    const preview = stdout.length > 60 ? stdout.slice(0, 60) + '…' : (stdout || '(empty — bd unavailable in test env)');
    pass(`${script}`, `${note} → "${preview}"`);
  }
}

// =============================================================================
// Summary
// =============================================================================
console.log(`\n${'─'.repeat(60)}`);

const status = failures === 0 && warnings === 0
  ? c.green(c.bold('All good'))
  : failures === 0
  ? c.yellow(c.bold('Warnings only'))
  : c.red(c.bold('Issues found'));

console.log(`${status}  —  ${c.green(passes + ' passed')}, ${c.red(failures + ' failed')}, ${c.yellow(warnings + ' warnings')}\n`);

if (failures > 0) {
  console.log(c.yellow('Fix the failures above, then re-run: node doctor.js\n'));
  process.exit(1);
}
