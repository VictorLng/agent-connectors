import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CircleRoundedIcon from '@mui/icons-material/CircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import DifferenceRoundedIcon from '@mui/icons-material/DifferenceRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { AgentSession, DirectoryNode, LibrarySnapshot, ProjectChangesSnapshot, Provider, RuntimeSession } from './types';

function ProviderGlyph({ provider, size = 18 }: { provider: Provider; size?: number }) {
  return provider === 'claude' ? (
    <AutoAwesomeRoundedIcon sx={{ fontSize: size, color: '#ff9a5d' }} />
  ) : (
    <TerminalRoundedIcon sx={{ fontSize: size, color: '#d3d6dc' }} />
  );
}

function relativeTime(timestamp: number) {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} d`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(timestamp);
}

function activityLabel(activity: AgentSession['activity']) {
  if (activity === 'working') return { label: 'Trabalhando', color: 'warning' as const, dot: 'orange' };
  if (activity === 'done') return { label: 'Concluída', color: 'success' as const, dot: '' };
  return { label: 'Histórico', color: 'default' as const, dot: 'gray' };
}

function changeLabel(kind: string) {
  if (kind === 'untracked') return 'Novo';
  if (kind === 'added') return 'Adicionado';
  if (kind === 'deleted') return 'Removido';
  if (kind === 'renamed') return 'Renomeado';
  if (kind === 'conflict') return 'Conflito';
  return 'Modificado';
}

function changeColor(kind: string): 'warning' | 'success' | 'error' | 'info' | 'default' {
  if (kind === 'added' || kind === 'untracked') return 'success';
  if (kind === 'deleted' || kind === 'conflict') return 'error';
  if (kind === 'renamed') return 'info';
  if (kind === 'modified') return 'warning';
  return 'default';
}

interface TreeProps {
  node: DirectoryNode;
  level: number;
  query: string;
  expanded: Set<string>;
  selectedPath: string | null;
  selectedSessionId: string | null;
  onToggle: (directoryPath: string) => void;
  onChooseDirectory: (directoryPath: string) => void;
  onChooseSession: (session: AgentSession) => void;
}

function directoryMatches(node: DirectoryNode, query: string): boolean {
  if (!query) return true;
  const lowered = query.toLocaleLowerCase();
  return node.path.toLocaleLowerCase().includes(lowered)
    || node.sessions.some((session) => `${session.title} ${session.sessionId} ${session.provider}`.toLocaleLowerCase().includes(lowered))
    || node.directories.some((child) => directoryMatches(child, query));
}

function DirectoryBranch(props: TreeProps) {
  const { node, level, query, expanded, selectedPath, selectedSessionId, onToggle, onChooseDirectory, onChooseSession } = props;
  if (!directoryMatches(node, query)) return null;
  const isOpen = expanded.has(node.path) || Boolean(query);
  const visibleSessions = node.sessions.filter((session) => {
    if (!query) return true;
    const lowered = query.toLocaleLowerCase();
    return `${session.title} ${session.sessionId} ${session.provider} ${session.cwd}`.toLocaleLowerCase().includes(lowered);
  });

  return (
    <Box>
      <Box
        className={`tree-row ${selectedPath === node.path ? 'selected' : ''}`}
        onClick={() => {
          onChooseDirectory(node.path);
          onToggle(node.path);
        }}
        sx={{ pl: `${8 + level * 4}px`, pr: 0.75 }}
        title={node.path}
      >
        <IconButton
          size="small"
          aria-label={isOpen ? 'Recolher pasta' : 'Expandir pasta'}
          onClick={(event) => { event.stopPropagation(); onToggle(node.path); }}
          sx={{ width: 18, height: 22, color: 'text.secondary', p: 0 }}
        >
          {isOpen ? <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18 }} /> : <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />}
        </IconButton>
        {isOpen ? <FolderOpenRoundedIcon sx={{ fontSize: 16, color: '#f5a36e' }} /> : <FolderRoundedIcon sx={{ fontSize: 16, color: '#c98252' }} />}
        <Typography className="tree-label" sx={{ fontSize: 12.5, fontWeight: level === 0 ? 650 : 500 }}>
          {node.name === '/' ? 'Diretórios' : node.name}
        </Typography>
        {node.sessions.length > 0 && (
          <Typography className="tree-secondary" sx={{ mr: 0.5 }}>{node.sessions.length}</Typography>
        )}
      </Box>
      <Collapse in={isOpen} timeout={120} unmountOnExit>
        <Box className="tree-children">
          {visibleSessions.map((session) => {
            return (
              <Box
                key={session.id}
                className={`tree-row session-row ${selectedSessionId === session.id ? 'selected' : ''} ${session.available ? '' : 'missing'}`}
                onClick={() => onChooseSession(session)}
                title={`${session.title}\n${session.cwd}\n${session.sessionId}`}
                sx={{ pl: 1, pr: 0.7 }}
              >
                <ProviderGlyph provider={session.provider} size={16} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography className="tree-label" sx={{ fontSize: 11.5 }}>{session.title}</Typography>
                  <Typography className="tree-secondary">{session.branch || relativeTime(session.updatedAt)}</Typography>
                </Box>
                {session.activity === 'working' ? <span className="status-dot orange" /> : null}
                {session.activity === 'done' ? <CheckCircleOutlineRoundedIcon sx={{ fontSize: 14, color: 'success.main' }} /> : null}
                {!session.available ? <Typography className="tree-secondary" sx={{ ml: 0.3 }}>ausente</Typography> : null}
              </Box>
            );
          })}
          {node.directories.map((child) => (
            <DirectoryBranch key={child.path} {...props} node={child} level={level + 1} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function TerminalPanel({ runtime }: { runtime: RuntimeSession }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"JetBrains Mono", "Cascadia Code", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.28,
      scrollback: 5000,
      theme: {
        background: '#090a0c',
        foreground: '#d5d7dc',
        cursor: '#ff8a49',
        cursorAccent: '#090a0c',
        selectionBackground: 'rgba(255, 118, 41, .34)',
        black: '#17191c', brightBlack: '#656a72',
        red: '#f07178', brightRed: '#ff8790',
        green: '#a6cc90', brightGreen: '#b8dfa2',
        yellow: '#e5c07b', brightYellow: '#f0ce8c',
        blue: '#78a9e8', brightBlue: '#8cbbfa',
        magenta: '#c792ea', brightMagenta: '#d9a8fb',
        cyan: '#74c7d3', brightCyan: '#85dbe7',
        white: '#d5d7dc', brightWhite: '#f2f3f5',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    let ready = false;
    const pending: Array<{ sequence: number; data: string }> = [];
    const offData = window.agentDesk.onTerminalData((payload) => {
      if (payload.runtimeId !== runtime.id) return;
      if (ready) terminal.write(payload.data);
      else pending.push(payload);
    });
    const input = terminal.onData((data) => window.agentDesk.writeTerminal(runtime.id, data));

    const fitAndResize = () => {
      if (!host.isConnected || host.clientWidth < 10 || host.clientHeight < 10) return;
      try {
        fit.fit();
        window.agentDesk.resizeTerminal(runtime.id, terminal.cols, terminal.rows);
      } catch { /* The terminal can be between layout passes. */ }
    };
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(host);
    requestAnimationFrame(fitAndResize);

    window.agentDesk.attachTerminal(runtime.id).then(({ output, sequence }) => {
      terminal.write(output);
      for (const item of pending.sort((a, b) => a.sequence - b.sequence)) {
        if (item.sequence > sequence) terminal.write(item.data);
      }
      ready = true;
      fitAndResize();
      terminal.focus();
    }).catch(() => {
      terminal.write('\r\n\x1b[31mNão foi possível anexar a saída desta sessão.\x1b[0m\r\n');
      ready = true;
    });

    return () => {
      observer.disconnect();
      offData();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [runtime.id]);

  return <Box ref={hostRef} className="terminal-host" />;
}

function App() {
  const treeInitializedRef = useRef(false);
  const knownSessionPathsRef = useRef<Map<string, string>>(new Map());
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeSession[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<AgentSession | null>(null);
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['/']));
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newProvider, setNewProvider] = useState<Provider>('codex');
  const [newCwd, setNewCwd] = useState('');
  const [starting, setStarting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'error' | 'success' | 'info' } | null>(null);
  const [projectChanges, setProjectChanges] = useState<ProjectChangesSnapshot | null>(null);
  const [projectChangesError, setProjectChangesError] = useState<string | null>(null);
  const [openingPhpStorm, setOpeningPhpStorm] = useState<string | null>(null);

  const refreshLibrary = useCallback(async (quiet = false) => {
    if (!window.agentDesk) {
      setLoading(false);
      return;
    }
    if (!quiet) setRefreshing(true);
    try {
      const snapshot = await window.agentDesk.scanLibrary();
      setLibrary(snapshot);
      setLoading(false);
    } catch (error) {
      setSnackbar({ message: error instanceof Error ? error.message : 'Falha ao ler o histórico local.', severity: 'error' });
      setLoading(false);
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!window.agentDesk) {
      setLoading(false);
      return;
    }
    void refreshLibrary(true);
    void window.agentDesk.listRuntimes().then((items) => {
      const active = items.filter((item) => item.running);
      setRuntimes(active.map(({ processId: _processId, running: _running, ...runtime }) => runtime));
      if (active.length > 0) setSelectedRuntimeId(active.at(-1)?.id || null);
    }).catch(() => {});
    const interval = window.setInterval(() => void refreshLibrary(true), 5_000);
    return () => window.clearInterval(interval);
  }, [refreshLibrary]);

  useEffect(() => {
    if (!library) return;
    if (!selectedDirectory) setSelectedDirectory(library.sessions[0]?.cwd || null);
    if (library.sessions.length > 0) {
      if (!treeInitializedRef.current) {
        const initial = new Set(['/']);
        const expandSessionPaths = (node: DirectoryNode) => {
          initial.add(node.path);
          for (const child of node.directories) expandSessionPaths(child);
        };
        expandSessionPaths(library.tree);
        setExpanded(initial);
        treeInitializedRef.current = true;
        knownSessionPathsRef.current = new Map(library.sessions.map((session) => [session.id, session.cwd]));
      } else {
        const addedSessions = library.sessions.filter((session) => knownSessionPathsRef.current.get(session.id) !== session.cwd);
        if (addedSessions.length > 0) {
          setExpanded((current) => {
            const next = new Set(current);
            for (const session of addedSessions) {
              let currentPath = '';
              for (const segment of session.cwd.split('/').filter(Boolean)) {
                currentPath += `/${segment}`;
                next.add(currentPath);
              }
            }
            return next;
          });
        }
        knownSessionPathsRef.current = new Map(library.sessions.map((session) => [session.id, session.cwd]));
      }
    }
  }, [library, selectedDirectory]);

  const selectedRuntime = runtimes.find((runtime) => runtime.id === selectedRuntimeId) || null;
  const selectedRuntimeActivity = selectedRuntime
    ? library?.sessions.find((session) => selectedRuntime.sessionId
      ? session.provider === selectedRuntime.provider && session.sessionId === selectedRuntime.sessionId
      : session.provider === selectedRuntime.provider && session.cwd === selectedRuntime.cwd && session.updatedAt >= selectedRuntime.startedAt - 5_000)?.activity || 'unknown'
    : 'unknown';
  const selectedHistoryCurrent = selectedHistory
    ? library?.sessions.find((session) => session.id === selectedHistory.id) || selectedHistory
    : null;
  const runningCount = runtimes.length;

  const refreshProjectChanges = useCallback(async () => {
    if (!selectedRuntime) return;
    try {
      const snapshot = await window.agentDesk.getProjectChanges(selectedRuntime.id);
      setProjectChanges(snapshot);
      setProjectChangesError(null);
    } catch (error) {
      setProjectChangesError(error instanceof Error ? error.message : 'Não foi possível ler as mudanças do projeto.');
    }
  }, [selectedRuntime?.id]);

  useEffect(() => {
    if (!selectedRuntime) {
      setProjectChanges(null);
      setProjectChangesError(null);
      return;
    }
    setProjectChangesError(null);
    void refreshProjectChanges();
    const interval = window.setInterval(() => void refreshProjectChanges(), 3_000);
    return () => window.clearInterval(interval);
  }, [refreshProjectChanges, selectedRuntime?.id]);

  const openInPhpStorm = async (relativePath?: string) => {
    if (!selectedRuntime) return;
    const requestKey = relativePath || '__project__';
    setOpeningPhpStorm(requestKey);
    try {
      const result = await window.agentDesk.openInPhpStorm(selectedRuntime.id, relativePath);
      setSnackbar({
        message: result.openedFile
          ? `Abrindo ${relativePath} no PhpStorm.`
          : `Abrindo o projeto ${result.projectRoot} no PhpStorm.`,
        severity: 'success',
      });
    } catch (error) {
      setSnackbar({ message: error instanceof Error ? error.message : 'Não foi possível abrir o PhpStorm.', severity: 'error' });
    } finally {
      setOpeningPhpStorm(null);
    }
  };

  const chooseHistory = (session: AgentSession) => {
    setSelectedHistory(session);
    setSelectedDirectory(session.cwd);
    const runtime = runtimes.find((item) => item.provider === session.provider && item.sessionId === session.sessionId);
    setSelectedRuntimeId(runtime?.id || null);
  };

  const removeRuntimeTab = useCallback((runtimeId: string) => {
    const remaining = runtimes.filter((runtime) => runtime.id !== runtimeId);
    setRuntimes(remaining);
    if (selectedRuntimeId === runtimeId) setSelectedRuntimeId(remaining.at(-1)?.id || null);
  }, [runtimes, selectedRuntimeId]);

  const handleStart = async (provider: Provider, cwd: string, session?: AgentSession) => {
    setStarting(true);
    try {
      const runtime = await window.agentDesk.startRuntime({
        provider,
        cwd,
        ...(session ? { sessionId: session.sessionId, title: session.title } : {}),
        cols: 100,
        rows: 30,
      });
      setRuntimes((current) => [...current, runtime]);
      setSelectedRuntimeId(runtime.id);
      setSelectedHistory(null);
      setSelectedDirectory(runtime.cwd);
      setNewDialogOpen(false);
      setSnackbar({ message: `${provider === 'codex' ? 'Codex' : 'Claude'} aberto no PTY.`, severity: 'success' });
      void refreshLibrary(true);
    } catch (error) {
      setSnackbar({ message: error instanceof Error ? error.message : 'Não foi possível iniciar o CLI.', severity: 'error' });
    } finally {
      setStarting(false);
    }
  };

  const openNewDialog = () => {
    const defaultPath = selectedDirectory || selectedHistoryCurrent?.cwd || library?.sessions[0]?.cwd || '';
    setNewCwd(defaultPath);
    setNewProvider('codex');
    setNewDialogOpen(true);
  };

  const chooseFolder = async () => {
    try {
      const folder = await window.agentDesk.chooseDirectory(newCwd || undefined);
      if (folder) setNewCwd(folder);
    } catch (error) {
      setSnackbar({ message: error instanceof Error ? error.message : 'Não foi possível abrir o seletor de pastas.', severity: 'error' });
    }
  };

  const toggleDirectory = (directoryPath: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(directoryPath)) next.delete(directoryPath);
      else next.add(directoryPath);
      return next;
    });
  };

  const stopRuntime = async (runtime: RuntimeSession) => {
    try {
      await window.agentDesk.stopRuntime(runtime.id);
      removeRuntimeTab(runtime.id);
      setSnackbar({ message: 'Sessão encerrada e terminal fechado.', severity: 'info' });
    } catch (error) {
      setSnackbar({ message: error instanceof Error ? error.message : 'Não foi possível encerrar o terminal.', severity: 'error' });
    }
  };

  const handleRuntimeExit = useCallback((runtimeId: string, exitCode: number) => {
    removeRuntimeTab(runtimeId);
    setSnackbar({
      message: exitCode === 0 ? 'O processo terminou.' : `O processo encerrou com código ${exitCode}.`,
      severity: exitCode === 0 ? 'info' : 'error',
    });
    void refreshLibrary(true);
  }, [refreshLibrary, removeRuntimeTab]);

  useEffect(() => {
    if (!window.agentDesk) return;
    return window.agentDesk.onRuntimeExit(({ runtimeId, exitCode }) => handleRuntimeExit(runtimeId, exitCode));
  }, [handleRuntimeExit]);

  const agentCount = library?.sessions.length || 0;
  const providerAvailable = newProvider === 'codex' ? Boolean(library?.commands.codex) : Boolean(library?.commands.claude);

  if (!window.agentDesk) {
    return <DesktopBridgeNotice />;
  }

  return (
    <Box className="app-shell">
      <Box component="aside" className="sidebar">
        <Box sx={{ px: 2, pt: 2.1, pb: 1.7, display: 'flex', alignItems: 'center', gap: 1.2 }}>
          <Box className="brand-mark"><HubGlyph /></Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 750, letterSpacing: '-0.02em' }}>Agent Desk</Typography>
            <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>seu espaço de agentes local</Typography>
          </Box>
          <Tooltip title="Atualizar histórico">
            <IconButton size="small" onClick={() => void refreshLibrary()} disabled={refreshing} sx={{ color: 'text.secondary' }}>
              {refreshing ? <CircularProgress size={16} /> : <RefreshRoundedIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ px: 1.5, pb: 1.4 }}>
          <TextField
            className="search-input"
            size="small"
            fullWidth
            placeholder="Buscar sessão ou pasta"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment>,
              endAdornment: search ? <InputAdornment position="end"><IconButton size="small" onClick={() => setSearch('')}><CloseRoundedIcon sx={{ fontSize: 15 }} /></IconButton></InputAdornment> : undefined,
            }}
            sx={{ '& .MuiOutlinedInput-root': { background: 'rgba(255,255,255,.025)', borderRadius: 1.7 } }}
          />
        </Box>

        <Divider />
        <Box sx={{ px: 2, pt: 1.8, pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ fontSize: 10.5, color: '#858a92', letterSpacing: '.095em', fontWeight: 700, textTransform: 'uppercase' }}>
            Pastas e sessões
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: '#757a83' }}>{agentCount}</Typography>
        </Box>
        <Box className="sidebar-scroll scrollbar" sx={{ px: 1, pb: 1.2 }}>
          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2, color: 'text.secondary' }}>
              <CircularProgress size={15} /><Typography variant="caption">Lendo históricos locais…</Typography>
            </Stack>
          ) : library?.tree ? (
            <DirectoryBranch
              node={library.tree}
              level={0}
              query={search}
              expanded={expanded}
              selectedPath={selectedDirectory}
              selectedSessionId={selectedHistoryCurrent?.id || null}
              onToggle={toggleDirectory}
              onChooseDirectory={(directoryPath) => { setSelectedDirectory(directoryPath); setSelectedHistory(null); setSelectedRuntimeId(null); }}
              onChooseSession={chooseHistory}
            />
          ) : null}
          {!loading && agentCount === 0 && (
            <Box sx={{ px: 1.5, py: 1.2 }}>
              <Typography sx={{ color: 'text.secondary', fontSize: 11.5, lineHeight: 1.6 }}>
                Ainda não encontrei históricos. Inicie uma sessão para ela aparecer aqui.
              </Typography>
            </Box>
          )}
        </Box>

        <Box sx={{ p: 1.5, borderTop: '1px solid rgba(255,255,255,.07)' }}>
          <Stack spacing={0.85}>
            <ProviderStatus provider="codex" command={library?.commands.codex || null} />
            <ProviderStatus provider="claude" command={library?.commands.claude || null} />
          </Stack>
          <Typography sx={{ mt: 1.2, color: '#626770', fontSize: 9.5, lineHeight: 1.45 }}>
            A interface lê os históricos locais e abre os CLIs com seu login atual.
          </Typography>
        </Box>
      </Box>

      <Box component="main" className="main-content">
        <Box className="top-bar">
          <Stack direction="row" spacing={1} alignItems="center">
            <span className="status-dot" />
            <Typography sx={{ color: 'text.secondary', fontSize: 11.5 }}>Local neste computador</Typography>
          </Stack>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Chip
              size="small"
              variant="outlined"
              label={`${runningCount} abertas`}
              sx={{ height: 25, color: '#b9bdc4', borderColor: 'rgba(255,255,255,.12)', fontSize: 10.5 }}
            />
            <Button variant="contained" color="primary" startIcon={<AddRoundedIcon />} onClick={openNewDialog}>
              Nova sessão
            </Button>
          </Stack>
        </Box>

        <Box className="content-heading">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" sx={{ fontSize: 22 }}>Sessões CLI</Typography>
            <Typography sx={{ mt: 0.45, color: 'text.secondary', fontSize: 12 }}>
              Retome conversas e acompanhe os terminais por diretório.
            </Typography>
          </Box>
          {selectedRuntime ? (
            <Tooltip title="Encerrar processo">
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                startIcon={<StopRoundedIcon />}
                onClick={() => void stopRuntime(selectedRuntime)}
                sx={{ color: '#c4c7cd', borderColor: 'rgba(255,255,255,.13)', flexShrink: 0 }}
              >
                Encerrar
              </Button>
            </Tooltip>
          ) : null}
        </Box>

        {runtimes.length > 0 && (
          <Box className="active-tabs">
            {runtimes.map((runtime) => (
              <Box
                key={runtime.id}
                className={`active-tab ${selectedRuntimeId === runtime.id ? 'active' : ''}`}
                onClick={() => { setSelectedRuntimeId(runtime.id); setSelectedHistory(null); }}
                title={`${runtime.title}\n${runtime.cwd}`}
              >
                <ProviderGlyph provider={runtime.provider} size={15} />
                <span>{runtime.title}</span>
                <span className="status-dot orange" />
                <Tooltip title="Fechar terminal">
                  <IconButton
                    className="active-tab-close"
                    size="small"
                    aria-label={`Fechar terminal ${runtime.title}`}
                    onClick={(event) => { event.stopPropagation(); void stopRuntime(runtime); }}
                    sx={{ width: 21, height: 21, color: '#858a92', p: 0.25 }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}

        {selectedRuntime ? (
          <>
            <Box sx={{ px: 2.5, py: 1.05, borderBottom: '1px solid rgba(255,255,255,.055)', display: 'flex', alignItems: 'center', gap: 1 }}>
              <ProviderGlyph provider={selectedRuntime.provider} size={16} />
              <Typography sx={{ fontSize: 11.5, fontWeight: 650 }}>{selectedRuntime.title}</Typography>
              <Typography sx={{ color: '#6f747d', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedRuntime.cwd}</Typography>
              <Box sx={{ flex: 1 }} />
              <span className={`status-dot ${selectedRuntimeActivity === 'done' ? '' : 'orange'}`} />
              <Typography sx={{ color: '#c0c3c9', fontSize: 10.5 }}>
                {selectedRuntimeActivity === 'working'
                  ? 'Trabalhando'
                  : selectedRuntimeActivity === 'done'
                    ? 'Turno concluído · PTY aberto'
                    : 'PTY aberto'}
              </Typography>
            </Box>
            <Box className="changes-panel">
              <Box className="changes-toolbar">
                <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0 }}>
                  <DifferenceRoundedIcon sx={{ fontSize: 17, color: '#ff9a5d' }} />
                  <Typography sx={{ fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>Mudanças do projeto</Typography>
                  <Chip
                    size="small"
                    label={projectChanges?.runtimeId === selectedRuntime.id ? projectChanges.changes.length : '…'}
                    sx={{ height: 19, minWidth: 25, color: '#c8cbd1', background: 'rgba(255,255,255,.07)', fontSize: 9.5 }}
                  />
                </Stack>
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <Tooltip title="Atualizar mudanças">
                    <IconButton size="small" onClick={() => void refreshProjectChanges()} sx={{ width: 27, height: 27, color: '#9297a0' }}>
                      <RefreshRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<OpenInNewRoundedIcon sx={{ fontSize: 14 }} />}
                    onClick={() => void openInPhpStorm()}
                    disabled={!projectChanges || openingPhpStorm !== null}
                    sx={{ minWidth: 0, px: 1, py: 0.3, fontSize: 10, color: '#d5d7dc', borderColor: 'rgba(255,255,255,.13)' }}
                  >
                    Abrir projeto
                  </Button>
                </Stack>
              </Box>
              <Typography className="changes-root" title={projectChanges?.projectRoot || selectedRuntime.cwd}>
                {projectChanges?.runtimeId === selectedRuntime.id ? projectChanges.projectRoot : selectedRuntime.cwd}
                <span> · atualiza a cada 3 s</span>
              </Typography>
              <Box className="changes-list scrollbar">
                {projectChangesError ? (
                  <Typography className="changes-empty error-text">{projectChangesError}</Typography>
                ) : projectChanges?.runtimeId !== selectedRuntime.id ? (
                  <Typography className="changes-empty">Consultando mudanças do projeto…</Typography>
                ) : !projectChanges.isGitRepository ? (
                  <Typography className="changes-empty">Esta pasta não está dentro de um repositório Git.</Typography>
                ) : projectChanges.changes.length === 0 ? (
                  <Typography className="changes-empty">Nenhuma mudança Git detectada neste projeto.</Typography>
                ) : projectChanges.changes.map((change) => (
                  <Box className="change-row" key={`${change.statusCode}:${change.relativePath}`} title={change.absolutePath}>
                    <InsertDriveFileOutlinedIcon sx={{ flex: '0 0 auto', fontSize: 15, color: '#868b94' }} />
                    <Typography className="change-path">{change.relativePath}</Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={changeColor(change.kind)}
                      label={`${change.changedDuringSession ? 'Nesta sessão · ' : 'Já existia · '}${changeLabel(change.kind)} · ${change.statusCode.trim() || '??'}`}
                      sx={{ height: 19, flex: '0 0 auto', fontSize: 9, '& .MuiChip-label': { px: 0.75 } }}
                    />
                    <Tooltip title="Abrir arquivo no PhpStorm">
                      <IconButton
                        size="small"
                        aria-label={`Abrir ${change.relativePath} no PhpStorm`}
                        onClick={() => void openInPhpStorm(change.relativePath)}
                        disabled={openingPhpStorm !== null}
                        sx={{ width: 24, height: 24, flex: '0 0 auto', color: '#a7abb3' }}
                      >
                        <OpenInNewRoundedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
              </Box>
            </Box>
            <Box className="terminal-wrap">
              <TerminalPanel runtime={selectedRuntime} />
            </Box>
          </>
        ) : selectedHistoryCurrent ? (
          <HistoryDetails
            session={selectedHistoryCurrent}
            onResume={() => void handleStart(selectedHistoryCurrent.provider, selectedHistoryCurrent.cwd, selectedHistoryCurrent)}
          />
        ) : (
          <WelcomePanel onNew={openNewDialog} />
        )}
      </Box>

      <Dialog open={newDialogOpen} onClose={() => !starting && setNewDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 0.6, fontWeight: 700 }}>Iniciar sessão</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <Typography sx={{ mb: 1.3, color: 'text.secondary', fontSize: 12.5 }}>
            Escolha o CLI e a pasta de trabalho. A sessão abrirá em um terminal interativo.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2.3 }}>
            <ProviderChoice provider="codex" selected={newProvider === 'codex'} disabled={!library?.commands.codex} onClick={() => setNewProvider('codex')} />
            <ProviderChoice provider="claude" selected={newProvider === 'claude'} disabled={!library?.commands.claude} onClick={() => setNewProvider('claude')} />
          </Stack>
          <Typography sx={{ mb: 0.7, fontSize: 11.5, color: 'text.secondary', fontWeight: 650 }}>Pasta do projeto</Typography>
          <Stack direction="row" spacing={1}>
            <TextField size="small" fullWidth value={newCwd} placeholder="/home/usuario/projetos/app" onChange={(event) => setNewCwd(event.target.value)} />
            <Button variant="outlined" color="inherit" onClick={() => void chooseFolder()} sx={{ flexShrink: 0, color: '#d6d8dc', borderColor: 'rgba(255,255,255,.15)' }}>
              <FolderOpenRoundedIcon sx={{ mr: 0.7, fontSize: 18 }} /> Escolher
            </Button>
          </Stack>
          {library && !providerAvailable && (
            <Alert severity="warning" sx={{ mt: 1.5, fontSize: 12 }}>
              O executável {newProvider} não foi encontrado no PATH atual.
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setNewDialogOpen(false)} disabled={starting}>Cancelar</Button>
          <Button
            variant="contained"
            startIcon={starting ? <CircularProgress color="inherit" size={15} /> : <PlayArrowRoundedIcon />}
            disabled={starting || !providerAvailable || !newCwd || !newCwd.startsWith('/')}
            onClick={() => void handleStart(newProvider, newCwd)}
          >
            Abrir terminal
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(snackbar)} autoHideDuration={4300} onClose={() => setSnackbar(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snackbar ? <Alert severity={snackbar.severity} variant="filled" onClose={() => setSnackbar(null)} sx={{ width: '100%' }}>{snackbar.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

function DesktopBridgeNotice() {
  const runningInElectron = navigator.userAgent.toLowerCase().includes('electron');
  return (
    <Box className="app-shell" sx={{ alignItems: 'center', justifyContent: 'center', p: 3 }}>
      <Paper
        variant="outlined"
        sx={{
          width: 'min(560px, 100%)',
          p: { xs: 3, sm: 4 },
          textAlign: 'center',
          borderColor: 'rgba(255,255,255,.09)',
          background: 'radial-gradient(ellipse at 50% 0%, rgba(255,118,41,.09), transparent 56%), #101214',
        }}
      >
        <Avatar sx={{ width: 58, height: 58, mx: 'auto', mb: 2, bgcolor: 'rgba(255,118,41,.12)', color: 'primary.light', border: '1px solid rgba(255,118,41,.18)' }}>
          <DesktopWindowsRoundedIcon sx={{ fontSize: 27 }} />
        </Avatar>
        <Typography variant="h5" sx={{ fontSize: 21, mb: 1 }}>
          {runningInElectron ? 'A ponte do Electron não carregou' : 'Abra o Agent Desk pela janela do app'}
        </Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: 13, lineHeight: 1.7 }}>
          {runningInElectron
            ? 'Esta janela Electron não recebeu a API preload necessária para controlar os terminais. Feche-a e confira no terminal se houve erro ao carregar electron/preload.cjs.'
            : 'Esta página está aberta no navegador. O endereço do Vite serve apenas a interface de desenvolvimento; o controle de sessões funciona na janela Electron que é aberta pelo comando abaixo.'}
        </Typography>
        <Paper component="code" variant="outlined" sx={{ display: 'block', mt: 2.3, p: 1.5, color: '#ffad7b', fontFamily: 'ui-monospace, monospace', fontSize: 12, textAlign: 'left', overflowX: 'auto' }}>
          npm run dev
        </Paper>
        {!runningInElectron && (
          <Typography sx={{ mt: 1.5, color: '#737982', fontSize: 11.5 }}>
            Depois, use a janela “Agent Desk” aberta pelo Electron; não precisa abrir <code>127.0.0.1:5173</code> no Firefox.
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

function HubGlyph() {
  return <CodeRoundedIcon sx={{ fontSize: 19 }} />;
}

function ProviderStatus({ provider, command }: { provider: Provider; command: string | null }) {
  const label = provider === 'codex' ? 'Codex CLI' : 'Claude Code';
  return (
    <Stack direction="row" spacing={0.8} alignItems="center" title={command || `${label} não localizado`}>
      <ProviderGlyph provider={provider} size={14} />
      <Typography sx={{ color: '#a8acb4', fontSize: 10.5, flex: 1 }}>{label}</Typography>
      <span className={`status-dot ${command ? '' : 'gray'}`} />
      <Typography sx={{ color: command ? '#83c6a0' : '#777c84', fontSize: 9.5 }}>{command ? 'instalado' : 'não encontrado'}</Typography>
    </Stack>
  );
}

function ProviderChoice({ provider, selected, disabled, onClick }: { provider: Provider; selected: boolean; disabled: boolean; onClick: () => void }) {
  const label = provider === 'codex' ? 'Codex CLI' : 'Claude Code';
  return (
    <Paper
      variant="outlined"
      onClick={() => !disabled && onClick()}
      sx={{
        flex: 1,
        px: 1.4,
        py: 1.25,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.42 : 1,
        borderColor: selected ? 'primary.main' : 'divider',
        background: selected ? 'rgba(255,118,41,.08)' : 'background.paper',
      }}
    >
      <ProviderGlyph provider={provider} size={19} />
      <Typography sx={{ fontSize: 12.5, fontWeight: selected ? 700 : 550 }}>{label}</Typography>
      {selected && <CircleRoundedIcon sx={{ ml: 'auto', fontSize: 9, color: 'primary.main' }} />}
    </Paper>
  );
}

function HistoryDetails({ session, onResume }: { session: AgentSession; onResume: () => void }) {
  const status = activityLabel(session.activity);
  return (
    <Box className="session-detail">
      <Box className="detail-card">
        <Stack direction="row" spacing={1.4} alignItems="center" sx={{ mb: 2.2 }}>
          <Avatar sx={{ width: 44, height: 44, bgcolor: 'rgba(255,118,41,.12)', border: '1px solid rgba(255,118,41,.18)' }}>
            <ProviderGlyph provider={session.provider} size={22} />
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>{session.title}</Typography>
            <Typography sx={{ mt: 0.3, color: 'text.secondary', fontSize: 11.5 }}>
              {session.provider === 'codex' ? 'Codex CLI' : 'Claude Code'} · {relativeTime(session.updatedAt)}
            </Typography>
          </Box>
          <Chip size="small" label={status.label} color={status.color} variant={session.activity === 'unknown' ? 'outlined' : 'filled'} sx={{ height: 24, fontSize: 10 }} />
        </Stack>
        <Divider sx={{ mb: 2 }} />
        <Stack spacing={1.2}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <FolderOpenRoundedIcon sx={{ fontSize: 17, color: 'text.secondary', mt: 0.1 }} />
            <Box>
              <Typography sx={{ mb: 0.4, color: 'text.secondary', fontSize: 10.5, fontWeight: 650 }}>DIRETÓRIO</Typography>
              <Typography className="path-line">{session.cwd}</Typography>
            </Box>
          </Stack>
          {session.branch && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CodeRoundedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography sx={{ color: 'text.secondary', fontSize: 11.5 }}>{session.branch}</Typography>
            </Stack>
          )}
          <Stack direction="row" spacing={1} alignItems="center">
            <TerminalRoundedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography sx={{ color: 'text.secondary', fontSize: 10.5, fontFamily: 'ui-monospace, monospace' }}>{session.sessionId}</Typography>
          </Stack>
        </Stack>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2.7 }}>
          <Button variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={onResume} disabled={!session.available}>
            Retomar sessão
          </Button>
        </Stack>
        {!session.available && (
          <Alert severity="warning" sx={{ mt: 1.5, fontSize: 11.5 }}>
            Essa pasta não existe mais neste computador. O histórico continua listado, mas não pode ser retomado nesse caminho.
          </Alert>
        )}
      </Box>
    </Box>
  );
}

function WelcomePanel({ onNew }: { onNew: () => void }) {
  return (
    <Box className="empty-state">
      <Box className="welcome-card">
        <Box className="welcome-icon"><TerminalRoundedIcon sx={{ fontSize: 27 }} /></Box>
        <Typography sx={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.025em' }}>Um lugar para acompanhar seus agentes</Typography>
        <Typography sx={{ mt: 1, mb: 2.5, color: 'text.secondary', fontSize: 12.5, lineHeight: 1.7 }}>
          Escolha uma sessão no histórico para retomá-la ou abra um novo terminal Codex ou Claude em qualquer pasta.
        </Typography>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={onNew}>Iniciar uma sessão</Button>
        <Stack direction="row" justifyContent="center" spacing={2.2} sx={{ mt: 3.1 }}>
          <Stack direction="row" spacing={0.7} alignItems="center"><ProviderGlyph provider="codex" size={15} /><Typography sx={{ color: 'text.secondary', fontSize: 10.5 }}>Codex CLI</Typography></Stack>
          <Stack direction="row" spacing={0.7} alignItems="center"><ProviderGlyph provider="claude" size={15} /><Typography sx={{ color: 'text.secondary', fontSize: 10.5 }}>Claude Code</Typography></Stack>
        </Stack>
      </Box>
    </Box>
  );
}

export default App;
