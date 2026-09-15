import type { SftpEntry, SshAuthMethod, SshEvent, SshSessionSummary } from './sdk';

export type Group = {
  id: string;
  name: string;
};

export type ConnectionProfile = {
  id: string;
  groupId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  agent?: string;
  hostFingerprint?: string;
  sftpStartPath?: string;
  hold?: boolean;
  proxy?: boolean;
  proxyProfileId?: string;
};

export type SessionTab = SshSessionSummary & {
  tabId: string;
  profileId: string;
  profileName: string;
  title: string;
  logs: ConnectionLogEntry[];
  panes: TerminalPaneState[];
  splitOrientation: 'horizontal' | 'vertical' | null;
};

export type ConnectionLogEntry = {
  id: string;
  at: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
};

export type TerminalPaneState = {
  id: string;
  terminalId: string;
};

export type TerminalHistory = Record<string, string>;
export type EventHandler = (event: SshEvent) => void;
export type { SftpEntry };
