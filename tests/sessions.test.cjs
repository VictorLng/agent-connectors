const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { scanLibrary } = require('../electron/sessions.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-desk-sessions-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const roots = {
    codex: path.join(directory, 'sessions'),
    codexIndex: path.join(directory, 'session_index.jsonl'),
    codexState: path.join(directory, 'state_5.sqlite'),
    claude: path.join(directory, 'claude-projects'),
    workspace: path.join(directory, 'projects'),
  };
  const hotel = path.join(roots.workspace, 'hotel');
  const agentDesk = path.join(roots.workspace, 'agent-desk');
  for (const folder of [roots.codex, roots.claude, hotel, agentDesk]) fs.mkdirSync(folder, { recursive: true });
  function rollout(id, cwd) {
    const file = path.join(roots.codex, `rollout-${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: 'session_meta', payload: { id, cwd } })}\n`);
    return file;
  }
  function index(rows) {
    fs.writeFileSync(roots.codexIndex, rows.map((row) => JSON.stringify(row)).join('\n'));
  }
  return { roots, hotel, agentDesk, rollout, index };
}

function directoryAt(node, directory) {
  if (node.path === directory) return node;
  return node.directories.map((child) => directoryAt(child, directory)).find(Boolean);
}

test('uses the current Codex project after a session moves, and merges resumable histories without modifying them', async (t) => {
  const { roots, hotel, agentDesk, rollout, index } = fixture(t);
  const moved = '11111111-1111-4111-8111-111111111111';
  const dbOnly = '22222222-2222-4222-8222-222222222222';
  const archived = '33333333-3333-4333-8333-333333333333';
  const internal = '44444444-4444-4444-8444-444444444444';
  const missing = '55555555-5555-4555-8555-555555555555';
  const fresh = '66666666-6666-4666-8666-666666666666';
  const movedFile = rollout(moved, hotel);
  const dbOnlyFile = rollout(dbOnly, hotel);
  const archivedFile = rollout(archived, hotel);
  const internalFile = rollout(internal, hotel);
  rollout(fresh, agentDesk);
  index([moved, archived, internal, missing, fresh].map((id) => ({
    id, thread_name: `Indexed ${id}`, updated_at: '2026-10-05T09:00:00Z',
  })));

  const database = new DatabaseSync(roots.codexState);
  database.exec(`CREATE TABLE threads (
    id TEXT PRIMARY KEY, cwd TEXT, rollout_path TEXT, source TEXT,
    archived INTEGER, name TEXT, title TEXT, git_branch TEXT,
    updated_at INTEGER, updated_at_ms INTEGER
  )`);
  const insert = database.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run(moved, agentDesk, movedFile, 'vscode', 0, 'Agent Desk session', 'Old first prompt', 'main', 1791202600, 1791225676789);
  insert.run(dbOnly, hotel, dbOnlyFile, 'cli', 0, null, 'Database-only session', null, 1791202700, null);
  insert.run(archived, hotel, archivedFile, 'cli', 1, null, 'Archived', null, 1791202700, null);
  insert.run(internal, hotel, internalFile, '{"subagent":{"other":"guardian"}}', 0, null, 'Internal', null, 1791202700, null);
  insert.run(missing, hotel, path.join(roots.codex, 'missing.jsonl'), 'cli', 0, null, 'Missing', null, 1791202700, null);
  database.close();
  const originalDatabase = fs.readFileSync(roots.codexState);
  const originalIndex = fs.readFileSync(roots.codexIndex);
  const originalRollout = fs.readFileSync(movedFile);

  const library = await scanLibrary(roots);
  assert.deepEqual(library.sessions.map((session) => session.sessionId).sort(), [moved, dbOnly, fresh].sort());
  const session = library.sessions.find((entry) => entry.sessionId === moved);
  assert.equal(session.cwd, agentDesk);
  assert.equal(session.title, 'Agent Desk session');
  assert.equal(session.updatedAt, 1791225676789);
  assert.equal(session.branch, 'main');
  assert.ok(directoryAt(library.tree, agentDesk).sessions.some((entry) => entry.sessionId === moved));
  assert.ok(!directoryAt(library.tree, hotel).sessions.some((entry) => entry.sessionId === moved));
  assert.deepEqual(fs.readFileSync(roots.codexState), originalDatabase);
  assert.deepEqual(fs.readFileSync(roots.codexIndex), originalIndex);
  assert.deepEqual(fs.readFileSync(movedFile), originalRollout);
});

test('preserves JSONL index compatibility when no Codex database is available', async (t) => {
  const { roots, hotel, rollout, index } = fixture(t);
  roots.codexState = null;
  const indexed = '11111111-1111-4111-8111-111111111111';
  rollout(indexed, hotel);
  rollout('22222222-2222-4222-8222-222222222222', hotel);
  index([{ id: indexed, thread_name: 'Legacy session', updated_at: '2026-10-05T09:00:00Z' }]);
  const { sessions } = await scanLibrary(roots);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, indexed);
  assert.equal(sessions[0].title, 'Legacy session');
  assert.equal(sessions[0].cwd, hotel);
});

test('reads older Codex database schemas with second timestamps and no optional columns', async (t) => {
  const { roots, hotel, agentDesk, rollout, index } = fixture(t);
  const id = '11111111-1111-4111-8111-111111111111';
  const file = rollout(id, hotel);
  index([]);
  const database = new DatabaseSync(roots.codexState);
  database.exec('CREATE TABLE threads (id TEXT, cwd TEXT, rollout_path TEXT, title TEXT, updated_at INTEGER)');
  database.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?)').run(id, agentDesk, file, 'Moved legacy session', 1791225676);
  database.close();
  const { sessions } = await scanLibrary(roots);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].cwd, agentDesk);
  assert.equal(sessions[0].title, 'Moved legacy session');
  assert.equal(sessions[0].updatedAt, 1791225676000);
});
