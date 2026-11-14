import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// APP TRA CỨU SỨC KHỎE (riêng, giao diện điện thoại): đăng nhập bằng tài khoản, chỉ ĐỌC, theo đúng quyền ABE; tự cập nhật khi máy khác nhập liệu.
export default defineConfig({
  root: 'app/parent',
  base: './',
  plugins: [react()],
  define: { __EDITION__: JSON.stringify('user') },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { host: true, port: 5174 },
});
