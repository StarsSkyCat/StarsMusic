import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  main: {},
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
