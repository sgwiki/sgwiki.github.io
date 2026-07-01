#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';
const STATE_PATH = path.join(WORKSPACE, '.admin', 'humanize-coverage.json');

function parseArgs(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

function normalizeWikiFile(value) {
  const normalized = path.posix.normalize(String(value || '').replace(/\\/g, '/'));
  if (!normalized.startsWith('wiki/') || !normalized.endsWith('.md') || normalized.includes('/../')) {
    throw new Error(`Invalid wiki file: ${value}`);
  }
  return normalized;
}

function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { version: 1, completed: {}, skipped: {} };
  }
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  state.version ||= 1;
  state.completed ||= {};
  state.skipped ||= {};
  return state;
}

function saveState(state) {
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const state = loadState();

  if (command === 'list') {
    console.log(JSON.stringify({ status: 'ok', state }, null, 2));
    return;
  }

  if (command === 'mark') {
    const file = normalizeWikiFile(options.file);
    state.completed[file] = {
      file,
      run_id: options['run-id'] || null,
      marked_at: nowIso(),
    };
    delete state.skipped[file];
    saveState(state);
    console.log(JSON.stringify({ status: 'ok', action: 'marked', file }, null, 2));
    return;
  }

  if (command === 'unmark') {
    const file = normalizeWikiFile(options.file);
    delete state.completed[file];
    saveState(state);
    console.log(JSON.stringify({ status: 'ok', action: 'unmarked', file }, null, 2));
    return;
  }

  if (command === 'stats') {
    const completed = Object.keys(state.completed).length;
    console.log(JSON.stringify({ status: 'ok', completed }, null, 2));
    return;
  }

  throw new Error('Usage: humanize_coverage.mjs list|mark|unmark|stats ...');
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
