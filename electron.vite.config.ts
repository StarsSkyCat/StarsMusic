import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  main: { build: { rolldownOptions: { input: {
    index: resolve('src/main/index.ts'), 'netease-worker': resolve('src/main/netease-worker.ts'), 'kugou-worker': resolve('src/main/kugou-worker.ts'),
  } } } },
  preload: {
    build: {
      // 沙箱 preload 不支持 ESM；所有本地导入打进单个 CJS 文件。
      rolldownOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    plugins: [vue(), {
      name: 'production-content-security-policy',
      apply: 'build',
      transformIndexHtml(html) {
        return html
          .replace("connect-src 'self' ws://127.0.0.1:5173", "connect-src 'none'")
          .replace("style-src 'self' 'unsafe-inline'", "style-src 'self'");
      },
    }],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
});
