export type SdkError = { code: string; message: string; details?: unknown };
export type SdkResult<T> = { ok: true; data?: T } | { ok: false; error: SdkError };

type ResponseMessage =
  | { type: 'devtoolbox:sdk:response'; requestId: string; ok: true; data?: unknown }
  | { type: 'devtoolbox:sdk:response'; requestId: string; ok: false; error: SdkError };
type EventMessage = { type: 'devtoolbox:sdk:event'; domain: string; payload?: unknown };
type ReadyAckMessage = { type: 'devtoolbox:plugin:ready:ack' };

const pending = new Map<string, (res: SdkResult<unknown>) => void>();
const sshListeners = new Set<(ev: unknown) => void>();

let inited = false;
let readyAcked = false;
let readyTimer: number | null = null;

function initReadyHandshake() {
  if (readyTimer !== null) return;
  const send = () => {
    if (readyAcked) return;
    window.parent.postMessage({ type: 'devtoolbox:plugin:ready' }, '*');
  };
  send();
  readyTimer = window.setInterval(send, 1000);
  window.setTimeout(() => {
    if (readyAcked) return;
    if (readyTimer !== null) window.clearInterval(readyTimer);
    readyTimer = null;
  }, 15000);
}

export function initSdkEvents(): void {
  if (inited) return;
  inited = true;
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as unknown;
    const msg = data as ResponseMessage;
    if (msg && msg.type === 'devtoolbox:sdk:response') {
      const cb = pending.get(msg.requestId);
      if (!cb) return;
      pending.delete(msg.requestId);
      if (msg.ok) cb({ ok: true, data: msg.data });
      else cb({ ok: false, error: msg.error });
      return;
    }

    const ev = data as EventMessage;
    if (ev && ev.type === 'devtoolbox:sdk:event' && ev.domain === 'ssh') {
      sshListeners.forEach((fn) => {
        try {
          fn(ev.payload);
        } catch {
          return;
        }
      });
      return;
    }

    const ack = data as ReadyAckMessage;
    if (ack && ack.type === 'devtoolbox:plugin:ready:ack') {
      readyAcked = true;
      if (readyTimer !== null) window.clearInterval(readyTimer);
      readyTimer = null;
    }
  });

  initReadyHandshake();
}

export function callSdk<T = unknown>(
  method: string,
  params?: unknown,
  timeoutMs = 30000,
): Promise<SdkResult<T>> {
  initSdkEvents();
  const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const payload = { type: 'devtoolbox:sdk:request', requestId, method, params };
  window.parent.postMessage(payload, '*');
  return new Promise((resolve) => {
    pending.set(requestId, (res) => resolve(res as SdkResult<T>));
    window.setTimeout(() => {
      const cb = pending.get(requestId);
      if (!cb) return;
      pending.delete(requestId);
      resolve({ ok: false, error: { code: 'timeout', message: 'SDK request timeout' } });
    }, timeoutMs);
  });
}

export type SshAuthMethod = 'password' | 'privateKey' | 'agent' | 'keyboard-interactive';

export type SshProxyConnectParams = {
  sessionId?: string;
  profileId?: string;
  name?: string;
  holdKey?: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  agent?: string;
  hostFingerprint?: string;
};

export type SshConnectParams = {
  sessionId: string;
  terminalId: string;
  profileId?: string;
  hold?: boolean;
  holdKey?: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  agent?: string;
  hostFingerprint?: string;
  cols?: number;
  rows?: number;
  proxy?: SshProxyConnectParams;
};

export type SshSessionSummary = {
  sessionId: string;
  terminalId?: string;
  profileId?: string;
  hidden?: boolean;
  hold: boolean;
  holdKey?: string;
  host: string;
  port: number;
  username: string;
  status: 'connecting' | 'ready' | 'closed' | 'error';
  fingerprint?: string;
  connectedAt?: string;
  output?: string;
  proxySessionId?: string;
  proxyProfileId?: string;
  proxyName?: string;
  proxyHost?: string;
  proxyUsername?: string;
};

export type SftpEntry = {
  name: string;
  type: 'file' | 'directory' | 'link' | 'other';
  size: number;
  mtime?: number;
  mode?: number;
};

export type SshEvent =
  | { type: 'status'; sessionId: string; status: SshSessionSummary }
  | { type: 'data'; sessionId: string; terminalId?: string; stream: 'stdout' | 'stderr'; data: string }
  | {
      type: 'log';
      sessionId?: string;
      terminalId?: string;
      level: 'info' | 'warn' | 'error';
      message: string;
    }
  | { type: 'hostKey'; sessionId: string; fingerprint: string; verified: boolean }
  | {
      type: 'keyboardInteractive';
      sessionId: string;
      terminalId?: string;
      name: string;
      instructions: string;
      prompts: Array<{ prompt: string; echo?: boolean }>;
    }
  | { type: 'sftp'; sessionId: string; action: string; path?: string };

export const sdk = {
  storage: {
    get: (key: string) => callSdk('storage.get', { key }),
    set: (key: string, value: unknown) => callSdk('storage.set', { key, value }),
  },
  log: {
    info: (message: string, data?: unknown) => callSdk('log.info', { message, data }),
    warn: (message: string, data?: unknown) => callSdk('log.warn', { message, data }),
    error: (message: string, data?: unknown) => callSdk('log.error', { message, data }),
  },
  ssh: {
    connect: (params: SshConnectParams) => callSdk<SshSessionSummary>('ssh.connect', params, 60000),
    disconnect: (sessionId: string) => callSdk('ssh.disconnect', { sessionId }),
    closeTerminal: (sessionId: string, terminalId: string) =>
      callSdk('ssh.closeTerminal', { sessionId, terminalId }),
    listSessions: () => callSdk<SshSessionSummary[]>('ssh.listSessions'),
    write: (sessionId: string, terminalId: string, data: string) =>
      callSdk('ssh.write', { sessionId, terminalId, data }),
    resize: (sessionId: string, terminalId: string, cols: number, rows: number) =>
      callSdk('ssh.resize', { sessionId, terminalId, cols, rows }),
    respondKeyboard: (sessionId: string, answers: string[]) =>
      callSdk('ssh.respondKeyboard', { sessionId, answers }),
    sftpRealpath: (sessionId: string, remotePath = '.') =>
      callSdk<string>('ssh.sftpRealpath', { sessionId, path: remotePath }),
    sftpList: (sessionId: string, remotePath: string) =>
      callSdk<SftpEntry[]>('ssh.sftpList', { sessionId, path: remotePath }),
    sftpReadFile: (sessionId: string, remotePath: string) =>
      callSdk<{ name: string; base64: string }>('ssh.sftpReadFile', { sessionId, path: remotePath }, 60000),
    sftpWriteFile: (sessionId: string, remotePath: string, base64: string) =>
      callSdk('ssh.sftpWriteFile', { sessionId, path: remotePath, base64 }, 60000),
    sftpMkdir: (sessionId: string, remotePath: string) =>
      callSdk('ssh.sftpMkdir', { sessionId, path: remotePath }),
    sftpDelete: (sessionId: string, remotePath: string, type: 'file' | 'directory') =>
      callSdk('ssh.sftpDelete', { sessionId, path: remotePath, type }),
    sftpRename: (sessionId: string, sourcePath: string, destinationPath: string) =>
      callSdk('ssh.sftpRename', { sessionId, sourcePath, destinationPath }),
    onEvent: (cb: (ev: unknown) => void) => {
      initSdkEvents();
      sshListeners.add(cb);
      return () => sshListeners.delete(cb);
    },
  },
};
