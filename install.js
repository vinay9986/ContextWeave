#!/usr/bin/env node
'use strict';

/**
 * ContextWeave installer.
 *
 * Copies all hook scripts and dependencies to ~/.contextweave, links
 * search-beads onto PATH via `npm link`, and downloads the ONNX embedding
 * model (~90 MB) to ~/.cache/contextweave-onnx.
 *
 * After this script completes the repo can be deleted.
 *
 * Usage:
 *   node install.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const INSTALL_DIR = path.join(os.homedir(), '.contextweave');

// Files and directories to copy from the repo root into INSTALL_DIR
const FILES = [
  '1-context-start.js',
  '2-context-before-agent.js',
  '3-context-precompress.js',
  '4-context-postcompress.js',
  '5-context-end.js',
  '6-context-after-agent.js',
  '7-context-after-tool.js',
  'payload.js',
  'output.js',
  'trace-utils.js',
  'doctor.js',
  'setup-onnx.js',
  'package.json',
];

const DIRS = [
  'mappers',
  'bin',
];

function run(cmd, cwd) {
  execSync(cmd, { cwd: cwd || INSTALL_DIR, stdio: 'inherit' });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  const repoRoot = __dirname;

  console.log(`\nContextWeave installer`);
  console.log(`Install directory: ${INSTALL_DIR}\n`);

  // ── 1. Create install directory ────────────────────────────────────────────
  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  // ── 1b. Remove stale files from previous versions ─────────────────────────
  const STALE_FILES = [
    '8-context-after-model.js',
    'mappers/gemini.js',
  ];
  for (const stale of STALE_FILES) {
    const p = path.join(INSTALL_DIR, stale);
    if (fs.existsSync(p)) {
      fs.rmSync(p);
      console.log(`  removed stale: ${stale}`);
    }
  }

  // ── 2. Copy hook scripts and support files ─────────────────────────────────
  console.log('Copying hook scripts...');
  for (const file of FILES) {
    const src = path.join(repoRoot, file);
    const dest = path.join(INSTALL_DIR, file);
    if (!fs.existsSync(src)) {
      console.warn(`  Warning: ${file} not found, skipping`);
      continue;
    }
    fs.copyFileSync(src, dest);
    console.log(`  ${file}`);
  }

  // ── 3. Copy directories ────────────────────────────────────────────────────
  for (const dir of DIRS) {
    const src = path.join(repoRoot, dir);
    const dest = path.join(INSTALL_DIR, dir);
    if (!fs.existsSync(src)) {
      console.warn(`  Warning: ${dir}/ not found, skipping`);
      continue;
    }
    copyDir(src, dest);
    console.log(`  ${dir}/`);
  }

  // ── 4. Install npm dependencies ────────────────────────────────────────────
  console.log('\nInstalling dependencies...');
  run('npm install --omit=dev --prefer-offline 2>/dev/null || npm install --omit=dev');

  // ── 5. Link search-beads onto PATH ─────────────────────────────────────────
  console.log('\nLinking search-beads...');
  run('npm link');

  // ── 6. Download ONNX embedding model ──────────────────────────────────────
  console.log('\nDownloading ONNX embedding model (all-MiniLM-L6-v2, ~90 MB)...');
  run(`node ${path.join(INSTALL_DIR, 'setup-onnx.js')}`);

  // ── 7. Print next steps ────────────────────────────────────────────────────
  console.log('\n✓ ContextWeave installed successfully.');
  console.log('\nNext steps:');
  console.log('  1. In each project, run: bd init --stealth');
  console.log('     (creates .beads/ locally — add .beads/ to .gitignore)');
  console.log('  2. Merge the hook bindings below into ~/.claude/settings.json');
  console.log('  3. Restart Claude Code and verify context is injected on startup.\n');

  console.log('── Claude Code  (~/.claude/settings.json) ────────────────────────');
  console.log(claudeSnippet());
}

function claudeSnippet() {
  const d = INSTALL_DIR;
  return JSON.stringify({
    hooks: {
      SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: `node ${d}/1-context-start.js` }] }],
      UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${d}/2-context-before-agent.js` }] }],
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', async: true, command: `node ${d}/7-context-after-tool.js` }] }],
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', async: true, command: `node ${d}/7-context-after-tool.js` }] }],
      PostToolUseFailure: [{ matcher: '*', hooks: [{ type: 'command', async: true, command: `node ${d}/7-context-after-tool.js` }] }],
      PreCompact: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${d}/3-context-precompress.js` }] }],
      Stop: [{ matcher: '*', hooks: [{ type: 'command', async: true, command: `node ${d}/6-context-after-agent.js` }] }],
      SessionEnd: [{ matcher: '*', hooks: [{ type: 'command', async: true, command: `node ${d}/5-context-end.js` }] }],
    }
  }, null, 2);
}

main();
