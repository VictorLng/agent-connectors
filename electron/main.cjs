const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const pty = require('node-pty');
const { scanLibrary } = require('./sessions.cjs');

const execFileAsync = promisify(execFile);
const runtimes = new Map();
let mainWindow;

function commandSearchPath() {
  const home = os.homedir();
  const additions = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.nvm', 'current', 'bin'),
    '/opt/phpstorm/bin',
    '/snap/bin',
  ];
  for (const root of [path.join(home, '.nvm', 'versions', 'node'), path.join(home, '.local', 'share', 'mise', 'installs', 'node')]) {
    try {
      for (const version of fs.readdirSync(root)) additions.push(path.join(root, version, 'bin'));
    } catch {}
  }
  return [...new Set([...additions, ...(process.env.PATH || '').split(path.delimiter)])];
}

function findExecutable(name) {
  for (const directory of commandSearchPath()) {
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

function providerCommand(provider) {
  const name = provider === 'codex' ? 'codex' : 'claude';
  const executable = findExecutable(name);
  if (!executable) throw new Error(`Não encontrei o comando “${name}” no PATH deste usuário.`);
  return executable;
}

function getDesktopUser() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;

  let uid = Number(process.env.SUDO_UID);
  if (!Number.isInteger(uid) || uid <= 0) {
    for (const candidate of [process.env.XAUTHORITY, process.env.XDG_RUNTIME_DIR]) {
      if (!candidate) continue;
      try {
        const owner = fs.statSync(candidate).uid;
        if (owner > 0) {
          uid = owner;
          break;
        }
      } catch {}
    }
  }
  if (!Number.isInteger(uid) || uid <= 0) return null;

  try {
    const passwdEntry = fs.readFileSync('/etc/passwd', 'utf8')
      .split('\n')
      .map((line) => line.split(':'))
      .find((fields) => Number(fields[2]) === uid);
    if (!passwdEntry) return null;
    return { name: passwdEntry[0], uid, gid: Number(passwdEntry[3]), home: passwdEntry[5] };
  } catch {
    return null;
  }
}

function findPhpStormExecutable(userHome = os.homedir()) {
  const configured = process.env.PHPSTORM_EXECUTABLE;
  if (configured && path.isAbsolute(configured)) {
    try {
      fs.accessSync(configured, fs.constants.X_OK);
      return configured;
    } catch {}
  }

  for (const name of ['phpstorm', 'phpstorm.sh']) {
    const userLauncher = path.join(userHome, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts', name);
    try {
      fs.accessSync(userLauncher, fs.constants.X_OK);
      return userLauncher;
    } catch {}
    const executable = findExecutable(name);
    if (executable) return executable;
  }

  const toolboxApps = path.join(userHome, '.local', 'share', 'JetBrains', 'Toolbox', 'apps', 'phpstorm');
  try {
    for (const channel of fs.readdirSync(toolboxApps)) {
      const channelPath = path.join(toolboxApps, channel);
      const entries = fs.statSync(channelPath).isDirectory() ? fs.readdirSync(channelPath) : [];
      for (const entry of entries) {
        const candidate = path.join(channelPath, entry, 'bin', 'phpstorm.sh');
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        } catch {}
      }
      const directCandidate = path.join(channelPath, 'bin', 'phpstorm.sh');
      try {
        fs.accessSync(directCandidate, fs.constants.X_OK);
        return directCandidate;
      } catch {}
    }
  } catch {}

  return null;
}

function fileFingerprint(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.isFile() ? 'file' : 'other'}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch {
    return 'missing';
  }
}

async function inspectProject(cwd) {
  let projectRoot;
  try {
    const result = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5_000 });
    projectRoot = result.stdout.trim();
  } catch {
    return { projectRoot: cwd, isGitRepository: false, changes: [] };
  }

  try {
    const result = await execFileAsync('git', ['-C', projectRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const entries = result.stdout.split('\0');
    const changes = [];

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry || entry.length < 4) continue;
      const statusCode = entry.slice(0, 2);
      const relativePath = entry.slice(3);
      if (statusCode.includes('R') || statusCode.includes('C')) index += 1;
      const kind = statusCode === '??'
        ? 'untracked'
        : statusCode.includes('U')
          ? 'conflict'
          : statusCode.includes('R')
            ? 'renamed'
            : statusCode.includes('D')
              ? 'deleted'
              : statusCode.includes('A')
                ? 'added'
                : 'modified';
      changes.push({
        relativePath,
        absolutePath: path.resolve(projectRoot, relativePath),
        statusCode,
        kind,
        fingerprint: fileFingerprint(path.resolve(projectRoot, relativePath)),
      });
    }

    return { projectRoot, isGitRepository: true, changes };
  } catch (error) {
    throw new Error(`Não foi possível ler as mudanças do projeto: ${error.message}`);
  }
}

function launchPhpStorm(executable, args, cwd, desktopUser) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    const userOptions = {};
    if (desktopUser && typeof process.getuid === 'function' && process.getuid() === 0) {
      env.HOME = desktopUser.home;
      env.USER = desktopUser.name;
      env.LOGNAME = desktopUser.name;
      env.XDG_RUNTIME_DIR = `/run/user/${desktopUser.uid}`;
      const userBus = path.join(env.XDG_RUNTIME_DIR, 'bus');
      if (fs.existsSync(userBus)) {
        env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${userBus}`;
      } else {
        delete env.DBUS_SESSION_BUS_ADDRESS;
      }
      userOptions.uid = desktopUser.uid;
      userOptions.gid = desktopUser.gid;
    }
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      env,
      ...userOptions,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function sendToRenderer(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#090a0c',
    title: 'Agent Desk',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[Agent Desk] Falha ao carregar preload (${preloadPath}):`, error);
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const allowed = app.isPackaged
      ? target.startsWith('file:')
      : target.startsWith('http://127.0.0.1:5173');
    if (!allowed) event.preventDefault();
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173');
  }
}

function registerHandlers() {
  ipcMain.handle('library:scan', async () => {
    const result = await scanLibrary();
    return {
      ...result,
      commands: {
        codex: findExecutable('codex'),
        claude: findExecutable('claude'),
      },
    };
  });

  ipcMain.handle('directory:choose', async (_event, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolha a pasta do projeto',
      defaultPath: typeof defaultPath === 'string' && path.isAbsolute(defaultPath) ? defaultPath : os.homedir(),
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('runtime:start', async (_event, request) => {
    const provider = request?.provider;
    if (!['codex', 'claude'].includes(provider)) throw new Error('Agente desconhecido.');

    let cwd = request?.cwd;
    let sessionId = request?.sessionId || null;
    if (sessionId) {
      const { sessions } = await scanLibrary();
      const existing = sessions.find((item) => item.provider === provider && item.sessionId === sessionId);
      if (!existing) throw new Error('Não encontrei esse histórico local para retomar. Atualize a lista e tente de novo.');
      cwd = existing.cwd;
    }
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error('A pasta do projeto não existe mais. Escolha uma pasta válida.');
    }
    if (sessionId && !/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) throw new Error('ID de sessão inválido.');

    const executable = providerCommand(provider);
    let changeBaseline = new Map();
    try {
      const baseline = await inspectProject(cwd);
      changeBaseline = new Map(baseline.changes.map((change) => [change.relativePath, change.fingerprint]));
    } catch {}
    const args = sessionId
      ? provider === 'codex'
        ? ['resume', sessionId, '--cd', cwd]
        : ['--resume', sessionId]
      : [];
    const runtimeId = crypto.randomUUID();
    const env = {
      ...process.env,
      PATH: commandSearchPath().join(path.delimiter),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
    };

    const terminal = pty.spawn(executable, args, {
      name: 'xterm-256color',
      cols: Math.max(40, Math.min(Number(request.cols) || 100, 300)),
      rows: Math.max(12, Math.min(Number(request.rows) || 30, 120)),
      cwd,
      env,
      encoding: 'utf8',
    });

    const runtime = {
      id: runtimeId,
      provider,
      cwd,
      sessionId,
      title: request.title || null,
      changeBaseline,
      processId: terminal.pid,
      terminal,
      output: '',
      sequence: 0,
      running: true,
      startedAt: Date.now(),
    };
    runtimes.set(runtimeId, runtime);

    terminal.onData((data) => {
      runtime.output = (runtime.output + data).slice(-1_500_000);
      runtime.sequence += 1;
      sendToRenderer('terminal:data', { runtimeId, sequence: runtime.sequence, data });
    });
    terminal.onExit(({ exitCode, signal }) => {
      runtime.running = false;
      sendToRenderer('runtime:exit', { runtimeId, exitCode, signal });
      runtimes.delete(runtimeId);
    });

    return {
      id: runtimeId,
      provider,
      cwd,
      sessionId,
      title: runtime.title || (sessionId ? `${provider === 'codex' ? 'Codex' : 'Claude'} · ${sessionId.slice(0, 8)}` : `Nova sessão ${provider === 'codex' ? 'Codex' : 'Claude'}`),
      startedAt: runtime.startedAt,
    };
  });

  ipcMain.handle('terminal:attach', (_event, runtimeId) => {
    const runtime = runtimes.get(runtimeId);
    if (!runtime) throw new Error('Esta sessão não está aberta nesta janela.');
    return { output: runtime.output, sequence: runtime.sequence, running: runtime.running };
  });

  ipcMain.on('terminal:write', (_event, { runtimeId, data }) => {
    const runtime = runtimes.get(runtimeId);
    if (runtime?.running && typeof data === 'string') runtime.terminal.write(data);
  });

  ipcMain.on('terminal:resize', (_event, { runtimeId, cols, rows }) => {
    const runtime = runtimes.get(runtimeId);
    if (runtime?.running && Number.isInteger(cols) && Number.isInteger(rows)) {
      runtime.terminal.resize(Math.max(2, cols), Math.max(2, rows));
    }
  });

  ipcMain.handle('runtime:stop', (_event, runtimeId) => {
    const runtime = runtimes.get(runtimeId);
    if (!runtime?.running) return false;
    runtime.terminal.kill('SIGTERM');
    return true;
  });

  ipcMain.handle('runtime:list', () => [...runtimes.values()].map(({ terminal, output, changeBaseline: _changeBaseline, ...runtime }) => runtime));

  ipcMain.handle('project:changes', async (_event, runtimeId) => {
    const runtime = runtimes.get(runtimeId);
    if (!runtime) throw new Error('Esta sessão não está mais aberta.');
    const project = await inspectProject(runtime.cwd);
    return {
      runtimeId,
      projectRoot: project.projectRoot,
      isGitRepository: project.isGitRepository,
      changes: project.changes.map(({ fingerprint, ...change }) => ({
        ...change,
        changedDuringSession: runtime.changeBaseline.get(change.relativePath) !== fingerprint,
      })),
    };
  });

  ipcMain.handle('project:open-phpstorm', async (_event, { runtimeId, relativePath } = {}) => {
    const runtime = runtimes.get(runtimeId);
    if (!runtime) throw new Error('Esta sessão não está mais aberta.');
    const project = await inspectProject(runtime.cwd);
    const desktopUser = getDesktopUser();
    const executable = findPhpStormExecutable(desktopUser?.home || os.homedir());
    if (!executable) throw new Error('Não encontrei o launcher do PhpStorm. Adicione “phpstorm” ao PATH ou defina PHPSTORM_EXECUTABLE.');

    let target = project.projectRoot;
    let openedFile = false;
    if (typeof relativePath === 'string' && relativePath.length > 0) {
      const change = project.changes.find((item) => item.relativePath === relativePath);
      if (!change) throw new Error('Esse arquivo não aparece mais nas mudanças atuais. Atualize a lista e tente de novo.');
      const resolved = path.resolve(project.projectRoot, relativePath);
      const relative = path.relative(project.projectRoot, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('O arquivo selecionado está fora do projeto.');
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        target = resolved;
        openedFile = true;
      }
    }

    await launchPhpStorm(executable, [target], project.projectRoot, desktopUser);
    return { projectRoot: project.projectRoot, target, openedFile };
  });
}

app.whenReady().then(() => {
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  for (const runtime of runtimes.values()) {
    if (runtime.running) runtime.terminal.kill('SIGHUP');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
