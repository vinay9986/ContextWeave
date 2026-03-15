#!/usr/bin/env node
'use strict';

/**
 * setup-onnx — one-time download of the ONNX embedding model used by search-beads.
 *
 * Run once after `npm link`:
 *   node setup-onnx.js
 *
 * The model (~90 MB) is cached to ~/.cache/contextweave-onnx and reused on every
 * subsequent search-beads call. No internet connection required after this step.
 */

const path = require('path');
const os = require('os');

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const CACHE_DIR = path.join(os.homedir(), '.cache', 'contextweave-onnx');

async function main() {
  console.log(`Downloading ${MODEL} to ${CACHE_DIR} ...`);
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = CACHE_DIR;
  await pipeline('feature-extraction', MODEL);
  console.log('Done. search-beads is ready.');
}

main().catch(err => {
  console.error('setup-onnx failed:', err.message);
  process.exit(1);
});
