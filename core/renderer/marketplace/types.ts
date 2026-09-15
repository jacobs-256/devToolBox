export type PluginPermission =
  | 'http:external'
  | 'http:proxy'
  | 'fs:dialog'
  | 'fs:read'
  | 'fs:write'
  | 'storage:kv'
  | 'net:socket'
  | 'net:ssh'
  | 'bluetooth'
  | 'serial'
  | 'usb'
  | 'system:openExternal'
  | 'system:revealPath'
  | 'system:openPath'
  | 'system:notifications'
  | 'system:env:read'
  | 'system:getInfo';

export interface MarketplacePluginManifest {
  id: string;
  name: string;
  description: string;
  i18n?: Partial<Record<'en' | 'zh-CN', { name?: string; description?: string }>>;
  version?: string;
  sdkVersion: string;
  entry: string;
  categoryId: string;
  author: string;
  icon?: string;
  iconKey?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  permissions: PluginPermission[];
  httpDomains?: string[];
  tags?: string[];
  keywords?: string[];
  minAppVersion?: string;
  maintainers?: string[];
  envAllowlist?: string[];
  deprecated?: boolean;
  replacedBy?: string;
}

export interface MarketplaceRegistryEntry {
  manifest: MarketplacePluginManifest;
  downloadUrl: string;
  sha256: string;
  size?: number;
  publishedAt?: string;
  status?: 'active' | 'deprecated' | 'blocked';
}

export interface MarketplaceRegistry {
  schemaVersion: number;
  plugins: MarketplaceRegistryEntry[];
}

export interface InstalledMarketplacePlugin {
  id: string;
  version: string;
  enabled: boolean;
  installedAt: string;
  entryUrl: string;
  manifest: MarketplacePluginManifest;
}
