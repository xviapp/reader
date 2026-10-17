import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// Chrome and Edge load woff2, so KaTeX's woff and ttf fallbacks only add APK weight.
const katexWoff2Only: Plugin = {
  name: 'katex-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/u.test(id)) return null;
    return code.replace(/,url\([^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/gu, '');
  },
};

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [katexWoff2Only],
  build: {
    outDir: '../dist/lan-web', emptyOutDir: true, target: 'es2022',
    assetsInlineLimit: 0, sourcemap: false,
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
