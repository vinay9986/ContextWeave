const payload = require('./payload');
const output = require('./output');
const trace = require('./trace-utils');
const { execSync } = require('child_process');

function safe(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
}

const input = payload.readAndNormalize();

const prime = safe('bd prime --full').split('\n').map(line => line.replace(/bd memories (<\w+>|\S+)/g, 'search-beads <query>')).join('\n');
const beadsDir = trace.getBeadsDir(process.cwd());
const allSummary = beadsDir ? trace.buildPromptFinalSummary({ cwd: process.cwd() }) : '';
const openSummary = beadsDir ? trace.buildOpenIssuesSummary({ cwd: process.cwd() }) : '';

const parts = [];
if (prime) parts.push(prime);
if (allSummary) parts.push(allSummary);
if (openSummary) parts.push(openSummary);

if (!parts.length) {
  output.writeOutput({});
  process.exit(0);
}

const response = output.emitContext({
  provider: input.provider,
  event: input.event,
  additionalContext: parts.join('\n\n'),
  systemMessage: 'Beads context injected.',
});
output.writeOutput(response);
