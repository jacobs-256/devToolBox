import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { sdk, type SshEvent } from './sdk';
import styles from './App.module.css';

type Props = {
  sessionId: string;
  terminalId: string;
  history: string;
  connected: boolean;
  title?: string;
  closable?: boolean;
  onClose?: () => void;
};

export default function TerminalPane({
  sessionId,
  terminalId,
  history,
  connected,
  title = 'Terminal',
  closable = false,
  onClose,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const historyRef = useRef(history);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: '#0d1117',
        foreground: '#d7e0ea',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#161b22',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#d29922',
        blue: '#79c0ff',
        magenta: '#d2a8ff',
        cyan: '#a5d6ff',
        white: '#f0f6fc',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#a5d6ff',
        brightMagenta: '#bc8cff',
        brightCyan: '#79c0ff',
        brightWhite: '#ffffff',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;

    if (historyRef.current) terminal.write(historyRef.current);

    const dataDisposable = terminal.onData((data) => {
      if (connected) void sdk.ssh.write(sessionId, terminalId, data);
    });
    const eventOff = sdk.ssh.onEvent((raw) => {
      const event = raw as SshEvent;
      if (
        event.type !== 'data' ||
        event.sessionId !== sessionId ||
        (event.terminalId && event.terminalId !== terminalId)
      )
        return;
      terminal.write(event.data);
    });

    const resize = () => {
      fit.fit();
      void sdk.ssh.resize(sessionId, terminalId, terminal.cols, terminal.rows);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.setTimeout(resize, 0);

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      eventOff();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [connected, sessionId, terminalId]);

  return (
    <div className={styles.terminalPane}>
      <div className={styles.terminalPaneHeader}>
        <span className={styles.terminalPaneTitle}>{title}</span>
        <span className={styles.terminalPaneMeta}>ANSI / 256-color</span>
        {closable && (
          <button
            type="button"
            className={styles.terminalPaneClose}
            onClick={onClose}
            aria-label="Close terminal pane"
          >
            ×
          </button>
        )}
      </div>
      <div className={styles.terminalShell}>
        <div ref={hostRef} className={styles.terminalHost} />
      </div>
    </div>
  );
}
