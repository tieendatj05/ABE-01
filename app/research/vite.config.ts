import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Giao diện LUỒNG NGHIÊN CỨU CP-ABE (tách khỏi app nhập liệu cũ). Chỉ kết nối HTTPS (CSP connect-src https:).
export default defineConfig({
  root: 'app/research',
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { host: true, port: 5175 },
});
