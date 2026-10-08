export type Provider = 'codex' | 'claude';
export type Activity = 'working' | 'done' | 'unknown';

export interface AgentSession {
  id: string;
  provider: Provider;
  sessionId: string;
  cwd: string;
  title: string;
  branch: string | null;
  updatedAt: number;
  available: boolean;
  activity: Activity;
}

export interface DirectoryNode {
  name: string;
  path: string;
  sessions: AgentSession[];
  directories: DirectoryNode[];
}

export interface RuntimeSession {
  id: string;
  provider: Provider;
  cwd: string;
  sessionId: string | null;
  title: string;
  startedAt: number;
}

export interface ProjectChange {
  relativePath: string;
  absolutePath: string;
  statusCode: string;
  kind: 'untracked' | 'conflict' | 'renamed' | 'deleted' | 'added' | 'modified';
  changedDuringSession: boolean;
}

export interface ProjectChangesSnapshot {
  runtimeId: string;
  projectRoot: string;
  isGitRepository: boolean;
  changes: ProjectChange[];
}

export interface RuntimeExit {
  runtimeId: string;
  exitCode: number;
  signal?: number;
}

export interface LibrarySnapshot {
  sessions: AgentSession[];
  tree: DirectoryNode;
  roots: { codex: string; codexIndex: string; codexState: string | null; claude: string; workspace: string };
  commands: { codex: string | null; claude: string | null };
}

export interface AgentDeskBridge {
  scanLibrary: () => Promise<LibrarySnapshot>;
  chooseDirectory: (defaultPath?: string) => Promise<string | null>;
  startRuntime: (request: {
    provider: Provider;
    cwd: string;
    sessionId?: string;
    title?: string;
    cols?: number;
    rows?: number;
  }) => Promise<RuntimeSession>;
  attachTerminal: (runtimeId: string) => Promise<{ output: string; sequence: number; running: boolean }>;
  writeTerminal: (runtimeId: string, data: string) => void;
  resizeTerminal: (runtimeId: string, cols: number, rows: number) => void;
  stopRuntime: (runtimeId: string) => Promise<boolean>;
  listRuntimes: () => Promise<Array<RuntimeSession & { processId: number; running: boolean; startedAt: number }>>;
  getProjectChanges: (runtimeId: string) => Promise<ProjectChangesSnapshot>;
  openInPhpStorm: (runtimeId: string, relativePath?: string) => Promise<{ projectRoot: string; target: string; openedFile: boolean }>;
  onTerminalData: (callback: (payload: { runtimeId: string; sequence: number; data: string }) => void) => () => void;
  onRuntimeExit: (callback: (payload: RuntimeExit) => void) => () => void;
}

declare global {
  interface Window {
    agentDesk: AgentDeskBridge;
  }
}

export {};
