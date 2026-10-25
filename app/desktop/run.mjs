// Khởi chạy ứng dụng. Xoá ELECTRON_RUN_AS_NODE (VS Code/một số công cụ đặt biến này, khiến Electron chạy như Node thuần và không mở cửa sổ).
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env }).on('exit', (c) => process.exit(c ?? 0));
