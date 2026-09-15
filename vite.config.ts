import { defineConfig, type Connect, type Plugin, type ResolvedConfig, type ViteDevServer } from 'vite';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function coreToolAssets(): Plugin {
  const prefix = '/__core_tools__/';
  const mimeByExt: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
  };

  let rootDir = '';
  let outDir = '';
  let command: 'serve' | 'build' = 'serve';

  async function copyDir(src: string, dst: string) {
    const st = await fsp.stat(src).catch(() => null);
    if (!st) return;
    if (st.isFile()) {
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.copyFile(src, dst);
      return;
    }
    await fsp.mkdir(dst, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const e of entries) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) await copyDir(s, d);
      else if (e.isFile()) {
        await fsp.mkdir(path.dirname(d), { recursive: true });
        await fsp.copyFile(s, d);
      }
    }
  }

  return {
    name: 'core-tool-assets',
    configResolved(c: ResolvedConfig) {
      rootDir = c.root;
      outDir = c.build.outDir;
      command = c.command;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(prefix, async (req: Connect.IncomingMessage, res: Connect.ServerResponse, next: Connect.NextFunction) => {
        try {
          const url = typeof req.url === 'string' ? req.url : '';
          const pathname = decodeURIComponent(url.split('?')[0] ?? '');
          const rel = pathname.replace(/^\/+/, '');
          const base = path.join(rootDir, 'components', 'ModuleTools');
          const filePath = path.join(base, rel);
          if (!filePath.startsWith(base)) {
            res.statusCode = 403;
            res.end();
            return;
          }
          const stat = await fsp.stat(filePath).catch(() => null);
          if (!stat || !stat.isFile()) {
            next();
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          res.setHeader('Content-Type', mimeByExt[ext] ?? 'application/octet-stream');
          fs.createReadStream(filePath).pipe(res);
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      if (command !== 'build') return;
      const toolsDir = path.join(rootDir, 'components', 'ModuleTools');
      const folders = await fsp.readdir(toolsDir, { withFileTypes: true });
      for (const dirent of folders) {
        if (!dirent.isDirectory()) continue;
        const folderName = dirent.name;
        const manifestPath = path.join(toolsDir, folderName, 'manifest.json');
        const manifestRaw = await fsp.readFile(manifestPath, 'utf-8').catch(() => '');
        if (!manifestRaw) continue;
        let manifest: unknown = null;
        try {
          manifest = JSON.parse(manifestRaw) as unknown;
        } catch {
          manifest = null;
        }
        const entry =
          isRecord(manifest) && typeof manifest.entry === 'string' ? manifest.entry.trim().replace(/^\.\/+/, '') : '';
        if (!entry.toLowerCase().endsWith('.html')) continue;
        const entryDir = path.dirname(entry);
        const srcDir = path.join(toolsDir, folderName, entryDir);
        const dstDir = path.join(outDir, '__core_tools__', folderName, entryDir);
        await copyDir(srcDir, dstDir);
      }
    },
  };
}

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [
    react(),
    coreToolAssets(),
    electron([
      {
        entry: path.resolve(__dirname, 'core/main/index.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            rollupOptions: {
              external: ['mqtt', 'ws', 'ssh2', 'bufferutil', 'utf-8-validate'],
            },
          },
        },
      },
      {
        entry: path.resolve(__dirname, 'core/main/preload/index.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/preload'),
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    dedupe: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/search',
      '@codemirror/history',
    ],
    alias: {
      '@components': path.resolve(__dirname, 'core/renderer/components'),
      '@@components': path.resolve(__dirname, 'core/packages/ui/src'),
      '@devtoolbox/ui': path.resolve(__dirname, 'core/packages/ui/src'),
      '@devtoolbox/core': path.resolve(__dirname, 'core/packages/core/src'),
      // events polyfill: override vite-plugin-electron-renderer interception of Node.js built-ins
      events: path.resolve(__dirname, 'node_modules/events/events.js'),
    },
  },
  define: {
    'process.env': {},
    'process.stdout': 'undefined',
    'process.stderr': 'undefined',
    'process.version': '""',
  },
  root: 'core/renderer',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: false,
  },
});
