const payload = require('./payload');
const trace = require('./trace-utils');

const input = payload.readAndNormalize();
const cwd = trace.getCwd(input);
const beadsDir = trace.getBeadsDir(cwd);

if (beadsDir) {
  try {
    trace.logTool({ cwd, beadsDir, input });
  } catch (err) {
    // Ignore trace logging failures.
  }
}

console.log(JSON.stringify({}));
