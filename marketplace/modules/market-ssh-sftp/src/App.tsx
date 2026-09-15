import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import TerminalPane from './TerminalPane';
import {
  sdk,
  type SftpEntry,
  type SshAuthMethod,
  type SshEvent,
  type SshProxyConnectParams,
  type SshSessionSummary,
} from './sdk';
import type {
  ConnectionLogEntry,
  ConnectionProfile,
  Group,
  SessionTab,
  TerminalHistory,
  TerminalPaneState,
} from './types';
import styles from './App.module.css';

const GROUPS_KEY = 'ssh-sftp.groups.v1';
const PROFILES_KEY = 'ssh-sftp.profiles.v1';
const DEFAULT_GROUP: Group = { id: 'general', name: 'General' };
const MAX_TERMINAL_HISTORY = 240_000;
const MAX_TRANSFER_BYTES = 50 * 1024 * 1024;

type WorkspaceMode = 'terminal' | 'sftp';
type Draft = Omit<ConnectionProfile, 'id'> & { id?: string };
type KeyboardPrompt = Extract<SshEvent, { type: 'keyboardInteractive' }>;
type ProfileConnectionStatus = 'connected' | 'connecting' | 'error' | 'disconnected';
type ProfileHoldStatus = 'none' | 'running' | 'starting' | 'stopped';
type ProfileRuntime = {
  connection: ProfileConnectionStatus;
  hold: ProfileHoldStatus;
};
type TestConnectionState = {
  status: 'idle' | 'testing' | 'success' | 'error';
  message: string;
};
type FolderPickerStatus = {
  status: 'idle' | 'connecting' | 'error';
  message: string;
};
type GroupEditorState = {
  mode: 'create' | 'rename';
  groupId?: string;
  value: string;
  error: string;
};
type DraftConnectionResult = {
  sessionId: string;
  holdEnabled: boolean;
  ownedHold: boolean;
  profileId?: string;
};
type DraftHoldSession = {
  sessionId: string;
  profileId: string;
};
type FolderPickerState = {
  sessionId: string;
  ownsSession: boolean;
  path: string;
  input: string;
  entries: SftpEntry[];
  loading: boolean;
  error: string;
};

type ResultLike = { ok: boolean; data?: unknown; error?: { message?: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slug(value: string): string {
  const out = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || newId('group');
}

function normalizePort(value: unknown): number {
  const port = Math.floor(asNumber(value, 22));
  return port >= 1 && port <= 65535 ? port : 0;
}

function normalizeSftpStartPath(value: unknown): string {
  const path = asString(value, '/').trim();
  return !path || path === '.' ? '/' : path;
}

function normalizeAuth(value: unknown): SshAuthMethod {
  if (value === 'privateKey' || value === 'agent' || value === 'keyboard-interactive') return value;
  return 'password';
}

function parseGroups(value: unknown): Group[] {
  if (!Array.isArray(value)) return [DEFAULT_GROUP];
  const result = value
    .filter(isRecord)
    .map((item) => ({ id: asString(item.id).trim(), name: asString(item.name).trim() }))
    .filter((item) => item.id && item.name);
  const withoutDuplicates = result.filter(
    (item, index) => result.findIndex((other) => other.id === item.id) === index,
  );
  return withoutDuplicates.length ? withoutDuplicates : [DEFAULT_GROUP];
}

function parseProfiles(value: unknown, groups: Group[]): ConnectionProfile[] {
  if (!Array.isArray(value)) return [];
  const validGroupIds = new Set(groups.map((group) => group.id));
  return value
    .filter(isRecord)
    .map((item) => ({
      id: asString(item.id).trim(),
      groupId: validGroupIds.has(asString(item.groupId).trim())
        ? asString(item.groupId).trim()
        : DEFAULT_GROUP.id,
      name: asString(item.name).trim(),
      host: asString(item.host).trim(),
      port: normalizePort(item.port),
      username: asString(item.username).trim(),
      authMethod: normalizeAuth(item.authMethod),
      password: asString(item.password),
      privateKey: asString(item.privateKey),
      passphrase: asString(item.passphrase),
      agent: asString(item.agent),
      hostFingerprint: asString(item.hostFingerprint).trim(),
      sftpStartPath: normalizeSftpStartPath(item.sftpStartPath),
      hold: item.hold === true,
      proxy: item.proxy === true,
      proxyProfileId: asString(item.proxyProfileId).trim(),
    }))
    .filter((item) => item.id && item.name && item.host && item.port && item.username);
}

function getStatusLabel(status: SessionTab['status']): string {
  if (status === 'ready') return 'Connected';
  if (status === 'connecting') return 'Connecting';
  if (status === 'error') return 'Error';
  return 'Closed';
}

function getStatusClass(status: SessionTab['status']): string {
  if (status === 'ready') return styles.statusReady;
  if (status === 'connecting') return styles.statusConnecting;
  if (status === 'error') return styles.statusError;
  return styles.statusClosed;
}

function getProfileConnectionLabel(status: ProfileConnectionStatus): string {
  if (status === 'connected') return 'SSH已连接';
  if (status === 'connecting') return 'SSH连接中';
  if (status === 'error') return 'SSH失败';
  return 'SSH未连接';
}

function getProfileHoldLabel(status: ProfileHoldStatus): string {
  if (status === 'running') return 'HOLD运行中';
  if (status === 'starting') return 'HOLD启动中';
  if (status === 'stopped') return 'HOLD未运行';
  return '';
}

function getProfileDotClass(status: ProfileConnectionStatus): string {
  if (status === 'connected') return styles.profileDotConnected;
  if (status === 'connecting') return styles.profileDotConnecting;
  if (status === 'error') return styles.profileDotError;
  return styles.profileDotDisconnected;
}

function getProfileConnectionBadgeClass(status: ProfileConnectionStatus): string {
  if (status === 'connected') return styles.profileRuntimeConnected;
  if (status === 'connecting') return styles.profileRuntimeConnecting;
  if (status === 'error') return styles.profileRuntimeError;
  return styles.profileRuntimeDisconnected;
}

function getProfileHoldBadgeClass(status: ProfileHoldStatus): string {
  if (status === 'running') return styles.profileHoldRunning;
  if (status === 'starting') return styles.profileHoldStarting;
  if (status === 'stopped') return styles.profileHoldStopped;
  return '';
}

function getDisconnectLabel(session: SessionTab): string {
  if (session.status === 'connecting') return 'Cancel';
  if (session.status === 'error') return 'Close tab';
  return session.hold ? 'Stop hold' : 'Disconnect';
}

function getConnectionFlowTitle(status: SessionTab['status']): string {
  if (status === 'error') return 'Connection failed';
  if (status === 'connecting') return 'Connecting to remote host';
  return 'SSH session';
}

function getConnectionFlowDescription(status: SessionTab['status']): string {
  if (status === 'error') return 'Review the log details, update the profile if needed, then retry.';
  if (status === 'connecting') return 'The terminal will open automatically after authentication succeeds.';
  return '';
}

function getLogClass(level: ConnectionLogEntry['level']): string {
  if (level === 'success') return styles.connectionLogSuccess;
  if (level === 'warn') return styles.connectionLogWarn;
  if (level === 'error') return styles.connectionLogError;
  return styles.connectionLogInfo;
}

function connectionConfigChanged(a: ConnectionProfile, b: ConnectionProfile): boolean {
  return (
    a.hold !== b.hold ||
    a.proxy !== b.proxy ||
    (a.proxyProfileId ?? '') !== (b.proxyProfileId ?? '') ||
    a.host !== b.host ||
    a.port !== b.port ||
    a.username !== b.username ||
    a.authMethod !== b.authMethod ||
    (a.password ?? '') !== (b.password ?? '') ||
    (a.privateKey ?? '') !== (b.privateKey ?? '') ||
    (a.passphrase ?? '') !== (b.passphrase ?? '') ||
    (a.agent ?? '') !== (b.agent ?? '') ||
    (a.hostFingerprint ?? '') !== (b.hostFingerprint ?? '')
  );
}

function makePane(): TerminalPaneState {
  return { id: newId('pane'), terminalId: newId('terminal') };
}

function joinRemotePath(base: string, name: string): string {
  if (base === '/') return `/${name}`;
  return `${base.replace(/\/$/, '')}/${name}`;
}

function parentRemotePath(value: string): string {
  if (!value || value === '/') return '/';
  const trimmed = value.replace(/\/$/, '');
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) return '/';
  return trimmed.slice(0, index);
}

function remotePathBreadcrumbs(value: string): Array<{ label: string; path: string }> {
  const trimmed = value.trim() || '.';
  if (trimmed === '.') return [{ label: '.', path: '.' }];
  const normalized = trimmed === '/' ? '/' : trimmed.replace(/\/$/, '');
  if (normalized.startsWith('/')) {
    const parts = normalized.split('/').filter(Boolean);
    const crumbs = [{ label: '/', path: '/' }];
    parts.forEach((part, index) => {
      crumbs.push({ label: part, path: `/${parts.slice(0, index + 1).join('/')}` });
    });
    return crumbs;
  }
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return [{ label: normalized, path: normalized }];
  return parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join('/') }));
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let output = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(output);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function resultError(result: ResultLike, fallback: string): string {
  return result.error?.message || fallback;
}

function makeConnectionLog(level: ConnectionLogEntry['level'], message: string): ConnectionLogEntry {
  return { id: newId('log'), at: new Date().toISOString(), level, message };
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function trimLogs(logs: ConnectionLogEntry[]): ConnectionLogEntry[] {
  return logs.length > 120 ? logs.slice(-120) : logs;
}

function buildProfileRuntime(
  profile: ConnectionProfile,
  tabs: SessionTab[],
  transports: SshSessionSummary[],
): ProfileRuntime {
  const tabMatches = tabs.filter((tab) => tab.profileId === profile.id);
  const transportMatches = transports.filter((transport) => transport.profileId === profile.id);
  const allStatuses = [...tabMatches, ...transportMatches].map((item) => item.status);
  const connection = allStatuses.includes('ready')
    ? 'connected'
    : allStatuses.includes('connecting')
      ? 'connecting'
      : allStatuses.includes('error')
        ? 'error'
        : 'disconnected';

  const holdEnabled = profile.hold === true || profile.proxy === true;
  if (!holdEnabled) return { connection, hold: 'none' };

  const holdStatuses = [...tabMatches, ...transportMatches]
    .filter((item) => item.hold)
    .map((item) => item.status);
  const hold = holdStatuses.includes('ready')
    ? 'running'
    : holdStatuses.includes('connecting')
      ? 'starting'
      : 'stopped';

  return { connection, hold };
}

function emptyDraft(groupId: string): Draft {
  return {
    groupId,
    name: '',
    host: '',
    port: 22,
    username: '',
    authMethod: 'password',
    password: '',
    privateKey: '',
    passphrase: '',
    agent: '',
    hostFingerprint: '',
    sftpStartPath: '/',
    hold: false,
    proxy: false,
    proxyProfileId: '',
  };
}

function toProxyConnectParams(profile: ConnectionProfile): SshProxyConnectParams {
  return {
    sessionId: `proxy-${profile.id}`,
    profileId: profile.id,
    name: profile.name,
    holdKey: profile.id,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authMethod: profile.authMethod,
    password: profile.password,
    privateKey: profile.privateKey,
    passphrase: profile.passphrase,
    agent: profile.agent,
    hostFingerprint: profile.hostFingerprint,
  };
}

export default function App() {
  const [groups, setGroups] = useState<Group[]>([DEFAULT_GROUP]);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('all');
  const [groupEditor, setGroupEditor] = useState<GroupEditorState | null>(null);
  const [deleteGroupCandidate, setDeleteGroupCandidate] = useState<Group | null>(null);
  const [profileQuery, setProfileQuery] = useState('');
  const [sessions, setSessions] = useState<Record<string, SessionTab>>({});
  const [backendSessions, setBackendSessions] = useState<SshSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [terminalHistory, setTerminalHistory] = useState<TerminalHistory>({});
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('terminal');
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(DEFAULT_GROUP.id));
  const [privateKeyFileName, setPrivateKeyFileName] = useState('');
  const [testConnection, setTestConnection] = useState<TestConnectionState>({
    status: 'idle',
    message: '',
  });
  const [draftHoldSession, setDraftHoldSession] = useState<DraftHoldSession | null>(null);
  const [folderPicker, setFolderPicker] = useState<FolderPickerState | null>(null);
  const [folderPickerStatus, setFolderPickerStatus] = useState<FolderPickerStatus>({
    status: 'idle',
    message: '',
  });
  const [connectAfterSave, setConnectAfterSave] = useState(false);
  const [keyboardPrompt, setKeyboardPrompt] = useState<KeyboardPrompt | null>(null);
  const [keyboardAnswers, setKeyboardAnswers] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [storageReady, setStorageReady] = useState(false);
  const privateKeyFileRef = useRef<HTMLInputElement | null>(null);

  const profileMap = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const sessionList = useMemo(() => Object.values(sessions), [sessions]);
  const profileRuntimeMap = useMemo(() => {
    const tabs = Object.values(sessions);
    return new Map(
      profiles.map((profile) => [profile.id, buildProfileRuntime(profile, tabs, backendSessions)]),
    );
  }, [backendSessions, profiles, sessions]);
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const activeProfile = activeSession ? profileMap.get(activeSession.profileId) : undefined;
  const showConnectionLog =
    Boolean(activeSession) && (activeSession?.status === 'connecting' || activeSession?.status === 'error');
  const draftProxyCandidates = useMemo(
    () => profiles.filter((profile) => profile.proxy && profile.id !== draft.id),
    [draft.id, profiles],
  );

  const persistGroups = useCallback(async (next: Group[]) => {
    setGroups(next);
    await sdk.storage.set(GROUPS_KEY, next);
  }, []);

  const persistProfiles = useCallback(async (next: ConnectionProfile[]) => {
    setProfiles(next);
    await sdk.storage.set(PROFILES_KEY, next);
  }, []);

  const addNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? '' : current)), 6000);
  }, []);

  const refreshBackendSessions = useCallback(async () => {
    const result = await sdk.ssh.listSessions();
    if (!result.ok || !result.data) return;
    setBackendSessions(result.data);
  }, []);

  const appendTabLog = useCallback((tabId: string, level: ConnectionLogEntry['level'], message: string) => {
    setSessions((current) => {
      const tab = current[tabId];
      if (!tab) return current;
      return {
        ...current,
        [tabId]: { ...tab, logs: trimLogs([...(tab.logs ?? []), makeConnectionLog(level, message)]) },
      };
    });
  }, []);

  const clearTabLogs = useCallback((tabId: string) => {
    setSessions((current) => {
      const tab = current[tabId];
      if (!tab) return current;
      return { ...current, [tabId]: { ...tab, logs: [] } };
    });
  }, []);

  const appendSessionLog = useCallback(
    (
      sessionId: string | undefined,
      level: ConnectionLogEntry['level'],
      message: string,
      terminalId?: string,
    ) => {
      if (!sessionId) return;
      setSessions((current) => {
        let changed = false;
        const next = { ...current };
        Object.values(current).forEach((tab) => {
          if (tab.sessionId !== sessionId) return;
          if (terminalId && !tab.panes.some((pane) => pane.terminalId === terminalId)) return;
          changed = true;
          next[tab.tabId] = {
            ...tab,
            logs: trimLogs([...(tab.logs ?? []), makeConnectionLog(level, message)]),
          };
        });
        return changed ? next : current;
      });
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const [groupsResult, profilesResult] = await Promise.all([
        sdk.storage.get(GROUPS_KEY),
        sdk.storage.get(PROFILES_KEY),
      ]);
      const nextGroups = groupsResult.ok ? parseGroups(groupsResult.data) : [DEFAULT_GROUP];
      const nextProfiles = profilesResult.ok ? parseProfiles(profilesResult.data, nextGroups) : [];
      setGroups(nextGroups);
      setProfiles(nextProfiles);
      setStorageReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    if (selectedGroupId !== 'all' && !groups.some((group) => group.id === selectedGroupId))
      setSelectedGroupId('all');
  }, [groups, selectedGroupId, storageReady]);

  useEffect(() => {
    void refreshBackendSessions();
    const timer = window.setInterval(() => void refreshBackendSessions(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshBackendSessions]);

  useEffect(() => {
    const off = sdk.ssh.onEvent((raw) => {
      const event = raw as SshEvent;
      if (event.type === 'status') {
        setBackendSessions((current) => {
          const next = current.filter((session) => session.sessionId !== event.sessionId);
          if (event.status.status === 'closed' || event.status.status === 'error') return next;
          return [...next, event.status];
        });
        setSessions((current) => {
          const next = { ...current };
          Object.values(current).forEach((tab) => {
            if (
              tab.sessionId !== event.sessionId ||
              (event.status.terminalId &&
                !tab.panes.some((pane) => pane.terminalId === event.status.terminalId))
            )
              return;
            const {
              sessionId: _sessionId,
              terminalId: _terminalId,
              output: _output,
              ...statusFields
            } = event.status;
            next[tab.tabId] = { ...tab, ...statusFields };
          });
          if (event.status.output && event.status.terminalId) {
            setTerminalHistory((history) => ({
              ...history,
              [event.status.terminalId as string]:
                event.status.output ?? history[event.status.terminalId as string] ?? '',
            }));
          }
          return next;
        });
        return;
      }
      if (event.type === 'data') {
        const terminalId = event.terminalId;
        if (!terminalId) return;
        setTerminalHistory((current) => {
          const nextValue = `${current[terminalId] ?? ''}${event.data}`;
          return {
            ...current,
            [terminalId]:
              nextValue.length > MAX_TERMINAL_HISTORY ? nextValue.slice(-MAX_TERMINAL_HISTORY) : nextValue,
          };
        });
        return;
      }
      if (event.type === 'keyboardInteractive') {
        appendSessionLog(
          event.sessionId,
          'info',
          'Server requested keyboard-interactive authentication input.',
          event.terminalId,
        );
        setKeyboardPrompt(event);
        setKeyboardAnswers(event.prompts.map(() => ''));
        return;
      }
      if (event.type === 'hostKey' && !event.verified) {
        appendSessionLog(
          event.sessionId,
          'warn',
          `Host key was accepted without a pinned fingerprint: ${event.fingerprint}`,
        );
        return;
      }
      if (event.type === 'hostKey' && event.verified) {
        appendSessionLog(event.sessionId, 'info', `Host key fingerprint verified: ${event.fingerprint}`);
        return;
      }
      if (event.type === 'log') {
        appendSessionLog(event.sessionId, event.level, event.message, event.terminalId);
      }
    });
    return () => {
      off();
    };
  }, [appendSessionLog]);

  useEffect(() => {
    void sdk.ssh.listSessions().then((result) => {
      if (!result.ok || !result.data) return;
      setBackendSessions(result.data);
      setSessions((current) => {
        const next = { ...current };
        const existingTransportIds = new Set(Object.values(current).map((tab) => tab.sessionId));
        result.data?.forEach((summary) => {
          if (summary.hidden) return;
          if (existingTransportIds.has(summary.sessionId)) return;
          const profile =
            (summary.profileId ? profiles.find((item) => item.id === summary.profileId) : undefined) ??
            profiles.find((item) => item.host === summary.host && item.username === summary.username);
          const tabId = newId('tab');
          const terminalId = summary.terminalId ?? newId('terminal');
          next[tabId] = {
            ...summary,
            tabId,
            terminalId,
            profileId: profile?.id ?? '',
            profileName: profile?.name ?? `${summary.username}@${summary.host}`,
            title: profile?.name ?? `${summary.username}@${summary.host}`,
            logs: [
              makeConnectionLog(
                summary.status === 'ready' ? 'success' : 'info',
                `Restored ${summary.status} SSH session for ${summary.username}@${summary.host}:${summary.port}.`,
              ),
            ],
            panes: [{ id: newId('pane'), terminalId }],
            splitOrientation: null,
          };
          if (summary.output) {
            setTerminalHistory((history) => ({ ...history, [terminalId]: summary.output ?? '' }));
          }
        });
        return next;
      });
    });
  }, [profiles]);

  const visibleProfiles = useMemo(() => {
    const query = profileQuery.trim().toLowerCase();
    return profiles
      .filter((profile) => selectedGroupId === 'all' || profile.groupId === selectedGroupId)
      .filter(
        (profile) =>
          !query || `${profile.name} ${profile.host} ${profile.username}`.toLowerCase().includes(query),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profileQuery, profiles, selectedGroupId]);

  const groupCounts = useMemo(() => {
    const result = new Map<string, number>();
    profiles.forEach((profile) => result.set(profile.groupId, (result.get(profile.groupId) ?? 0) + 1));
    return result;
  }, [profiles]);

  const openCreate = () => {
    setDraft(emptyDraft(selectedGroupId === 'all' ? DEFAULT_GROUP.id : selectedGroupId));
    setPrivateKeyFileName('');
    setTestConnection({ status: 'idle', message: '' });
    setDraftHoldSession(null);
    setFolderPicker(null);
    setFolderPickerStatus({ status: 'idle', message: '' });
    setConnectAfterSave(false);
    setDraftOpen(true);
  };

  const openEdit = (profile: ConnectionProfile) => {
    setDraft({ ...profile });
    setPrivateKeyFileName(profile.privateKey ? 'Existing private key' : '');
    setTestConnection({ status: 'idle', message: '' });
    setDraftHoldSession(null);
    setFolderPicker(null);
    setFolderPickerStatus({ status: 'idle', message: '' });
    setConnectAfterSave(false);
    setDraftOpen(true);
  };

  const openProfileTab = useCallback(
    async (profile: ConnectionProfile, options: { requestSessionId?: string; title?: string } = {}) => {
      const proxyProfile = profile.proxyProfileId ? profileMap.get(profile.proxyProfileId) : undefined;
      if (profile.proxyProfileId && !proxyProfile) {
        addNotice('The selected SSH proxy profile could not be found.');
        return undefined;
      }
      const tabId = newId('tab');
      const requestSessionId = options.requestSessionId ?? newId('session');
      const pane = makePane();
      const initialLogs = [
        makeConnectionLog('info', `Connecting to ${profile.username}@${profile.host}:${profile.port}...`),
        ...(proxyProfile
          ? [
              makeConnectionLog(
                'info',
                `Using SSH proxy ${proxyProfile.name} (${proxyProfile.username}@${proxyProfile.host}:${proxyProfile.port}).`,
              ),
            ]
          : []),
      ];
      const initialTab: SessionTab = {
        tabId,
        sessionId: requestSessionId,
        terminalId: pane.terminalId,
        hold: Boolean(profile.hold),
        holdKey: profile.hold ? profile.id : undefined,
        profileId: profile.id,
        profileName: profile.name,
        title: options.title?.trim() || profile.name,
        logs: initialLogs,
        panes: [pane],
        splitOrientation: null,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        status: 'connecting',
        proxyProfileId: proxyProfile?.id,
        proxyName: proxyProfile?.name,
        proxyHost: proxyProfile?.host,
        proxyUsername: proxyProfile?.username,
      };
      setSessions((current) => ({ ...current, [tabId]: initialTab }));
      setActiveSessionId(tabId);
      setWorkspaceMode('terminal');

      const result = await sdk.ssh.connect({
        sessionId: requestSessionId,
        terminalId: pane.terminalId,
        profileId: profile.id,
        hold: Boolean(profile.hold),
        holdKey: profile.hold ? profile.id : undefined,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        authMethod: profile.authMethod,
        password: profile.password,
        privateKey: profile.privateKey,
        passphrase: profile.passphrase,
        agent: profile.agent,
        hostFingerprint: profile.hostFingerprint,
        proxy: proxyProfile ? toProxyConnectParams(proxyProfile) : undefined,
      });
      if (!result.ok || !result.data) {
        setBackendSessions((current) => current.filter((session) => session.sessionId !== requestSessionId));
        setSessions((current) => {
          const existing = current[tabId];
          if (!existing) return current;
          return {
            ...current,
            [tabId]: {
              ...existing,
              status: 'error',
              logs: trimLogs([
                ...(existing.logs ?? []),
                makeConnectionLog(
                  'error',
                  `Connection failed: ${resultError(result, `Unable to connect to ${profile.host}`)}`,
                ),
              ]),
            },
          };
        });
        return undefined;
      }

      const summary = result.data;
      const resolvedTerminalId = summary.terminalId ?? pane.terminalId;
      setSessions((current) => ({
        ...current,
        [tabId]: {
          ...current[tabId],
          ...summary,
          tabId,
          terminalId: resolvedTerminalId,
          profileId: profile.id,
          profileName: profile.name,
          title: options.title?.trim() || profile.name,
          logs: trimLogs([
            ...(current[tabId]?.logs ?? initialLogs),
            makeConnectionLog('success', 'Connection established and interactive shell is ready.'),
          ]),
          panes: [{ ...pane, terminalId: resolvedTerminalId }],
          splitOrientation: null,
        },
      }));
      setTerminalHistory((current) => ({
        ...current,
        [resolvedTerminalId]: summary.output ?? current[resolvedTerminalId] ?? '',
      }));
      setActiveSessionId(tabId);
      return { tabId, summary: { ...summary, terminalId: resolvedTerminalId } };
    },
    [addNotice, profileMap],
  );

  const connectProfile = useCallback(
    async (profile: ConnectionProfile) => {
      await openProfileTab(profile);
    },
    [openProfileTab],
  );

  const connectDraftTemporary = async (
    purpose: string,
    options: { respectHold?: boolean } = {},
  ): Promise<DraftConnectionResult> => {
    const host = draft.host.trim();
    const port = normalizePort(draft.port || 22);
    const username = draft.username.trim();
    if (!host || !port || !username) {
      throw new Error('Host, port, and username are required.');
    }
    if (draft.authMethod === 'password' && !draft.password?.trim()) {
      throw new Error('Password is required for password authentication.');
    }
    if (draft.authMethod === 'privateKey' && !draft.privateKey?.trim()) {
      throw new Error('Private key is required for key authentication.');
    }
    const proxyProfile = draft.proxyProfileId ? profileMap.get(draft.proxyProfileId) : undefined;
    if (draft.proxyProfileId && !proxyProfile) {
      throw new Error('The selected SSH proxy profile could not be found.');
    }

    const holdEnabled = options.respectHold === true && (draft.hold === true || draft.proxy === true);
    let holdProfileId = draft.id?.trim();
    if (holdEnabled && !holdProfileId) {
      holdProfileId = newId('profile');
      setDraft((current) => (current.id ? current : { ...current, id: holdProfileId }));
    }
    let existingHoldSessionId = '';
    if (holdEnabled && holdProfileId) {
      const existingSessions = await sdk.ssh.listSessions();
      existingHoldSessionId =
        existingSessions.ok && existingSessions.data
          ? (existingSessions.data.find(
              (session) =>
                session.hold &&
                session.holdKey === holdProfileId &&
                (session.status === 'ready' || session.status === 'connecting'),
            )?.sessionId ?? '')
          : '';
    }
    const sessionId =
      holdEnabled && holdProfileId ? `${purpose}-hold-${holdProfileId}` : newId(`temp-${purpose}`);
    const terminalId = `${sessionId}:terminal`;
    const result = await sdk.ssh.connect({
      sessionId,
      terminalId,
      profileId: holdEnabled ? holdProfileId : undefined,
      hold: holdEnabled,
      holdKey: holdEnabled ? holdProfileId : undefined,
      host,
      port,
      username,
      authMethod: draft.authMethod,
      password: draft.password,
      privateKey: draft.privateKey,
      passphrase: draft.passphrase,
      agent: draft.agent,
      hostFingerprint: draft.hostFingerprint,
      proxy: proxyProfile ? toProxyConnectParams(proxyProfile) : undefined,
    });
    if (!result.ok || !result.data) {
      throw new Error(resultError(result, `Unable to connect to ${host}`));
    }
    return {
      sessionId: result.data.sessionId || sessionId,
      holdEnabled,
      ownedHold:
        holdEnabled && (!existingHoldSessionId || existingHoldSessionId === draftHoldSession?.sessionId),
      profileId: holdEnabled ? holdProfileId : undefined,
    };
  };

  const testDraftConnection = async () => {
    setTestConnection({ status: 'testing', message: 'Testing SSH connection…' });
    setFolderPickerStatus({ status: 'idle', message: '' });
    let connection: DraftConnectionResult | null = null;
    try {
      connection = await connectDraftTemporary('test', { respectHold: true });
      if (connection.holdEnabled && connection.profileId) {
        if (connection.ownedHold) {
          setDraftHoldSession({ sessionId: connection.sessionId, profileId: connection.profileId });
        } else {
          setDraftHoldSession(null);
        }
        setTestConnection({
          status: 'success',
          message: connection.ownedHold
            ? 'Connection test succeeded. SSH Hold is running.'
            : 'Connection test succeeded. Existing SSH Hold was reused.',
        });
      } else {
        if (draftHoldSession) {
          await sdk.ssh.disconnect(draftHoldSession.sessionId);
          setDraftHoldSession(null);
        }
        setTestConnection({ status: 'success', message: 'Connection test succeeded.' });
      }
    } catch (error) {
      setTestConnection({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (connection && !connection.holdEnabled) await sdk.ssh.disconnect(connection.sessionId);
      void refreshBackendSessions();
    }
  };

  const loadFolderPickerPath = async (sessionId: string, requestedPath: string, resolve = false) => {
    setFolderPicker((current) =>
      current && current.sessionId === sessionId ? { ...current, loading: true, error: '' } : current,
    );
    try {
      let targetPath = requestedPath.trim() || '.';
      if (resolve) {
        const resolved = await sdk.ssh.sftpRealpath(sessionId, targetPath);
        if (!resolved.ok || typeof resolved.data !== 'string') {
          throw new Error(resultError(resolved, 'Unable to resolve remote path.'));
        }
        targetPath = resolved.data;
      }
      const result = await sdk.ssh.sftpList(sessionId, targetPath);
      if (!result.ok || !result.data) {
        throw new Error(resultError(result, 'Unable to list remote directory.'));
      }
      const folders = result.data
        .filter((entry) => entry.type === 'directory' || entry.type === 'link')
        .sort(
          (a, b) =>
            (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1) ||
            a.name.localeCompare(b.name),
        );
      setFolderPicker((current) =>
        current && current.sessionId === sessionId
          ? { ...current, path: targetPath, input: targetPath, entries: folders, loading: false, error: '' }
          : current,
      );
    } catch (error) {
      setFolderPicker((current) =>
        current && current.sessionId === sessionId
          ? {
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : current,
      );
    }
  };

  const openFolderPicker = async () => {
    if (folderPickerStatus.status === 'connecting' || folderPicker) return;
    setFolderPickerStatus({
      status: 'connecting',
      message: 'Opening SFTP folder browser…',
    });
    let sessionId = '';
    let ownsSession = true;
    try {
      // The SFTP start folder is only a remote path preference. If Test connection already
      // authenticated a Hold session, reuse it for browsing to avoid asking the server to
      // authenticate a second time; otherwise create a disposable target session.
      if ((draft.hold === true || draft.proxy === true) && draftHoldSession?.sessionId) {
        sessionId = draftHoldSession.sessionId;
        ownsSession = false;
      } else {
        const connection = await connectDraftTemporary('sftp-picker', { respectHold: false });
        sessionId = connection.sessionId;
      }
      const initialPath = normalizeSftpStartPath(draft.sftpStartPath);
      setFolderPicker({
        sessionId,
        ownsSession,
        path: initialPath,
        input: initialPath,
        entries: [],
        loading: true,
        error: '',
      });
      setFolderPickerStatus({ status: 'idle', message: '' });
      await loadFolderPickerPath(sessionId, initialPath, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFolderPickerStatus({
        status: 'error',
        message: `Unable to browse SFTP folders: ${message}`,
      });
      if (sessionId && ownsSession) await sdk.ssh.disconnect(sessionId);
      void refreshBackendSessions();
    }
  };

  const closeFolderPicker = async () => {
    const picker = folderPicker;
    setFolderPicker(null);
    setFolderPickerStatus({ status: 'idle', message: '' });
    if (picker?.sessionId && picker.ownsSession) await sdk.ssh.disconnect(picker.sessionId);
    void refreshBackendSessions();
  };

  const chooseFolderPath = async () => {
    if (!folderPicker) return;
    updateDraft('sftpStartPath', folderPicker.path);
    await closeFolderPicker();
  };

  const closeDraftModal = (options: { keepHoldSession?: boolean } = {}) => {
    if (folderPicker?.sessionId && folderPicker.ownsSession) void sdk.ssh.disconnect(folderPicker.sessionId);
    if (!options.keepHoldSession && draftHoldSession?.sessionId)
      void sdk.ssh.disconnect(draftHoldSession.sessionId);
    if (!options.keepHoldSession) setDraftHoldSession(null);
    setFolderPicker(null);
    setFolderPickerStatus({ status: 'idle', message: '' });
    setDraftOpen(false);
    void refreshBackendSessions();
  };

  const saveDraft = async (event: FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    const host = draft.host.trim();
    const port = normalizePort(draft.port);
    const username = draft.username.trim();
    if (!name || !host || !port || !username) {
      addNotice('Name, host, port, and username are required.');
      return;
    }
    const profileId = draft.id ?? draftHoldSession?.profileId ?? newId('profile');
    const proxyProfileId =
      draft.proxyProfileId &&
      draft.proxyProfileId !== profileId &&
      profileMap.get(draft.proxyProfileId)?.proxy
        ? draft.proxyProfileId
        : '';
    const nextProfile: ConnectionProfile = {
      id: profileId,
      groupId: groups.some((group) => group.id === draft.groupId) ? draft.groupId : DEFAULT_GROUP.id,
      name,
      host,
      port,
      username,
      authMethod: draft.authMethod,
      password: draft.password?.trim() || '',
      privateKey: draft.privateKey || '',
      passphrase: draft.passphrase || '',
      agent: draft.agent?.trim() || '',
      hostFingerprint: draft.hostFingerprint?.trim() || '',
      sftpStartPath: normalizeSftpStartPath(draft.sftpStartPath),
      hold: draft.hold === true || draft.proxy === true,
      proxy: draft.proxy === true,
      proxyProfileId,
    };
    const previousProfile = draft.id ? profiles.find((profile) => profile.id === draft.id) : undefined;
    const keepDraftHoldSession = Boolean(
      draftHoldSession && nextProfile.hold && draftHoldSession.profileId === nextProfile.id,
    );
    const preservedHoldSessionId = keepDraftHoldSession ? draftHoldSession?.sessionId : '';
    if (previousProfile && connectionConfigChanged(previousProfile, nextProfile)) {
      const existingResult = await sdk.ssh.listSessions();
      const staleTransportIds = existingResult.ok
        ? Array.from(
            new Set(
              (existingResult.data ?? [])
                .filter(
                  (session) =>
                    session.profileId === previousProfile.id && session.sessionId !== preservedHoldSessionId,
                )
                .map((session) => session.sessionId),
            ),
          )
        : [];
      await Promise.all(staleTransportIds.map((sessionId) => sdk.ssh.disconnect(sessionId)));
      setBackendSessions((current) =>
        current.filter(
          (session) =>
            session.profileId !== previousProfile.id && !staleTransportIds.includes(session.sessionId),
        ),
      );
      const staleTabs = Object.values(sessions).filter((tab) => tab.profileId === previousProfile.id);
      if (staleTabs.length) {
        const staleTabIds = new Set(staleTabs.map((tab) => tab.tabId));
        const staleTerminalIds = new Set(
          staleTabs.flatMap((tab) => tab.panes.map((pane) => pane.terminalId)),
        );
        setSessions((current) => {
          const next = { ...current };
          staleTabIds.forEach((tabId) => delete next[tabId]);
          return next;
        });
        setTerminalHistory((current) => {
          const next = { ...current };
          staleTerminalIds.forEach((terminalId) => delete next[terminalId]);
          return next;
        });
        if (staleTabIds.has(activeSessionId)) {
          setActiveSessionId('');
          setWorkspaceMode('terminal');
        }
      }
    }
    const next = draft.id
      ? profiles.map((profile) => {
          if (profile.id === draft.id) return nextProfile;
          if (previousProfile?.proxy && !nextProfile.proxy && profile.proxyProfileId === previousProfile.id) {
            return { ...profile, proxyProfileId: '' };
          }
          return profile;
        })
      : [...profiles, nextProfile];
    await persistProfiles(next);
    closeDraftModal({ keepHoldSession: keepDraftHoldSession });
    if (connectAfterSave) await connectProfile(nextProfile);
  };

  const disconnectSession = async (tabId: string) => {
    const target = sessions[tabId];
    if (!target) return;
    const related = Object.values(sessions).filter((tab) => tab.sessionId === target.sessionId);
    await sdk.ssh.disconnect(target.sessionId);
    setBackendSessions((current) => current.filter((session) => session.sessionId !== target.sessionId));
    const removedTabIds = new Set(related.map((tab) => tab.tabId));
    const removedTerminalIds = new Set(related.flatMap((tab) => tab.panes.map((pane) => pane.terminalId)));
    setSessions((current) => {
      const next = { ...current };
      removedTabIds.forEach((id) => delete next[id]);
      return next;
    });
    setTerminalHistory((current) => {
      const next = { ...current };
      removedTerminalIds.forEach((id) => delete next[id]);
      return next;
    });
    if (removedTabIds.has(activeSessionId)) {
      const nextId = Object.values(sessions).find((tab) => !removedTabIds.has(tab.tabId))?.tabId ?? '';
      setActiveSessionId(nextId);
      if (!nextId) setWorkspaceMode('terminal');
    }
    if (keyboardPrompt?.sessionId === target.sessionId) setKeyboardPrompt(null);
  };

  const detachSession = async (tabId: string) => {
    const session = sessions[tabId];
    if (!session || !session.hold) {
      await disconnectSession(tabId);
      return;
    }
    await Promise.all(session.panes.map((pane) => sdk.ssh.closeTerminal(session.sessionId, pane.terminalId)));
    void refreshBackendSessions();
    setSessions((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setTerminalHistory((current) => {
      const next = { ...current };
      session.panes.forEach((pane) => delete next[pane.terminalId]);
      return next;
    });
    if (activeSessionId === tabId) {
      const nextId = Object.values(sessions).find((tab) => tab.tabId !== tabId)?.tabId ?? '';
      setActiveSessionId(nextId);
      if (!nextId) setWorkspaceMode('terminal');
    }
    if (keyboardPrompt?.sessionId === session.sessionId) setKeyboardPrompt(null);
  };

  const renameSession = (tabId: string) => {
    const session = sessions[tabId];
    if (!session) return;
    const title = window.prompt('Rename tab', session.title);
    if (!title?.trim()) return;
    setSessions((current) => ({
      ...current,
      [tabId]: { ...current[tabId], title: title.trim() },
    }));
  };

  const reconnectSession = async (tabId: string) => {
    const session = sessions[tabId];
    if (!session || session.status === 'connecting') return;
    const profile = profileMap.get(session.profileId);
    if (!profile) {
      appendTabLog(tabId, 'error', 'Cannot reconnect because the saved connection profile was not found.');
      return;
    }
    const proxyProfile = profile.proxyProfileId ? profileMap.get(profile.proxyProfileId) : undefined;
    if (profile.proxyProfileId && !proxyProfile) {
      appendTabLog(tabId, 'error', 'Cannot reconnect because the selected SSH proxy profile was not found.');
      return;
    }

    const nextSessionId = newId('session');
    const pane = makePane();
    const oldTerminalIds = session.panes.map((item) => item.terminalId);
    setSessions((current) => {
      const existing = current[tabId];
      if (!existing) return current;
      return {
        ...current,
        [tabId]: {
          ...existing,
          sessionId: nextSessionId,
          terminalId: pane.terminalId,
          hold: Boolean(profile.hold),
          holdKey: profile.hold ? profile.id : undefined,
          host: profile.host,
          port: profile.port,
          username: profile.username,
          status: 'connecting',
          panes: [pane],
          splitOrientation: null,
          proxyProfileId: proxyProfile?.id,
          proxyName: proxyProfile?.name,
          proxyHost: proxyProfile?.host,
          proxyUsername: proxyProfile?.username,
          logs: trimLogs([
            ...(existing.logs ?? []),
            makeConnectionLog(
              'info',
              `Reconnecting to ${profile.username}@${profile.host}:${profile.port}...`,
            ),
            ...(proxyProfile
              ? [
                  makeConnectionLog(
                    'info',
                    `Using SSH proxy ${proxyProfile.name} (${proxyProfile.username}@${proxyProfile.host}:${proxyProfile.port}).`,
                  ),
                ]
              : []),
          ]),
        },
      };
    });
    setTerminalHistory((current) => {
      const next = { ...current };
      oldTerminalIds.forEach((terminalId) => delete next[terminalId]);
      return next;
    });
    setWorkspaceMode('terminal');

    const result = await sdk.ssh.connect({
      sessionId: nextSessionId,
      terminalId: pane.terminalId,
      profileId: profile.id,
      hold: Boolean(profile.hold),
      holdKey: profile.hold ? profile.id : undefined,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      password: profile.password,
      privateKey: profile.privateKey,
      passphrase: profile.passphrase,
      agent: profile.agent,
      hostFingerprint: profile.hostFingerprint,
      proxy: proxyProfile ? toProxyConnectParams(proxyProfile) : undefined,
    });

    if (!result.ok || !result.data) {
      setBackendSessions((current) => current.filter((item) => item.sessionId !== nextSessionId));
      appendTabLog(
        tabId,
        'error',
        `Connection failed: ${resultError(result, `Unable to connect to ${profile.host}`)}`,
      );
      setSessions((current) => {
        const existing = current[tabId];
        if (!existing) return current;
        return { ...current, [tabId]: { ...existing, status: 'error' } };
      });
      return;
    }

    const summary = result.data;
    const resolvedTerminalId = summary.terminalId ?? pane.terminalId;
    setSessions((current) => {
      const existing = current[tabId];
      if (!existing) return current;
      return {
        ...current,
        [tabId]: {
          ...existing,
          ...summary,
          tabId,
          terminalId: resolvedTerminalId,
          profileId: profile.id,
          profileName: profile.name,
          panes: [{ ...pane, terminalId: resolvedTerminalId }],
          splitOrientation: null,
          logs: trimLogs([
            ...(existing.logs ?? []),
            makeConnectionLog('success', 'Reconnected and interactive shell is ready.'),
          ]),
        },
      };
    });
    setTerminalHistory((current) => ({
      ...current,
      [resolvedTerminalId]: summary.output ?? current[resolvedTerminalId] ?? '',
    }));
  };

  const copySession = async (tabId: string) => {
    const session = sessions[tabId];
    if (!session) return;
    if (!session.hold || session.status !== 'ready') {
      addNotice('The SSH connection must be ready and SSH Hold must be enabled before copying tabs.');
      return;
    }
    const profile = profileMap.get(session.profileId);
    if (!profile) {
      addNotice('The saved connection profile could not be found.');
      return;
    }
    await openProfileTab(profile, {
      requestSessionId: session.sessionId,
      title: `${session.title} copy`,
    });
  };

  const splitSession = async (tabId: string, orientation: 'horizontal' | 'vertical') => {
    const session = sessions[tabId];
    if (!session) return;
    if (!session.hold || session.status !== 'ready') {
      addNotice(
        'The SSH connection must be ready and SSH Hold must be enabled before creating split terminals.',
      );
      return;
    }
    if (session.panes.length >= 2) {
      setSessions((current) => ({
        ...current,
        [tabId]: { ...current[tabId], splitOrientation: orientation },
      }));
      return;
    }
    const profile = profileMap.get(session.profileId);
    if (!profile) {
      addNotice('The saved connection profile could not be found.');
      return;
    }
    const proxyProfile = profile.proxyProfileId ? profileMap.get(profile.proxyProfileId) : undefined;
    if (profile.proxyProfileId && !proxyProfile) {
      addNotice('The selected SSH proxy profile could not be found.');
      return;
    }
    const pane = makePane();
    const result = await sdk.ssh.connect({
      sessionId: session.sessionId,
      terminalId: pane.terminalId,
      profileId: profile.id,
      hold: true,
      holdKey: profile.id,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      password: profile.password,
      privateKey: profile.privateKey,
      passphrase: profile.passphrase,
      agent: profile.agent,
      hostFingerprint: profile.hostFingerprint,
      proxy: proxyProfile ? toProxyConnectParams(proxyProfile) : undefined,
    });
    if (!result.ok || !result.data) {
      addNotice(resultError(result, 'Unable to create a split terminal.'));
      return;
    }
    const resolvedTerminalId = result.data.terminalId ?? pane.terminalId;
    setSessions((current) => {
      const existing = current[tabId];
      if (!existing) return current;
      return {
        ...current,
        [tabId]: {
          ...existing,
          status: result.data?.status ?? existing.status,
          panes: [...existing.panes, { ...pane, terminalId: resolvedTerminalId }],
          splitOrientation: orientation,
        },
      };
    });
    setTerminalHistory((current) => ({
      ...current,
      [resolvedTerminalId]: result.data?.output ?? current[resolvedTerminalId] ?? '',
    }));
  };

  const closePane = async (tabId: string, paneId: string) => {
    const session = sessions[tabId];
    if (!session || session.panes.length <= 1) return;
    const pane = session.panes.find((item) => item.id === paneId);
    if (!pane) return;
    await sdk.ssh.closeTerminal(session.sessionId, pane.terminalId);
    setSessions((current) => {
      const existing = current[tabId];
      if (!existing) return current;
      const panes = existing.panes.filter((item) => item.id !== paneId);
      return {
        ...current,
        [tabId]: {
          ...existing,
          panes,
          splitOrientation: panes.length > 1 ? existing.splitOrientation : null,
        },
      };
    });
    setTerminalHistory((current) => {
      const next = { ...current };
      delete next[pane.terminalId];
      return next;
    });
  };

  const deleteProfile = async (profile: ConnectionProfile) => {
    if (!window.confirm(`Delete connection “${profile.name}”?`)) return;
    const active = Object.values(sessions).filter((session) => session.profileId === profile.id);
    const transportIds = new Set(active.map((session) => session.sessionId));
    const backendSessions = await sdk.ssh.listSessions();
    if (backendSessions.ok) {
      for (const session of backendSessions.data ?? []) {
        if (session.profileId === profile.id) transportIds.add(session.sessionId);
      }
    }
    await Promise.all(Array.from(transportIds).map((sessionId) => sdk.ssh.disconnect(sessionId)));
    setBackendSessions((current) =>
      current.filter((session) => session.profileId !== profile.id && !transportIds.has(session.sessionId)),
    );
    const removedTabIds = new Set(active.map((session) => session.tabId));
    const removedTerminalIds = new Set(
      active.flatMap((session) => session.panes.map((pane) => pane.terminalId)),
    );
    setSessions((current) => {
      const next = { ...current };
      removedTabIds.forEach((tabId) => delete next[tabId]);
      return next;
    });
    setTerminalHistory((current) => {
      const next = { ...current };
      removedTerminalIds.forEach((terminalId) => delete next[terminalId]);
      return next;
    });
    if (removedTabIds.has(activeSessionId)) {
      setActiveSessionId('');
      setWorkspaceMode('terminal');
    }
    await persistProfiles(
      profiles
        .filter((item) => item.id !== profile.id)
        .map((item) => (item.proxyProfileId === profile.id ? { ...item, proxyProfileId: '' } : item)),
    );
  };

  const openGroupCreator = () => {
    setDeleteGroupCandidate(null);
    setGroupEditor({ mode: 'create', value: '', error: '' });
  };

  const openGroupRenamer = (group: Group) => {
    setDeleteGroupCandidate(null);
    setGroupEditor({ mode: 'rename', groupId: group.id, value: group.name, error: '' });
  };

  const submitGroupEditor = async (event: FormEvent) => {
    event.preventDefault();
    if (!groupEditor) return;
    const name = groupEditor.value.trim();
    if (!name) {
      setGroupEditor((current) => (current ? { ...current, error: 'Group name is required.' } : current));
      return;
    }
    const duplicate = groups.some(
      (group) => group.id !== groupEditor.groupId && group.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      setGroupEditor((current) =>
        current ? { ...current, error: 'A group with this name already exists.' } : current,
      );
      return;
    }
    if (groupEditor.mode === 'rename') {
      const target = groups.find((group) => group.id === groupEditor.groupId);
      if (!target || target.name === name) {
        setGroupEditor(null);
        return;
      }
      await persistGroups(groups.map((item) => (item.id === target.id ? { ...item, name } : item)));
      setGroupEditor(null);
      return;
    }
    const idBase = slug(name);
    let id = idBase;
    let index = 2;
    while (groups.some((group) => group.id === id)) id = `${idBase}-${index++}`;
    const next = [...groups, { id, name }];
    await persistGroups(next);
    setSelectedGroupId(id);
    setGroupEditor(null);
  };

  const requestDeleteGroup = (group: Group) => {
    if (group.id === DEFAULT_GROUP.id) {
      addNotice('The General group cannot be deleted.');
      return;
    }
    setGroupEditor(null);
    setDeleteGroupCandidate(group);
  };

  const confirmDeleteGroup = async () => {
    const group = deleteGroupCandidate;
    if (!group) return;
    const nextGroups = groups.filter((item) => item.id !== group.id);
    const nextProfiles = profiles.map((profile) =>
      profile.groupId === group.id ? { ...profile, groupId: DEFAULT_GROUP.id } : profile,
    );
    await persistGroups(nextGroups);
    await persistProfiles(nextProfiles);
    setSelectedGroupId('all');
    setDeleteGroupCandidate(null);
  };

  const submitKeyboardPrompt = async (event: FormEvent) => {
    event.preventDefault();
    if (!keyboardPrompt) return;
    const result = await sdk.ssh.respondKeyboard(keyboardPrompt.sessionId, keyboardAnswers);
    if (!result.ok) {
      addNotice(resultError(result, 'Unable to submit authentication prompts.'));
      return;
    }
    setKeyboardPrompt(null);
    setKeyboardAnswers([]);
  };

  const loadPrivateKeyFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      addNotice('Private key file must be smaller than 2 MB.');
      return;
    }
    try {
      const content = await file.text();
      if (!content.trim()) {
        addNotice('The selected private key file is empty.');
        return;
      }
      updateDraft('privateKey', content);
      setPrivateKeyFileName(file.name);
    } catch (error) {
      addNotice(error instanceof Error ? error.message : 'Unable to read the private key file.');
    }
  };

  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className={styles.app}>
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            <div className={styles.sectionEyebrow}>Connection groups</div>
            <button
              type="button"
              className={styles.iconButton}
              onClick={openGroupCreator}
              aria-label="Add group"
              title="Add group"
              disabled={groupEditor?.mode === 'create'}
            >
              ＋
            </button>
          </div>
          <div className={styles.groupList}>
            <button
              type="button"
              className={`${styles.groupItem} ${selectedGroupId === 'all' ? styles.groupItemActive : ''}`}
              onClick={() => setSelectedGroupId('all')}
            >
              <span className={styles.groupGlyph}>◈</span>
              <span className={styles.groupName}>All connections</span>
              <span className={styles.groupCount}>{profiles.length}</span>
            </button>
            {groupEditor?.mode === 'create' && (
              <form className={styles.groupEditorRow} onSubmit={(event) => void submitGroupEditor(event)}>
                <div className={styles.groupEditorMain}>
                  <span className={styles.groupGlyph}>＋</span>
                  <input
                    value={groupEditor.value}
                    onChange={(event) =>
                      setGroupEditor((current) =>
                        current
                          ? {
                              ...current,
                              value: event.target.value,
                              error: '',
                            }
                          : current,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setGroupEditor(null);
                    }}
                    placeholder="New group name"
                    autoFocus
                  />
                  <div className={styles.groupEditorActions}>
                    <button type="submit" title="Create group" aria-label="Create group">
                      ✓
                    </button>
                    <button
                      type="button"
                      title="Cancel"
                      aria-label="Cancel"
                      onClick={() => setGroupEditor(null)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {groupEditor.error && <div className={styles.groupEditorError}>{groupEditor.error}</div>}
              </form>
            )}
            {groups.map((group) => (
              <Fragment key={group.id}>
                {groupEditor?.mode === 'rename' && groupEditor.groupId === group.id ? (
                  <form className={styles.groupEditorRow} onSubmit={(event) => void submitGroupEditor(event)}>
                    <div className={styles.groupEditorMain}>
                      <span className={styles.groupGlyph}>✎</span>
                      <input
                        value={groupEditor.value}
                        onChange={(event) =>
                          setGroupEditor((current) =>
                            current
                              ? {
                                  ...current,
                                  value: event.target.value,
                                  error: '',
                                }
                              : current,
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setGroupEditor(null);
                        }}
                        autoFocus
                      />
                      <div className={styles.groupEditorActions}>
                        <button type="submit" title="Save group" aria-label="Save group">
                          ✓
                        </button>
                        <button
                          type="button"
                          title="Cancel"
                          aria-label="Cancel"
                          onClick={() => setGroupEditor(null)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {groupEditor.error && <div className={styles.groupEditorError}>{groupEditor.error}</div>}
                  </form>
                ) : (
                  <div
                    className={`${styles.groupRow} ${selectedGroupId === group.id ? styles.groupRowActive : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.groupItem}
                      onClick={() => setSelectedGroupId(group.id)}
                    >
                      <span className={styles.groupGlyph}>{group.id === DEFAULT_GROUP.id ? '◇' : '○'}</span>
                      <span className={styles.groupName}>{group.name}</span>
                      <span className={styles.groupCount}>{groupCounts.get(group.id) ?? 0}</span>
                    </button>
                    <div className={styles.groupActions}>
                      <button
                        type="button"
                        onClick={() => openGroupRenamer(group)}
                        aria-label={`Rename ${group.name}`}
                        title="Rename group"
                      >
                        …
                      </button>
                      {group.id !== DEFAULT_GROUP.id && (
                        <button
                          type="button"
                          onClick={() => requestDeleteGroup(group)}
                          aria-label={`Delete ${group.name}`}
                          title="Delete group"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {deleteGroupCandidate?.id === group.id && (
                  <div className={styles.groupDeleteConfirm}>
                    <div className={styles.groupDeleteText}>
                      Delete “{group.name}”? Connections will move to General.
                    </div>
                    <div className={styles.groupDeleteActions}>
                      <button type="button" onClick={() => void confirmDeleteGroup()}>
                        Delete
                      </button>
                      <button type="button" onClick={() => setDeleteGroupCandidate(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          <div className={styles.sidebarDivider} />
          <div className={styles.sidebarTop}>
            <div className={styles.sectionEyebrow}>Saved connections</div>
            <button
              type="button"
              className={styles.iconButton}
              onClick={openCreate}
              aria-label="Add connection"
              title="Add connection"
            >
              ＋
            </button>
          </div>
          <div className={styles.searchBox}>
            <span>⌕</span>
            <input
              value={profileQuery}
              onChange={(event) => setProfileQuery(event.target.value)}
              placeholder="Filter connections"
            />
          </div>
          <div className={styles.profileList}>
            {visibleProfiles.map((profile) => {
              const runtime =
                profileRuntimeMap.get(profile.id) ??
                ({
                  connection: 'disconnected',
                  hold: profile.hold || profile.proxy ? 'stopped' : 'none',
                } satisfies ProfileRuntime);
              return (
                <div
                  key={profile.id}
                  className={`${styles.profileRow} ${
                    runtime.connection === 'connected' ? styles.profileRowConnected : ''
                  } ${runtime.hold === 'running' ? styles.profileRowHoldRunning : ''}`}
                >
                  <button
                    type="button"
                    className={styles.profileMain}
                    onClick={() => void connectProfile(profile)}
                    title="Connect"
                  >
                    <span className={`${styles.profileDot} ${getProfileDotClass(runtime.connection)}`} />
                    <span className={styles.profileText}>
                      <span className={styles.profileName}>
                        {profile.name}
                        {profile.hold && (
                          <span className={styles.profileHold} title="SSH Hold enabled">
                            HOLD
                          </span>
                        )}
                        {profile.proxy && (
                          <span className={styles.profileHold} title="Can be used as an SSH proxy">
                            PROXY
                          </span>
                        )}
                      </span>
                      <span className={styles.profileAddress}>
                        {profile.username}@{profile.host}:{profile.port}
                        {profile.proxyProfileId && profileMap.get(profile.proxyProfileId) && (
                          <> · via {profileMap.get(profile.proxyProfileId)?.name}</>
                        )}
                      </span>
                      <span className={styles.profileRuntimeRow}>
                        <span
                          className={`${styles.profileRuntimeBadge} ${getProfileConnectionBadgeClass(
                            runtime.connection,
                          )}`}
                          title={getProfileConnectionLabel(runtime.connection)}
                        >
                          {getProfileConnectionLabel(runtime.connection)}
                        </span>
                        {runtime.hold !== 'none' && (
                          <span
                            className={`${styles.profileRuntimeBadge} ${getProfileHoldBadgeClass(
                              runtime.hold,
                            )}`}
                            title={getProfileHoldLabel(runtime.hold)}
                          >
                            {getProfileHoldLabel(runtime.hold)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.connectButton}
                    onClick={() => openEdit(profile)}
                    aria-label={`Edit ${profile.name}`}
                    title="Edit connection"
                  >
                    ✎
                  </button>
                </div>
              );
            })}
            {!visibleProfiles.length && (
              <div className={styles.emptySide}>
                {profiles.length ? 'No matching connections' : 'Add your first connection'}
              </div>
            )}
          </div>
        </aside>

        <main className={styles.workspace}>
          <div className={styles.sessionBar}>
            <div className={styles.sessionTabs}>
              {sessionList.map((session) => (
                <button
                  key={session.tabId}
                  type="button"
                  className={`${styles.sessionTab} ${session.tabId === activeSessionId ? styles.sessionTabActive : ''}`}
                  onClick={() => {
                    setActiveSessionId(session.tabId);
                    setWorkspaceMode('terminal');
                  }}
                >
                  <span className={`${styles.tabStatus} ${getStatusClass(session.status)}`} />
                  <span className={styles.sessionTabText}>{session.title}</span>
                  <span className={styles.sessionTabHost}>{session.host}</span>
                  <span
                    className={styles.sessionTabClose}
                    onClick={(event) => {
                      event.stopPropagation();
                      void detachSession(session.tabId);
                    }}
                    role="button"
                    tabIndex={0}
                    title={session.hold ? 'Detach tab and keep SSH Hold connection' : 'Close session'}
                  >
                    ×
                  </span>
                </button>
              ))}
              {!sessionList.length && <div className={styles.noSessions}>No open sessions</div>}
            </div>
            <div className={styles.sessionBarMeta}>
              {sessionList.length ? `${sessionList.length} open` : 'Ready to connect'}
            </div>
          </div>

          {notice && <div className={styles.notice}>{notice}</div>}

          {activeSession ? (
            <div className={styles.sessionWorkspace}>
              <div className={styles.sessionHeader}>
                <div>
                  <div className={styles.sessionTitleLine}>
                    <span className={`${styles.largeStatusDot} ${getStatusClass(activeSession.status)}`} />
                    <strong>{activeSession.title}</strong>
                    <span className={styles.statusLabel}>{getStatusLabel(activeSession.status)}</span>
                    {activeSession.hold && <span className={styles.holdBadge}>SSH Hold</span>}
                    {activeSession.proxyName && (
                      <span className={styles.holdBadge}>via {activeSession.proxyName}</span>
                    )}
                  </div>
                  <div className={styles.sessionSubtitle}>
                    {activeSession.username}@{activeSession.host}:{activeSession.port}
                  </div>
                </div>
                <div className={styles.sessionActions}>
                  {activeSession.status === 'ready' && (
                    <>
                      <button
                        type="button"
                        className={`${styles.modeButton} ${
                          workspaceMode === 'terminal' ? styles.modeButtonActive : ''
                        }`}
                        onClick={() => setWorkspaceMode('terminal')}
                      >
                        Terminal
                      </button>
                      <button
                        type="button"
                        className={`${styles.modeButton} ${
                          workspaceMode === 'sftp' ? styles.modeButtonActive : ''
                        }`}
                        onClick={() => setWorkspaceMode('sftp')}
                      >
                        SFTP
                      </button>
                      <button
                        type="button"
                        className={styles.modeButton}
                        onClick={() => void splitSession(activeSession.tabId, 'horizontal')}
                        disabled={!activeSession.hold}
                        title="Split terminal horizontally (requires SSH Hold)"
                      >
                        Split H
                      </button>
                      <button
                        type="button"
                        className={styles.modeButton}
                        onClick={() => void splitSession(activeSession.tabId, 'vertical')}
                        disabled={!activeSession.hold}
                        title="Split terminal vertically (requires SSH Hold)"
                      >
                        Split V
                      </button>
                      <button
                        type="button"
                        className={styles.modeButton}
                        onClick={() => void copySession(activeSession.tabId)}
                        disabled={!activeSession.hold}
                        title="Copy to a new tab (requires SSH Hold)"
                      >
                        New tab
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.modeButton}
                    onClick={() => renameSession(activeSession.tabId)}
                    title="Rename tab"
                  >
                    Rename
                  </button>
                  {activeSession.status === 'ready' && (
                    <button
                      type="button"
                      className={styles.disconnectButton}
                      onClick={() => void disconnectSession(activeSession.tabId)}
                    >
                      {getDisconnectLabel(activeSession)}
                    </button>
                  )}
                </div>
              </div>

              {showConnectionLog && (
                <div className={styles.connectionFlow}>
                  <div
                    className={`${styles.connectionStateCard} ${
                      activeSession.status === 'error' ? styles.connectionStateCardError : ''
                    }`}
                  >
                    <span
                      className={`${styles.connectionStateIcon} ${
                        activeSession.status === 'error'
                          ? styles.connectionStateIconError
                          : styles.connectionStateIconConnecting
                      }`}
                    >
                      {activeSession.status === 'error' ? '!' : '↻'}
                    </span>
                    <div className={styles.connectionStateText}>
                      <div className={styles.connectionStateTitle}>
                        {getConnectionFlowTitle(activeSession.status)}
                      </div>
                      <div className={styles.connectionStateDescription}>
                        {getConnectionFlowDescription(activeSession.status)}
                      </div>
                      <div className={styles.connectionStateEndpoint}>
                        {activeSession.username}@{activeSession.host}:{activeSession.port}
                      </div>
                    </div>
                  </div>

                  <div className={`${styles.connectionLogPanel} ${styles.connectionLogProcess}`}>
                    <div className={styles.connectionLogHeader}>
                      <span>Connection progress</span>
                      <span className={styles.connectionLogCount}>
                        {(activeSession.logs ?? []).length} log
                        {(activeSession.logs ?? []).length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className={styles.connectionLogList}>
                      {(activeSession.logs ?? []).length > 0 ? (
                        (activeSession.logs ?? []).map((entry) => (
                          <div
                            key={entry.id}
                            className={`${styles.connectionLogRow} ${getLogClass(entry.level)}`}
                          >
                            <span className={styles.connectionLogTime}>{formatLogTime(entry.at)}</span>
                            <span className={styles.connectionLogLevel}>{entry.level}</span>
                            <span className={styles.connectionLogMessage}>{entry.message}</span>
                          </div>
                        ))
                      ) : (
                        <div className={styles.connectionLogEmpty}>No connection logs.</div>
                      )}
                    </div>
                    <div className={styles.connectionLogFooter}>
                      <div className={styles.connectionLogFooterHint}>
                        {activeSession.status === 'connecting'
                          ? 'Waiting for SSH handshake and authentication.'
                          : 'Retry after checking the failure reason above.'}
                      </div>
                      <div className={styles.connectionLogActions}>
                        {activeSession.status === 'error' && activeProfile && (
                          <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => openEdit(activeProfile)}
                          >
                            Edit profile
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => clearTabLogs(activeSession.tabId)}
                          disabled={(activeSession.logs ?? []).length === 0}
                        >
                          Clear
                        </button>
                        {activeSession.status === 'error' && (
                          <button
                            type="button"
                            className={styles.primarySmallButton}
                            onClick={() => void reconnectSession(activeSession.tabId)}
                          >
                            Reconnect
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.disconnectButton}
                          onClick={() => void disconnectSession(activeSession.tabId)}
                        >
                          {getDisconnectLabel(activeSession)}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSession.status === 'ready' &&
                (workspaceMode === 'terminal' ? (
                  <div
                    className={`${styles.terminalSplit} ${
                      activeSession.splitOrientation === 'vertical' ? styles.terminalSplitVertical : ''
                    }`}
                  >
                    {activeSession.panes.map((pane, index) => (
                      <TerminalPane
                        key={pane.id}
                        sessionId={activeSession.sessionId}
                        terminalId={pane.terminalId}
                        history={terminalHistory[pane.terminalId] ?? ''}
                        connected
                        title={index === 0 ? activeSession.title : `${activeSession.title} · ${index + 1}`}
                        closable={index > 0}
                        onClose={() => void closePane(activeSession.tabId, pane.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <SftpBrowser
                    key={activeSession.sessionId}
                    sessionId={activeSession.sessionId}
                    startPath={activeProfile?.sftpStartPath}
                    onError={addNotice}
                  />
                ))}
            </div>
          ) : (
            <EmptyWorkspace onCreate={openCreate} />
          )}
        </main>
      </div>

      {draftOpen && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && closeDraftModal()}
        >
          <form className={styles.modal} onSubmit={(event) => void saveDraft(event)}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>{draft.id ? 'Edit connection' : 'New SSH connection'}</div>
                <div className={styles.modalSubtitle}>Credentials stay in this local plugin vault.</div>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => closeDraftModal()}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className={styles.formGrid}>
              <label className={styles.formField}>
                <span>Display name</span>
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(event) => updateDraft('name', event.target.value)}
                  placeholder="Production API"
                />
              </label>
              <label className={styles.formField}>
                <span>Group</span>
                <select
                  value={draft.groupId}
                  onChange={(event) => updateDraft('groupId', event.target.value)}
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className={`${styles.formFieldWide} ${styles.hostPortRow}`}>
                <label className={styles.formField}>
                  <span>Host</span>
                  <input
                    value={draft.host}
                    onChange={(event) => updateDraft('host', event.target.value)}
                    placeholder="server.example.com"
                  />
                </label>
                <label className={`${styles.formField} ${styles.portField}`}>
                  <span>Port</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.port || 22}
                    onBlur={() => {
                      if (!normalizePort(draft.port)) updateDraft('port', 22);
                    }}
                    onChange={(event) =>
                      updateDraft('port', event.target.value ? Number(event.target.value) : 22)
                    }
                  />
                </label>
              </div>
              <label className={`${styles.formField} ${styles.formFieldWide}`}>
                <span>Username</span>
                <input
                  value={draft.username}
                  onChange={(event) => updateDraft('username', event.target.value)}
                  placeholder="root"
                />
              </label>
              <label className={`${styles.formField} ${styles.formFieldWide}`}>
                <span>Authentication</span>
                <select
                  value={draft.authMethod}
                  onChange={(event) => updateDraft('authMethod', event.target.value as SshAuthMethod)}
                >
                  <option value="password">Password</option>
                  <option value="privateKey">Private key</option>
                  <option value="agent">SSH agent</option>
                  <option value="keyboard-interactive">Keyboard-interactive / MFA</option>
                </select>
              </label>
              {draft.authMethod === 'password' && (
                <label className={`${styles.formField} ${styles.formFieldWide}`}>
                  <span>Password</span>
                  <input
                    type="password"
                    value={draft.password ?? ''}
                    onChange={(event) => updateDraft('password', event.target.value)}
                    autoComplete="off"
                  />
                </label>
              )}
              {draft.authMethod === 'privateKey' && (
                <>
                  <label className={`${styles.formField} ${styles.formFieldWide}`}>
                    <span>
                      Private key (OpenSSH PEM) <em>paste text or choose a file</em>
                    </span>
                    <div className={styles.keyPicker}>
                      <button
                        type="button"
                        className={styles.smallButton}
                        onClick={() => privateKeyFileRef.current?.click()}
                      >
                        Choose key file
                      </button>
                      <span className={styles.keyFileName}>
                        {privateKeyFileName || 'No key file selected'}
                      </span>
                    </div>
                    <input
                      ref={privateKeyFileRef}
                      className={styles.hiddenFileInput}
                      type="file"
                      accept=".pem,.key,.pub,text/plain,application/octet-stream"
                      onChange={(event) => void loadPrivateKeyFile(event)}
                    />
                    <textarea
                      className={styles.keyInput}
                      value={draft.privateKey ?? ''}
                      onChange={(event) => {
                        updateDraft('privateKey', event.target.value);
                        setPrivateKeyFileName(event.target.value ? 'Manual input' : '');
                      }}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    />
                  </label>
                  <label className={`${styles.formField} ${styles.formFieldWide}`}>
                    <span>
                      Key passphrase <em>optional</em>
                    </span>
                    <input
                      type="password"
                      value={draft.passphrase ?? ''}
                      onChange={(event) => updateDraft('passphrase', event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                </>
              )}
              {draft.authMethod === 'agent' && (
                <label className={`${styles.formField} ${styles.formFieldWide}`}>
                  <span>
                    Agent socket <em>optional, defaults to SSH_AUTH_SOCK</em>
                  </span>
                  <input
                    value={draft.agent ?? ''}
                    onChange={(event) => updateDraft('agent', event.target.value)}
                    placeholder="/private/tmp/com.apple.launchd.../Listeners"
                  />
                </label>
              )}
              <label className={`${styles.formField} ${styles.formFieldWide}`}>
                <span>
                  Host fingerprint <em>optional · SHA256:...</em>
                </span>
                <input
                  value={draft.hostFingerprint ?? ''}
                  onChange={(event) => updateDraft('hostFingerprint', event.target.value)}
                  placeholder="Pin the server key for safer reconnects"
                />
              </label>
              <label className={`${styles.formField} ${styles.formFieldWide}`}>
                <span>
                  Default SFTP start folder <em>optional · defaults to /</em>
                </span>
                <div className={styles.fieldWithAction}>
                  <input
                    value={draft.sftpStartPath ?? '/'}
                    onChange={(event) => updateDraft('sftpStartPath', event.target.value)}
                    placeholder="/"
                  />
                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={() => void openFolderPicker()}
                    disabled={folderPickerStatus.status === 'connecting' || Boolean(folderPicker)}
                    title="Temporarily connects with SFTP to browse folders. This does not change SSH login behavior."
                  >
                    {folderPickerStatus.status === 'connecting' ? 'Opening…' : 'Browse…'}
                  </button>
                </div>
                <span className={styles.fieldHint}>
                  Only controls the initial remote folder when opening SFTP. It does not affect SSH login,
                  terminal startup, Hold, or Proxy behavior. Examples: /, /var/www, /home/user/uploads.
                </span>
                {folderPickerStatus.message && (
                  <span
                    className={`${styles.folderPickerStatus} ${
                      folderPickerStatus.status === 'error' ? styles.connectionTestError : ''
                    }`}
                  >
                    {folderPickerStatus.message}
                  </span>
                )}
              </label>
              <label className={`${styles.formField} ${styles.formFieldWide}`}>
                <span>
                  Use SSH proxy <em>optional</em>
                </span>
                <select
                  value={draft.proxyProfileId ?? ''}
                  onChange={(event) => updateDraft('proxyProfileId', event.target.value)}
                  disabled={!draftProxyCandidates.length}
                >
                  <option value="">Direct connection</option>
                  {draftProxyCandidates.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.username}@{profile.host}:{profile.port}
                    </option>
                  ))}
                </select>
                <span className={styles.fieldHint}>
                  Select a saved connection marked as SSH Proxy to use it as the jump host for this
                  connection.
                </span>
              </label>
              <div className={`${styles.formField} ${styles.formFieldWide}`}>
                <span>Connection behavior</span>
                <div className={styles.optionGrid}>
                  <label className={styles.holdOption}>
                    <input
                      type="checkbox"
                      checked={draft.hold === true || draft.proxy === true}
                      disabled={draft.proxy === true}
                      onChange={(event) => updateDraft('hold', event.target.checked)}
                    />
                    <span>
                      <strong>SSH Hold</strong>
                      <small>
                        Keep the authenticated SSH connection alive for split panes, copied tabs, and SFTP
                        reuse.
                      </small>
                    </span>
                  </label>
                  <label className={styles.holdOption}>
                    <input
                      type="checkbox"
                      checked={draft.proxy === true}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          proxy: event.target.checked,
                          hold: event.target.checked ? true : current.hold,
                        }))
                      }
                    />
                    <span>
                      <strong>SSH Proxy</strong>
                      <small>
                        Make this host selectable as a jump/proxy machine for other SSH connections. This
                        automatically reuses Hold.
                      </small>
                    </span>
                  </label>
                </div>
              </div>
            </div>
            {folderPicker && (
              <div className={styles.folderPickerPanel}>
                <div className={styles.folderPickerHeader}>
                  <div>
                    <div className={styles.folderPickerTitle}>Select default SFTP folder</div>
                    <div className={styles.folderPickerPath}>{folderPicker.path}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.modalClose}
                    onClick={() => void closeFolderPicker()}
                    aria-label="Close folder picker"
                  >
                    ×
                  </button>
                </div>
                <div className={styles.folderPickerToolbar}>
                  <form
                    className={styles.folderPickerPathForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void loadFolderPickerPath(folderPicker.sessionId, folderPicker.input, true);
                    }}
                  >
                    <input
                      value={folderPicker.input}
                      onChange={(event) =>
                        setFolderPicker((current) =>
                          current ? { ...current, input: event.target.value } : current,
                        )
                      }
                      aria-label="Remote folder path"
                    />
                    <button type="submit" className={styles.pathGo} disabled={folderPicker.loading}>
                      Go
                    </button>
                  </form>
                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={() =>
                      void loadFolderPickerPath(folderPicker.sessionId, parentRemotePath(folderPicker.path))
                    }
                    disabled={folderPicker.loading}
                  >
                    ↑ Up
                  </button>
                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={() => void loadFolderPickerPath(folderPicker.sessionId, folderPicker.path)}
                    disabled={folderPicker.loading}
                  >
                    ↻ Refresh
                  </button>
                </div>
                <div className={styles.folderPickerList}>
                  {folderPicker.loading && <div className={styles.folderPickerEmpty}>Loading folders…</div>}
                  {!folderPicker.loading && folderPicker.error && (
                    <div className={styles.folderPickerError}>{folderPicker.error}</div>
                  )}
                  {!folderPicker.loading &&
                    !folderPicker.error &&
                    folderPicker.entries.map((entry) => (
                      <button
                        key={`${entry.name}-${entry.type}`}
                        type="button"
                        className={styles.folderPickerItem}
                        onClick={() =>
                          void loadFolderPickerPath(
                            folderPicker.sessionId,
                            joinRemotePath(folderPicker.path, entry.name),
                            entry.type === 'link',
                          )
                        }
                      >
                        <span>{entry.type === 'link' ? '↗' : '▰'}</span>
                        <strong>{entry.name}</strong>
                        <em>{entry.type}</em>
                      </button>
                    ))}
                  {!folderPicker.loading && !folderPicker.error && !folderPicker.entries.length && (
                    <div className={styles.folderPickerEmpty}>No child folders in this path.</div>
                  )}
                </div>
                <div className={styles.folderPickerFooter}>
                  <span>Current folder will be used as the SFTP start folder.</span>
                  <div className={styles.folderPickerActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => void closeFolderPicker()}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void chooseFolderPath()}
                    >
                      Use this folder
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className={styles.modalFooter}>
              <div className={styles.modalFooterLeft}>
                {draft.id && (
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() => {
                      const profile = profileMap.get(draft.id ?? '');
                      if (profile) void deleteProfile(profile);
                      closeDraftModal();
                    }}
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void testDraftConnection()}
                  disabled={testConnection.status === 'testing' || folderPickerStatus.status === 'connecting'}
                >
                  {testConnection.status === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
                {testConnection.message && (
                  <span
                    className={`${styles.connectionTestStatus} ${
                      testConnection.status === 'success'
                        ? styles.connectionTestSuccess
                        : testConnection.status === 'error'
                          ? styles.connectionTestError
                          : ''
                    }`}
                  >
                    {testConnection.message}
                  </span>
                )}
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={connectAfterSave}
                    onChange={(event) => setConnectAfterSave(event.target.checked)}
                  />
                  Connect after save
                </label>
              </div>
              <div className={styles.modalFooterActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => closeDraftModal()}>
                  Cancel
                </button>
                <button type="submit" className={styles.primaryButton}>
                  {draft.id ? 'Save changes' : 'Save connection'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {keyboardPrompt && (
        <div className={styles.modalBackdrop}>
          <form
            className={`${styles.modal} ${styles.promptModal}`}
            onSubmit={(event) => void submitKeyboardPrompt(event)}
          >
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>Additional authentication</div>
                <div className={styles.modalSubtitle}>
                  {keyboardPrompt.name || 'The SSH server requested more information.'}
                </div>
              </div>
            </div>
            {keyboardPrompt.instructions && (
              <div className={styles.promptInstructions}>{keyboardPrompt.instructions}</div>
            )}
            <div className={styles.promptList}>
              {keyboardPrompt.prompts.map((prompt, index) => (
                <label key={`${prompt.prompt}-${index}`} className={styles.formField}>
                  <span>{prompt.prompt}</span>
                  <input
                    type={prompt.echo === false ? 'password' : 'text'}
                    value={keyboardAnswers[index] ?? ''}
                    onChange={(event) =>
                      setKeyboardAnswers((current) =>
                        current.map((answer, itemIndex) =>
                          itemIndex === index ? event.target.value : answer,
                        ),
                      )
                    }
                    autoFocus={index === 0}
                  />
                </label>
              ))}
            </div>
            <div className={styles.modalFooter}>
              <span className={styles.footerSpacer} />
              <button type="submit" className={styles.primaryButton}>
                Continue
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return (
    <div className={styles.emptyWorkspace}>
      <div className={styles.emptyIcon}>⌁</div>
      <h2>Open a remote workspace</h2>
      <p>
        Save SSH profiles on the left, then open as many terminal sessions as you need. Switch to SFTP without
        reconnecting.
      </p>
      <button type="button" className={styles.primaryButton} onClick={onCreate}>
        ＋ Add SSH connection
      </button>
      <div className={styles.featureRow}>
        <span>
          <b>01</b> Password / key / agent
        </span>
        <span>
          <b>02</b> ANSI terminal colors
        </span>
        <span>
          <b>03</b> SFTP file browser
        </span>
      </div>
    </div>
  );
}

function SftpBrowser({
  sessionId,
  startPath = '/',
  onError,
}: {
  sessionId: string;
  startPath?: string;
  onError: (message: string) => void;
}) {
  const initialPath = normalizeSftpStartPath(startPath);
  const [pathValue, setPathValue] = useState(initialPath);
  const [pathInput, setPathInput] = useState(initialPath);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [selected, setSelected] = useState<SftpEntry | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const breadcrumbs = useMemo(() => remotePathBreadcrumbs(pathValue), [pathValue]);
  const directoryCount = useMemo(
    () => entries.filter((entry) => entry.type === 'directory').length,
    [entries],
  );
  const fileCount = entries.length - directoryCount;

  const load = useCallback(
    async (requestedPath: string, resolve = false) => {
      setLoading(true);
      setSelected(null);
      try {
        let targetPath = requestedPath.trim() || '.';
        if (resolve) {
          const resolved = await sdk.ssh.sftpRealpath(sessionId, targetPath);
          if (!resolved.ok || typeof resolved.data !== 'string')
            throw new Error(resultError(resolved, 'Unable to resolve remote path.'));
          targetPath = resolved.data;
        }
        const result = await sdk.ssh.sftpList(sessionId, targetPath);
        if (!result.ok || !result.data)
          throw new Error(resultError(result, 'Unable to list remote directory.'));
        setPathValue(targetPath);
        setPathInput(targetPath);
        setEntries(
          result.data.sort(
            (a, b) =>
              (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1) ||
              a.name.localeCompare(b.name),
          ),
        );
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
    },
    [onError, sessionId],
  );

  useEffect(() => {
    void load(initialPath, true);
  }, [initialPath, load]);

  const download = async (entry: SftpEntry) => {
    setTransferring(`Downloading ${entry.name}…`);
    try {
      const result = await sdk.ssh.sftpReadFile(sessionId, joinRemotePath(pathValue, entry.name));
      if (!result.ok || !result.data) {
        onError(resultError(result, 'Unable to download file.'));
        return;
      }
      const bytes = base64ToBytes(result.data.base64);
      const blobData = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([blobData], { type: 'application/octet-stream' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.data.name || entry.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setTransferring('');
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      for (const file of files) {
        if (file.size > MAX_TRANSFER_BYTES) {
          onError(`${file.name} is larger than 50 MB.`);
          continue;
        }
        setTransferring(`Uploading ${file.name}…`);
        const result = await sdk.ssh.sftpWriteFile(
          sessionId,
          joinRemotePath(pathValue, file.name),
          bufferToBase64(await file.arrayBuffer()),
        );
        if (!result.ok) onError(resultError(result, `Unable to upload ${file.name}.`));
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setTransferring('');
    }
    if (files.length) void load(pathValue);
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await uploadFiles(files);
  };

  const openEntry = (entry: SftpEntry) => {
    if (entry.type === 'directory') void load(joinRemotePath(pathValue, entry.name));
    else void download(entry);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (event.dataTransfer.types.includes('Files')) setDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.types.includes('Files')) event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const createDirectory = async () => {
    const name = window.prompt('New directory name');
    if (!name?.trim()) return;
    const result = await sdk.ssh.sftpMkdir(sessionId, joinRemotePath(pathValue, name.trim()));
    if (!result.ok) onError(resultError(result, 'Unable to create directory.'));
    else void load(pathValue);
  };

  const deleteEntry = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete “${selected.name}”?`)) return;
    const result = await sdk.ssh.sftpDelete(
      sessionId,
      joinRemotePath(pathValue, selected.name),
      selected.type === 'directory' ? 'directory' : 'file',
    );
    if (!result.ok) onError(resultError(result, 'Unable to delete remote item.'));
    else void load(pathValue);
  };

  const renameEntry = async () => {
    if (!selected) return;
    const name = window.prompt('New name', selected.name);
    if (!name?.trim() || name.trim() === selected.name) return;
    const result = await sdk.ssh.sftpRename(
      sessionId,
      joinRemotePath(pathValue, selected.name),
      joinRemotePath(pathValue, name.trim()),
    );
    if (!result.ok) onError(resultError(result, 'Unable to rename remote item.'));
    else void load(pathValue);
  };

  const submitPath = (event: FormEvent) => {
    event.preventDefault();
    void load(pathInput);
  };

  return (
    <div
      className={styles.sftpWorkspace}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className={styles.sftpDropOverlay}>
          <div className={styles.sftpDropCard}>
            <div className={styles.sftpDropIcon}>↑</div>
            <strong>Drop files to upload</strong>
            <span>Target: {pathValue}</span>
          </div>
        </div>
      )}
      <div className={styles.sftpToolbar}>
        <form className={styles.pathForm} onSubmit={submitPath}>
          <span className={styles.pathPrefix}>⌁</span>
          <input
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            aria-label="Remote path"
          />
          <button type="submit" className={styles.pathGo}>
            Go
          </button>
        </form>
        <div className={styles.sftpActions}>
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => void load(pathValue)}
            disabled={loading}
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => void load(parentRemotePath(pathValue))}
          >
            ↑ Up
          </button>
          <button type="button" className={styles.smallButton} onClick={createDirectory}>
            ＋ Folder
          </button>
          <button type="button" className={styles.smallButton} onClick={() => fileInputRef.current?.click()}>
            ↑ Upload
          </button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => void upload(event)} />
        </div>
      </div>
      <div className={styles.sftpMeta}>
        <nav className={styles.sftpBreadcrumbs} aria-label="Remote path breadcrumbs">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.path}-${index}`} className={styles.sftpBreadcrumbSegment}>
              {index > 0 && <span className={styles.sftpBreadcrumbSeparator}>/</span>}
              <button
                type="button"
                className={styles.sftpBreadcrumbButton}
                onClick={() => void load(crumb.path)}
                disabled={crumb.path === pathValue}
                title={crumb.path}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
        <div className={styles.sftpMetaStats}>
          <span>{directoryCount} folders</span>
          <span>{fileCount} files</span>
          {(loading || transferring) && (
            <span className={styles.sftpBusyPill}>{transferring || 'Loading…'}</span>
          )}
        </div>
      </div>
      <div className={styles.sftpTableWrap}>
        <table className={styles.sftpTable}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Modified</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={`${entry.name}-${entry.type}`}
                className={[
                  selected?.name === entry.name ? styles.sftpRowSelected : '',
                  entry.type === 'directory' ? styles.sftpDirectoryRow : '',
                  entry.type === 'link' ? styles.sftpLinkRow : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelected(entry)}
                onDoubleClick={() => openEntry(entry)}
                title={
                  entry.type === 'directory'
                    ? 'Double-click to open folder'
                    : entry.type === 'link'
                      ? 'Double-click to download link target'
                      : 'Double-click to download file'
                }
              >
                <td className={styles.sftpNameCell}>
                  <span
                    className={`${styles.fileIcon} ${
                      entry.type === 'directory'
                        ? styles.fileIconFolder
                        : entry.type === 'link'
                          ? styles.fileIconLink
                          : styles.fileIconFile
                    }`}
                    aria-hidden="true"
                  >
                    {entry.type === 'directory' ? '▰' : entry.type === 'link' ? '↗' : '▱'}
                  </span>
                  <span
                    className={entry.type === 'directory' ? styles.sftpDirectoryName : styles.sftpEntryName}
                  >
                    {entry.name}
                  </span>
                </td>
                <td>{entry.type}</td>
                <td>{entry.type === 'directory' ? '—' : formatBytes(entry.size)}</td>
                <td>{entry.mtime ? new Date(entry.mtime * 1000).toLocaleString() : '—'}</td>
                <td className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.rowActionButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      openEntry(entry);
                    }}
                    title={entry.type === 'directory' ? 'Open folder' : 'Download'}
                  >
                    {entry.type === 'directory' ? 'Open' : '↓'}
                  </button>
                </td>
              </tr>
            ))}
            {!entries.length && (
              <tr>
                <td colSpan={5} className={styles.tableEmpty}>
                  <div className={styles.sftpEmptyState}>
                    <div className={styles.sftpEmptyIcon}>{loading ? '↻' : '□'}</div>
                    <strong>{loading ? 'Loading remote directory…' : 'This directory is empty'}</strong>
                    <span>
                      {loading
                        ? 'Reading files from the remote host.'
                        : 'Drag files here or use Upload to add files.'}
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={styles.sftpFooter}>
        <div className={styles.sftpSelectionInfo}>
          {selected ? (
            <>
              <span className={styles.sftpSelectionLabel}>Selected</span>
              <strong title={selected.name}>{selected.name}</strong>
              <span>{selected.type}</span>
              {selected.type !== 'directory' && <span>{formatBytes(selected.size)}</span>}
            </>
          ) : (
            <span>Double-click folders to open. Drag files here to upload.</span>
          )}
        </div>
        <div className={styles.sftpSelectedActions}>
          {selected?.type === 'directory' && (
            <button type="button" className={styles.primarySmallButton} onClick={() => openEntry(selected)}>
              Open
            </button>
          )}
          <button
            type="button"
            className={styles.smallButton}
            disabled={!selected}
            onClick={() => void renameEntry()}
          >
            Rename
          </button>
          <button
            type="button"
            className={styles.smallButton}
            disabled={!selected}
            onClick={() => void deleteEntry()}
          >
            Delete
          </button>
          {selected && selected.type !== 'directory' && (
            <button
              type="button"
              className={styles.primarySmallButton}
              onClick={() => void download(selected)}
            >
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
