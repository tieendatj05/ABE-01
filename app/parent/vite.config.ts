import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Ứng dụng RIÊNG cho phụ huynh (không chung với app nhập liệu): trang web dạng điện thoại, chỉ xem kết quả khám của con bằng số CCCD.
export default defineConfig({
  root: 'app/parent',
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { host: true, port: 5174 },
});
