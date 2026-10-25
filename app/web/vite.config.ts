import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app/web',
  base: './', // tải bằng file:// trong app desktop
  plugins: [react()],
  define: { __EDITION__: JSON.stringify(process.env.MEDABE_EDITION ?? 'admin') }, // 'user' = bản không chứa mã quản trị
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { host: true, port: 5173 },
});
