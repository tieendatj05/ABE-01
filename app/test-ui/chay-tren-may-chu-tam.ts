// CHẠY CÁC KỊCH BẢN DEMO TRÊN MỘT MÁY CHỦ TẠM (dữ liệu giả, cổng ngẫu nhiên, xoá khi xong) để thử/kiểm chứng mà KHÔNG đụng máy chủ demo thật của bạn.
//   npx tsx app/test-ui/chay-tren-may-chu-tam.ts "anh-upenn-demo.ts --chuoi=6 --lat=4" "ten-ma-hoa.ts pham"
// Mỗi tham số là một kịch bản trong app/test-ui/ kèm đối số; chạy lần lượt trên CÙNG một máy chủ tạm (cần jar Spring).
import { spawn } from 'node:child_process';
import { startResearchStack } from '../../security/src/deploy/research-stack.js';

const cmds = process.argv.slice(2);
if (!cmds.length) throw new Error('Cú pháp: npx tsx app/test-ui/chay-tren-may-chu-tam.ts "<kịch bản.ts đối số>" ["<kịch bản khác>"…]');
const stack = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
const env = { ...process.env, DEMO_URL: stack.baseUrl, DEMO_CA: stack.caFile };
let code = 0;
try {
  for (const c of cmds) {
    const [script, ...args] = c.match(/"[^"]*"|\S+/g)!.map((x) => x.replace(/^"|"$/g, ''));
    console.log(`\n$ npx tsx app/test-ui/${script} ${args.join(' ')}`);
    // BẤT ĐỒNG BỘ: các nút cấp khoá của máy chủ tạm chạy trong CHÍNH tiến trình này, nên không được chặn vòng lặp sự kiện (spawnSync sẽ làm chúng không trả lời).
    const st = await new Promise<number>((res) => spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', `app/test-ui/${script}`, ...args], { env, stdio: 'inherit' }).on('close', (c) => res(c ?? 1)));
    if (st) code = st;
  }
} finally { await stack.stop(); }
process.exit(code);
