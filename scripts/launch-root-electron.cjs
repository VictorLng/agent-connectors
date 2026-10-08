require('./check-root-user.cjs');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function desktopEnvironment() {
  const env = { ...process.env };
  if (env.DISPLAY && env.XAUTHORITY && fs.existsSync(env.XAUTHORITY)) return env;

  // A shell opened with su can lose the XWayland variables from the desktop.
  const desktopUid = Number(env.SUDO_UID);
  const candidates = [];
  for (const pid of fs.readdirSync('/proc').filter((entry) => /^\d+$/.test(entry))) {
    try {
      const procPath = path.join('/proc', pid);
      const args = fs.readFileSync(path.join(procPath, 'cmdline'), 'utf8').split('\0');
      if (!['Xwayland', 'Xorg'].includes(path.basename(args[0]))) continue;
      if (desktopUid > 0 && fs.statSync(procPath).uid !== desktopUid) continue;
      const display = args.find((arg) => /^:\d+(?:\.\d+)?$/.test(arg));
      const authIndex = args.indexOf('-auth');
      const authority = authIndex >= 0 ? args[authIndex + 1] : null;
      if (!display || !authority || !fs.existsSync(authority)) continue;
      if (env.DISPLAY && env.DISPLAY.split('.')[0] !== display.split('.')[0]) continue;
      candidates.push({ display, authority });
    } catch {}
  }
  if (candidates.length === 1) {
    env.DISPLAY = env.DISPLAY || candidates[0].display;
    env.XAUTHORITY = candidates[0].authority;
  }
  if (!env.DISPLAY) {
    throw new Error('Não encontrei o desktop. Inicie o dev:root em um terminal da sessão gráfica do Ubuntu.');
  }
  return env;
}

function xhost(args, env) {
  const result = spawnSync('xhost', args, {
    env: { ...env, LC_ALL: 'C' },
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.error?.code === 'ENOENT') {
    throw new Error('Instale x11-xserver-utils para permitir a janela do app em modo root.');
  }
  if (result.error || result.status !== 0) {
    throw new Error(`Não consegui acessar o desktop: ${(result.stderr || result.error?.message || '').trim()}`);
  }
  return result.stdout;
}

function launch() {
  const env = desktopEnvironment();
  const accessList = xhost([], env);
  const alreadyAllowed = /SI:localuser:root\s*$/im.test(accessList)
    || /access control disabled/i.test(accessList);
  let granted = false;
  let runtimeDirectory;
  let child;
  let stopping = false;
  let stopTimer;

  function cleanup() {
    if (granted) {
      try {
        xhost(['-SI:localuser:root'], env);
        granted = false;
      } catch (error) {
        console.error(`[Agent Desk] ${error.message}`);
      }
    }
    if (runtimeDirectory) {
      try {
        fs.rmSync(runtimeDirectory, { recursive: true, force: true });
        runtimeDirectory = null;
      } catch (error) {
        console.error(`[Agent Desk] Falha ao limpar o diretório temporário: ${error.message}`);
      }
    }
  }

  function stop(signal) {
    if (!child?.pid || stopping) return;
    stopping = true;
    try { process.kill(-child.pid, signal); } catch {}
    stopTimer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, 5_000);
    stopTimer.unref();
  }

  process.once('exit', cleanup);
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGHUP', () => stop('SIGHUP'));

  try {
    if (!alreadyAllowed) {
      xhost(['+SI:localuser:root'], env);
      granted = true;
    }
    runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-desk-root-runtime-'));
    fs.chmodSync(runtimeDirectory, 0o700);
    // A private bus without desktop service activation avoids starting another
    // set of GNOME portals, keyrings and FUSE mounts under the root account.
    const busConfig = path.join(runtimeDirectory, 'bus.conf');
    fs.writeFileSync(busConfig, `<busconfig>
  <type>session</type>
  <listen>unix:tmpdir=/tmp</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow user="root"/>
    <allow own="*"/>
    <allow send_destination="*"/>
    <allow receive_sender="*"/>
  </policy>
</busconfig>\n`, { mode: 0o600 });
    const electron = require('electron');
    const target = process.argv[2] || path.resolve(__dirname, '..');
    child = spawn('dbus-run-session', [
      `--config-file=${busConfig}`, '--', electron, '--no-sandbox', '--ozone-platform=x11', target,
    ], {
      detached: true,
      stdio: 'inherit',
      env: {
        ...env,
        XDG_RUNTIME_DIR: runtimeDirectory,
        GTK_USE_PORTAL: '0',
      },
    });
    console.log(`[Agent Desk] Modo root no desktop ${env.DISPLAY}; autorização gráfica restaurada ao encerrar.`);
    child.once('error', (error) => {
      console.error(`[Agent Desk] Falha ao iniciar o Electron: ${error.message}`);
      process.exitCode = 1;
    });
    child.once('close', (code, signal) => {
      clearTimeout(stopTimer);
      cleanup();
      process.exitCode = code ?? (signal ? 1 : 0);
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}

try {
  launch();
} catch (error) {
  console.error(`[Agent Desk] ${error.message}`);
  process.exitCode = 1;
}
