const fs = require('fs');
const path = require('path');
const payload = require('./payload');
const output = require('./output');

const input = payload.readAndNormalize();

const reminder = [
  'Beads reminder:',
  'Update Beads memory before compaction if anything durable changed.',
  'If you made progress, append a note: `bd update <id> --append-notes "..."`.',
].join('\n');

const beadsDir = path.join(process.cwd(), '.beads');
const markerPath = path.join(beadsDir, '.needs_rehydrate');
const hasBeadsDir = fs.existsSync(beadsDir);

let currentMtime = null;

try {
  const dbPath = path.join(beadsDir, 'beads.db');
  const stat = fs.statSync(dbPath);
  currentMtime = stat.mtimeMs;
} catch (err) {
  currentMtime = null;
}

if (currentMtime === null) {
  currentMtime = null;
}

if (fs.existsSync(beadsDir)) {
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
