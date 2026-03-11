const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function createBdStub(root, fixture) {
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const scriptPath = path.join(binDir, 'bd');
  const fixturePath = path.join(root, 'bd-fixture.json');
  const callsPath = path.join(root, 'bd-calls.jsonl');

  fs.writeFileSync(fixturePath, JSON.stringify(fixture || {}, null, 2), 'utf8');
  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require('fs');
const fixturePath = process.env.BD_FIXTURE_PATH;
const callsPath = process.env.BD_CALLS_PATH;
const args = process.argv.slice(2);
const fixture = fixturePath && fs.existsSync(fixturePath)
  ? JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  : {};
if (callsPath) {
  fs.appendFileSync(callsPath, JSON.stringify(args) + '\\n', 'utf8');
}
if (args[0] === 'q') {
  const ids = Array.isArray(fixture.q_ids) ? fixture.q_ids : [];
  const nextId = ids.length ? ids.shift() : 'TRACE-1';
  fixture.q_ids = ids;
  if (fixturePath) {
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf8');
  }
  process.stdout.write(String(nextId));
  process.exit(0);
}
if (args[0] === 'update') {
  process.exit(0);
}
const key = args.join(' ');
const output = fixture.commands && Object.prototype.hasOwnProperty.call(fixture.commands, key)
  ? fixture.commands[key]
  : '';
if (output === null || output === undefined) {
  process.exit(0);
}
if (typeof output === 'string') {
  process.stdout.write(output);
} else {
  process.stdout.write(JSON.stringify(output));
}
`,
    'utf8'
  );
  fs.chmodSync(scriptPath, 0o755);

  return { binDir, fixturePath, callsPath };
}

function createWorkspace({ fixture = {}, withBeads = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contextweave-'));
  const cwd = path.join(root, 'workspace');
  fs.mkdirSync(cwd, { recursive: true });
  const beadsDir = path.join(cwd, '.beads');
  if (withBeads) {
    fs.mkdirSync(beadsDir, { recursive: true });
  }

  const { binDir, fixturePath, callsPath } = createBdStub(root, fixture);
  return {
    root,
    cwd,
    beadsDir,
    fixturePath,
    callsPath,
    env: {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      BD_FIXTURE_PATH: fixturePath,
      BD_CALLS_PATH: callsPath,
    },
  };
}

function readCalls(callsPath) {
  if (!fs.existsSync(callsPath)) {
    return [];
  }
  return fs
    .readFileSync(callsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function withEnv(env, fn) {
  const previousEnv = {};
  const envKeys = Object.keys(env || {});
  for (const key of envKeys) {
    previousEnv[key] = process.env[key];
    process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
  }
}

function executeHook(scriptName, { cwd, env = {}, input = {} }) {
  const scriptPath = path.join(repoRoot, scriptName);
  const originalReadFileSync = fs.readFileSync;
  const originalWrite = process.stdout.write;
  const originalExit = process.exit;
  const originalCwd = process.cwd();
  const previousEnv = {};
  const envKeys = Object.keys(env);
  let stdout = '';
  let status = 0;

  fs.readFileSync = function patchedReadFileSync(target, ...args) {
    if (target === 0) {
      return JSON.stringify(input);
    }
    return originalReadFileSync.call(this, target, ...args);
  };
  process.stdout.write = (chunk, encoding, callback) => {
    stdout += String(chunk);
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  };
  process.exit = (code = 0) => {
    status = code;
    throw new Error('__HOOK_EXIT__');
  };

  for (const key of envKeys) {
    previousEnv[key] = process.env[key];
    process.env[key] = env[key];
  }

  process.chdir(cwd);
  delete require.cache[require.resolve(scriptPath)];
  try {
    require(scriptPath);
  } catch (err) {
    if (!(err instanceof Error) || err.message !== '__HOOK_EXIT__') {
      throw err;
    }
  } finally {
    delete require.cache[require.resolve(scriptPath)];
    process.chdir(originalCwd);
    fs.readFileSync = originalReadFileSync;
    process.stdout.write = originalWrite;
    process.exit = originalExit;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
  }

  return { status, stdout };
}

module.exports = { createWorkspace, executeHook, readCalls, repoRoot, withEnv };
