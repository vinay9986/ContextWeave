const fs = require('fs');
const path = require('path');
const payload = require('./payload');
const output = require('./output');
const trace = require('./trace-utils');

const input = payload.readAndNormalize();

const reminder = [
  'Beads reminder:',
  'Update Beads memory before compaction if anything durable changed.',
  'If you made progress, append a note: `bd update <id> --append-notes "..."`.',
].join('\n');

const beadsDir = trace.getBeadsDir(process.cwd());
const stateDir = beadsDir ?? (trace.isBdAvailable() ? trace.getStateDir(input.session_id) : null);
const markerPath = stateDir ? path.join(stateDir, '.needs_rehydrate') : null;

if (markerPath) {
  try {
    fs.writeFileSync(markerPath, 'pending', 'utf8');
  } catch (err) {
    // If we can't write the marker, just proceed with the reminder.
  }
}

const response = output.emitContext({
  provider: input.provider,
  event: input.event,
  systemMessage: reminder,
});

output.writeOutput(response || {});
