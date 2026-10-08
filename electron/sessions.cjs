const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const MAX_TAIL_BYTES = 24 * 1024;

function getRoots() {
  const home = os.homedir();
  const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
  const claudeConfig = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  let codexState = null;
  try {
    const stateFiles = fs.readdirSync(codexHome)
      .filter((name) => /^state_\d+\.sqlite$/.test(name))
      .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
    if (stateFiles.length > 0) codexState = path.join(codexHome, stateFiles[0]);
  } catch {}
  const projectDirectory = ['projetcts', 'projects']
    .map((name) => path.join(home, name))
    .find((candidate) => fs.existsSync(candidate)) || path.join(home, 'projects');
  return {
    codex: path.join(codexHome, 'sessions'),
    codexIndex: path.join(codexHome, 'session_index.jsonl'),
    codexState,
    claude: path.join(claudeConfig, 'projects'),
    workspace: projectDirectory,
  };
}

async function findJsonlFiles(root, output = []) {
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'subagents') continue;
      await findJsonlFiles(entryPath, output);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      output.push(entryPath);
    }
  }
  return output;
}

async function readFirstJsonLine(filePath) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(128 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0];
    return JSON.parse(line);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readCodexSessionIndex(filePath) {
  try {
    const contents = await fs.promises.readFile(filePath, 'utf8');
    const sessions = new Map();
    for (const line of contents.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (!record.id) continue;
        const updatedAt = Date.parse(record.updated_at || '');
        sessions.set(String(record.id), {
          title: typeof record.thread_name === 'string' ? record.thread_name.trim() : '',
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
        });
      } catch {
        // Ignore a partial line while Codex is updating its index.
      }
    }
    return sessions;
  } catch {
    return null;
  }
}

function readCodexState(filePath) {
  if (!filePath) return null;
  let database;
  try {
    const { DatabaseSync } = require('node:sqlite');
    database = new DatabaseSync(filePath, { readOnly: true, timeout: 1_000 });
    const columns = new Set(database.prepare('PRAGMA table_info(threads)').all().map((column) => column.name));
    if (!['id', 'cwd', 'rollout_path'].every((column) => columns.has(column))) return null;
    const fields = [
      'id', 'cwd', 'rollout_path', 'name', 'title', 'git_branch', 'source', 'archived', 'updated_at', 'updated_at_ms',
    ].filter((column) => columns.has(column));
    const rows = database.prepare(`SELECT ${fields.map((column) => `"${column}"`).join(', ')} FROM threads`).all();
    return new Map(rows.map((row) => [String(row.id), row]));
  } catch {
    // Older Codex installations may only have the JSONL history/index.
    return null;
  } finally {
    database?.close();
  }
}

function readTailLines(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, MAX_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function codexActivity(filePath) {
  const events = readTailLines(filePath)
    .filter((record) => record.type === 'event_msg')
    .map((record) => record.payload?.type)
    .filter(Boolean);
  let lastState = 'unknown';
  for (const eventType of events) {
    if (eventType === 'task_started') lastState = 'working';
    if (eventType === 'task_complete') lastState = 'done';
  }
  return lastState;
}

function claudeActivity(filePath) {
  const records = readTailLines(filePath);
  let latestAssistant = null;
  let latestRecord = null;
  for (const record of records) {
    if (record.timestamp && (!latestRecord || record.timestamp > latestRecord.timestamp)) {
      latestRecord = record;
    }
    if (record.type === 'assistant' && record.timestamp) {
      if (!latestAssistant || record.timestamp > latestAssistant.timestamp) latestAssistant = record;
    }
  }
  if (!latestAssistant) return 'unknown';
  if (latestRecord?.type === 'user' && latestRecord.timestamp > latestAssistant.timestamp) return 'working';
  if (latestAssistant.message?.stop_reason === 'tool_use') return 'working';
  if (['end_turn', 'stop_sequence'].includes(latestAssistant.message?.stop_reason)) return 'done';
  return 'unknown';
}

async function parseCodexSession(filePath) {
  const [firstRecord, stats] = await Promise.all([
    readFirstJsonLine(filePath),
    fs.promises.stat(filePath).catch(() => null),
  ]);
  if (!firstRecord || firstRecord.type !== 'session_meta' || !stats) return null;
  const payload = firstRecord.payload || {};
  const id = payload.id || payload.session_id;
  const cwd = payload.cwd;
  if (!id || !cwd || !path.isAbsolute(cwd)) return null;
  return {
    id: `codex:${id}`,
    provider: 'codex',
    sessionId: String(id),
    cwd: path.normalize(cwd),
    title: `Codex · ${String(id).slice(0, 8)}`,
    branch: null,
    updatedAt: stats.mtimeMs,
    available: fs.existsSync(cwd),
    activity: codexActivity(filePath),
  };
}

async function parseClaudeSession(filePath) {
  const [stats, firstRecord, records] = await Promise.all([
    fs.promises.stat(filePath).catch(() => null),
    readFirstJsonLine(filePath),
    Promise.resolve(readTailLines(filePath)),
  ]);
  if (!stats) return null;

  let sessionId = path.basename(filePath, '.jsonl');
  let cwd = null;
  let title = null;
  let branch = null;
  for (const record of [firstRecord, ...records].filter(Boolean)) {
    if (record.sessionId) sessionId = String(record.sessionId);
    if (record.cwd && path.isAbsolute(record.cwd)) cwd = path.normalize(record.cwd);
    if (record.type === 'custom-title' && record.customTitle) title = String(record.customTitle);
    if (!title && record.type === 'ai-title' && record.aiTitle) title = String(record.aiTitle);
    if (!title && record.slug) title = String(record.slug).replaceAll('-', ' ');
    if (record.gitBranch) branch = String(record.gitBranch);
  }
  if (!cwd) return null;
  return {
    id: `claude:${sessionId}`,
    provider: 'claude',
    sessionId,
    cwd,
    title: title || `Claude · ${sessionId.slice(0, 8)}`,
    branch,
    updatedAt: stats.mtimeMs,
    available: fs.existsSync(cwd),
    activity: claudeActivity(filePath),
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function makeDirectoryTree(sessions) {
  const root = { name: '/', path: '/', directories: new Map(), sessions: [] };
  for (const session of sessions) {
    const parts = path.normalize(session.cwd).split(path.sep).filter(Boolean);
    let node = root;
    let currentPath = path.sep;
    for (const part of parts) {
      currentPath = path.join(currentPath, part);
      if (!node.directories.has(part)) {
        node.directories.set(part, { name: part, path: currentPath, directories: new Map(), sessions: [] });
      }
      node = node.directories.get(part);
    }
    node.sessions.push(session);
  }

  function serialize(node) {
    return {
      name: node.name,
      path: node.path,
      sessions: node.sessions.sort((a, b) => b.updatedAt - a.updatedAt),
      directories: [...node.directories.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(serialize),
    };
  }
  return serialize(root);
}

async function scanLibrary(roots = getRoots()) {
  const [codexFiles, codexIndex, claudeFiles, codexState] = await Promise.all([
    findJsonlFiles(roots.codex),
    readCodexSessionIndex(roots.codexIndex),
    findJsonlFiles(roots.claude),
    Promise.resolve(readCodexState(roots.codexState)),
  ]);
  const [parsedCodexSessions, claudeSessions] = await Promise.all([
    mapWithConcurrency(codexFiles, 12, parseCodexSession),
    mapWithConcurrency(claudeFiles, 12, parseClaudeSession),
  ]);
  const parsedById = new Map(parsedCodexSessions.filter(Boolean).map((session) => [session.sessionId, session]));
  const codexSessions = parsedCodexSessions
    .filter(Boolean)
    .filter((session) => !codexState?.has(session.sessionId))
    .filter((session) => !codexIndex || codexIndex.has(session.sessionId))
    .map((session) => {
      const indexed = codexIndex?.get(session.sessionId);
      return {
        ...session,
        title: indexed?.title || session.title,
        updatedAt: indexed?.updatedAt || session.updatedAt,
      };
    });
  // session_meta records the initial cwd. The state database records the
  // current project after a session is moved or resumed in another directory.
  const resumableSources = new Set(['cli', 'vscode', 'exec', 'app-server', 'appServer']);
  for (const row of codexState?.values() || []) {
    if (row.archived || (row.source && !resumableSources.has(row.source))) continue;
    if (typeof row.cwd !== 'string' || !path.isAbsolute(row.cwd)) continue;
    if (typeof row.rollout_path !== 'string' || !fs.existsSync(row.rollout_path)) continue;
    const sessionId = String(row.id);
    const parsed = parsedById.get(sessionId);
    const indexed = codexIndex?.get(sessionId);
    const cwd = path.normalize(row.cwd);
    codexSessions.push({
      id: `codex:${sessionId}`,
      provider: 'codex',
      sessionId,
      cwd,
      title: row.name?.trim() || indexed?.title || row.title?.trim() || parsed?.title || `Codex · ${sessionId.slice(0, 8)}`,
      branch: row.git_branch || parsed?.branch || null,
      updatedAt: Number(row.updated_at_ms) || Number(row.updated_at) * 1_000 || indexed?.updatedAt || parsed?.updatedAt || 0,
      available: fs.existsSync(cwd),
      activity: parsed?.activity || codexActivity(row.rollout_path),
    });
  }
  const sessions = [...codexSessions, ...claudeSessions]
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return { sessions, tree: makeDirectoryTree(sessions), roots };
}

module.exports = { getRoots, scanLibrary };
