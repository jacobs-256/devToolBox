import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './PluginHost.module.css';
import { useTheme } from '../../theme';
import { useI18n } from '../../i18n';

type RequestMessage = {
  type: 'devtoolbox:sdk:request';
  requestId: string;
  pluginId?: string;
  method: string;
  params?: unknown;
};

type ResponseMessage =
  | { type: 'devtoolbox:sdk:response'; requestId: string; ok: true; data?: unknown }
  | {
      type: 'devtoolbox:sdk:response';
      requestId: string;
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };

type SdkError = { code: string; message: string; details?: unknown };
type SdkResult = { ok: boolean; data?: unknown; error?: SdkError };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asRequestMessage(v: unknown): RequestMessage | null {
  if (!isRecord(v)) return null;
  if (v.type !== 'devtoolbox:sdk:request') return null;
  if (typeof v.requestId !== 'string') return null;
  if (typeof v.method !== 'string') return null;
  const msg = v as RequestMessage;
  return msg;
}

function logToMain(pluginId: string, level: string, message: string, data?: unknown) {
  const api = window.electronAPI;
  if (!api?.pluginLog) return;
  void api.pluginLog(pluginId, { level, message, data });
}

async function callSdk(pluginId: string, method: string, params: unknown): Promise<SdkResult> {
  if (
    method === 'log.debug' ||
    method === 'log.info' ||
    method === 'log.warn' ||
    method === 'log.error' ||
    method === 'log.log'
  ) {
    const p = isRecord(params) ? params : {};
    const message = typeof p.message === 'string' ? p.message : typeof params === 'string' ? params : '';
    const data = p.data;
    const api = window.electronAPI;
    if (api?.pluginLog) void api.pluginLog(pluginId, { level: method.split('.')[1], message, data });
    return { ok: true, data: true };
  }

  const api = window.electronAPI;
  if (!api) return { ok: false, error: { code: 'not_supported', message: 'electronAPI not available' } };

  if (method === 'http.request') return api.pluginHttpRequest(pluginId, params);

  if (method === 'storage.get') {
    const p = isRecord(params) ? params : {};
    return api.pluginStorageGet(pluginId, String(p.key ?? ''));
  }
  if (method === 'storage.set') {
    const p = isRecord(params) ? params : {};
    return api.pluginStorageSet(pluginId, String(p.key ?? ''), p.value);
  }
  if (method === 'storage.delete') {
    const p = isRecord(params) ? params : {};
    return api.pluginStorageDelete(pluginId, String(p.key ?? ''));
  }
  if (method === 'storage.list') {
    const p = isRecord(params) ? params : {};
    return api.pluginStorageList(pluginId, typeof p.prefix === 'string' ? p.prefix : undefined);
  }
  if (method === 'storage.clear') return api.pluginStorageClear(pluginId);

  if (method === 'fs.openFileDialog') return api.pluginFsOpenFileDialog(pluginId, params);
  if (method === 'fs.saveFileDialog') return api.pluginFsSaveFileDialog(pluginId, params);
  if (method === 'fs.readFile') {
    const p = isRecord(params) ? params : {};
    return api.pluginFsReadFile(
      pluginId,
      String(p.fileToken ?? ''),
      typeof p.encoding === 'string' ? p.encoding : undefined,
    );
  }
  if (method === 'fs.writeFile') {
    const p = isRecord(params) ? params : {};
    return api.pluginFsWriteFile(
      pluginId,
      String(p.fileToken ?? ''),
      String(p.content ?? ''),
      typeof p.encoding === 'string' ? p.encoding : undefined,
    );
  }

  if (method === 'system.openExternal') {
    const p = isRecord(params) ? params : {};
    return api.pluginSystemOpenExternal(pluginId, String(p.url ?? ''));
  }
  if (method === 'system.revealPath') {
    const p = isRecord(params) ? params : {};
    return api.pluginSystemRevealPath(pluginId, String(p.pathToken ?? ''));
  }
  if (method === 'system.openPath') {
    const p = isRecord(params) ? params : {};
    return api.pluginSystemOpenPath(pluginId, String(p.pathToken ?? ''));
  }
  if (method === 'system.notify') return api.pluginSystemNotify(pluginId, params);
  if (method === 'system.getInfo') return api.pluginSystemGetInfo(pluginId);
  if (method === 'system.getEnv') {
    const p = isRecord(params) ? params : {};
    const keys = Array.isArray(p.keys) ? p.keys.filter((k): k is string => typeof k === 'string') : [];
    return api.pluginSystemGetEnv(pluginId, keys);
  }

  if (method === 'socket.serverStart') return api.pluginSocketServerStart(pluginId, params);
  if (method === 'socket.serverStop') return api.pluginSocketServerStop(pluginId);
  if (method === 'socket.serverStatus') return api.pluginSocketServerStatus(pluginId);
  if (method === 'socket.serverSend') return api.pluginSocketServerSend(pluginId, params);
  if (method === 'socket.serverKick') return api.pluginSocketServerKick(pluginId, params);
  if (method === 'socket.clientConnect') return api.pluginSocketClientConnect(pluginId, params);
  if (method === 'socket.clientDisconnect') return api.pluginSocketClientDisconnect(pluginId);
  if (method === 'socket.clientStatus') return api.pluginSocketClientStatus(pluginId);
  if (method === 'socket.clientSend') return api.pluginSocketClientSend(pluginId, params);

  if (method === 'ssh.connect') return api.pluginSshConnect(pluginId, params);
  if (method === 'ssh.disconnect') return api.pluginSshDisconnect(pluginId, params);
  if (method === 'ssh.closeTerminal') return api.pluginSshCloseTerminal(pluginId, params);
  if (method === 'ssh.listSessions') return api.pluginSshListSessions(pluginId);
  if (method === 'ssh.write') return api.pluginSshWrite(pluginId, params);
  if (method === 'ssh.resize') return api.pluginSshResize(pluginId, params);
  if (method === 'ssh.respondKeyboard') return api.pluginSshRespondKeyboard(pluginId, params);
  if (method === 'ssh.sftpRealpath') return api.pluginSshSftpRealpath(pluginId, params);
  if (method === 'ssh.sftpList') return api.pluginSshSftpList(pluginId, params);
  if (method === 'ssh.sftpReadFile') return api.pluginSshSftpReadFile(pluginId, params);
  if (method === 'ssh.sftpWriteFile') return api.pluginSshSftpWriteFile(pluginId, params);
  if (method === 'ssh.sftpMkdir') return api.pluginSshSftpMkdir(pluginId, params);
  if (method === 'ssh.sftpDelete') return api.pluginSshSftpDelete(pluginId, params);
  if (method === 'ssh.sftpRename') return api.pluginSshSftpRename(pluginId, params);

  return { ok: false, error: { code: 'not_supported', message: `Unknown method: ${method}` } };
}

interface PluginHostProps {
  pluginId: string;
  entryUrl: string;
}

export default function PluginHost({ pluginId, entryUrl }: PluginHostProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const { theme } = useTheme();
  const { locale } = useI18n();
  const readySignalReceivedRef = useRef(false);

  const src = useMemo(() => {
    try {
      const u = new URL(entryUrl, window.location.href);
      u.searchParams.set('theme', theme);
      u.searchParams.set('locale', locale);
      return u.toString();
    } catch {
      return entryUrl;
    }
  }, [entryUrl, locale, theme]);

  useEffect(() => {
    setReady(false);
  }, [src]);

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => {
      if (!ready) logToMain(pluginId, 'warn', 'still loading', { src });
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [pluginId, ready, src]);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const iframeWin = iframeRef.current?.contentWindow;
      if (!iframeWin || event.source !== iframeWin) return;

      if (isRecord(event.data) && event.data.type === 'devtoolbox:plugin:ready') {
        if (readySignalReceivedRef.current) return;
        readySignalReceivedRef.current = true;
        logToMain(pluginId, 'info', 'ready signal received');
        iframeWin.postMessage({ type: 'devtoolbox:plugin:ready:ack' }, '*');
        setReady(true);
        return;
      }

      const req = asRequestMessage(event.data);
      if (!req) return;
      if (req.pluginId && req.pluginId !== pluginId) return;

      const result = await callSdk(pluginId, req.method, req.params);
      const res: ResponseMessage = result.ok
        ? { type: 'devtoolbox:sdk:response', requestId: req.requestId, ok: true, data: result.data }
        : {
            type: 'devtoolbox:sdk:response',
            requestId: req.requestId,
            ok: false,
            error: result.error ?? { code: 'io_error', message: 'Unknown error' },
          };
      iframeWin.postMessage(res, '*');
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [pluginId]);

  useEffect(() => {
    if (!ready) return;
    const iframeWin = iframeRef.current?.contentWindow;
    if (!iframeWin) return;
    iframeWin.postMessage({ type: 'devtoolbox:theme', theme }, '*');
  }, [ready, theme]);

  useEffect(() => {
    if (!ready) return;
    const iframeWin = iframeRef.current?.contentWindow;
    if (!iframeWin) return;
    iframeWin.postMessage({ type: 'devtoolbox:locale', locale }, '*');
  }, [locale, ready]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onPluginSocketEvent || !api?.offPluginSocketEvent) return;
    const handler = api.onPluginSocketEvent((pid: string, ev: unknown) => {
      if (pid !== pluginId) return;
      const iframeWin = iframeRef.current?.contentWindow;
      if (!iframeWin) return;
      iframeWin.postMessage({ type: 'devtoolbox:sdk:event', domain: 'socket', payload: ev }, '*');
    });
    return () => api.offPluginSocketEvent(handler);
  }, [pluginId]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onPluginSshEvent || !api?.offPluginSshEvent) return;
    const handler = api.onPluginSshEvent((pid: string, ev: unknown) => {
      if (pid !== pluginId) return;
      const iframeWin = iframeRef.current?.contentWindow;
      if (!iframeWin) return;
      iframeWin.postMessage({ type: 'devtoolbox:sdk:event', domain: 'ssh', payload: ev }, '*');
    });
    return () => api.offPluginSshEvent(handler);
  }, [pluginId]);
  if (!src) return <div className={styles.empty}>Plugin not available.</div>;

  return (
    <div className={styles.wrap}>
      <iframe
        ref={iframeRef}
        className={styles.frame}
        src={src}
        title={pluginId}
        onLoad={() => {
          logToMain(pluginId, 'info', 'iframe loaded');
          setReady(true);
        }}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin"
      />
      {!ready && <div className={styles.empty}>Loading...</div>}
    </div>
  );
}
