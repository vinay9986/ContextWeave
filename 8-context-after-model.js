const payload = require('./payload');
const trace = require('./trace-utils');

const input = payload.readAndNormalize();
const cwd = trace.getCwd(input);
const beadsDir = trace.getBeadsDir(cwd);
const stateDir = beadsDir ?? (trace.isBdAvailable() ? trace.getStateDir(input.session_id) : null);

if (stateDir) {
  try {
    trace.logIntermediate({ cwd, stateDir, input });
  } catch (err) {
    // Ignore trace logging failures.
  }
}

console.log(JSON.stringify({}));
