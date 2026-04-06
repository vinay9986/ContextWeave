const fs = require('fs');
const path = require('path');
const payload = require('./payload');
const trace = require('./trace-utils');

const input = payload.readAndNormalize();

const beadsDir = trace.getBeadsDir(process.cwd());
const stateDir = beadsDir ?? (trace.isBdAvailable() ? trace.getStateDir(input.session_id) : null);
const markerPath = stateDir ? path.join(stateDir, '.needs_rehydrate') : null;

if (markerPath) {
  try {
    fs.writeFileSync(markerPath, 'pending', 'utf8');
  } catch (err) {
    // If we can't write the marker, rehydration won't happen after compact.
  }
}

// This stdout becomes newCustomInstructions for the compaction LLM.
// Guide it to preserve Beads-relevant state in the summary.
process.stdout.write(
  'Preserve in summary: active Beads issue IDs, current task progress, key decisions, and any pending work.',
);
