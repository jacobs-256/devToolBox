import { createElement, type ComponentType, type ReactNode } from 'react';
import {
  VscCode,
  VscDebugDisconnect,
  VscDiff,
  VscFileBinary,
  VscGitMerge,
  VscGlobe,
  VscJson,
  VscKey,
  VscLink,
  VscLock,
  VscMarkdown,
  VscNewFile,
  VscRadioTower,
  VscRegex,
  VscShield,
  VscSymbolString,
  VscTerminal,
} from 'react-icons/vsc';
import { TbBrandJavascript, TbKey, TbLanguageHiragana, TbLetterU, TbQrcode, TbShieldLock, TbWifi } from 'react-icons/tb';

const vsc = {
  VscCode,
  VscDebugDisconnect,
  VscDiff,
  VscFileBinary,
  VscGitMerge,
  VscGlobe,
  VscJson,
  VscKey,
  VscLink,
  VscLock,
  VscMarkdown,
  VscNewFile,
  VscRadioTower,
  VscRegex,
  VscShield,
  VscSymbolString,
  VscTerminal,
} as const;

const tb = {
  TbBrandJavascript,
  TbKey,
  TbLanguageHiragana,
  TbLetterU,
  TbQrcode,
  TbShieldLock,
  TbWifi,
} as const;

export function resolveIconKey(iconKey?: string): ReactNode | null {
  const raw = typeof iconKey === 'string' ? iconKey.trim() : '';
  if (!raw) return null;
  const [pack, name] = raw.includes(':') ? raw.split(':', 2) : ['vsc', raw];
  if (!name) return null;
  if (pack === 'vsc') {
    const Cmp = (vsc as Record<string, unknown>)[name];
    if (typeof Cmp === 'function') return createElement(Cmp as ComponentType);
    return null;
  }
  if (pack === 'tb') {
    const Cmp = (tb as Record<string, unknown>)[name];
    if (typeof Cmp === 'function') return createElement(Cmp as ComponentType);
    return null;
  }
  return null;
}
