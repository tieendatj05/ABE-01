// Nhận diện PHẦN CỨNG của máy trạm (CPU ID, mainboard, BIOS, ổ đĩa, MAC) để buộc khoá thiết bị vào đúng máy này.
// Khoá lưu trên đĩa chỉ được nạp lại khi phần cứng hiện tại KHỚP với lúc đăng ký - chép nguyên thư mục dữ liệu sang
// máy khác thì app từ chối (ngay cả khi kẻ gian có cả file khoá lẫn tài khoản Windows).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { networkInterfaces, hostname, cpus, platform } from 'node:os';

export interface Hardware {
  cpu: string;
  board: string;
  bios: string;
  disk: string;
  macs: string[];   // chỉ để tham khảo/hiển thị: card mạng ảo/VPN đổi thường xuyên nên KHÔNG dùng để so khớp
  host: string;
}

const PLACEHOLDER = /^(|0|none|default string|to be filled by o\.e\.m\.?|system serial number|not specified|unknown|n\/a)$/i;
const clean = (s: string) => (PLACEHOLDER.test(s.trim()) ? '' : s.trim().toUpperCase());

/** Hai máy "cùng một máy" nếu phần lớn thành phần ổn định (CPU, board, BIOS, disk) khớp; chịu được việc thay 1 linh kiện. */
export function matchHardware(stored: Hardware, current: Hardware): { ok: boolean; matched: number; available: number } {
  const keys = ['cpu', 'board', 'bios', 'disk'] as const;
  const usable = keys.filter((k) => clean(stored[k]) && clean(current[k]));
  const matched = usable.filter((k) => clean(stored[k]) === clean(current[k])).length;
  const available = usable.length;
  // Cần ít nhất 2 thành phần và >= 75% thành phần có thể so sánh khớp nhau.
  return { ok: available >= 2 && matched >= Math.ceil(available * 0.75), matched, available };
}

/** Băm ổn định cho registry (không lộ số serial thật): chỉ các thành phần cố định + tên cấu hình. */
export function hardwareHash(h: Hardware): string {
  return createHash('sha256').update(['cpu', 'board', 'bios', 'disk'].map((k) => clean(h[k as keyof Hardware] as string)).join('|')).digest('hex');
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((res) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (err, out) => res(err ? '' : out.trim()));
  });

const ps = (script: string) =>
  new Promise<string>((res) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15_000, windowsHide: true }, (err, out) => res(err ? '' : out.trim()));
  });

export function localMacs(): string[] {
  return Object.values(networkInterfaces()).flat().filter((i): i is NonNullable<typeof i> => !!i && !i.internal && i.mac !== '00:00:00:00:00:00')
    .map((i) => i.mac.toUpperCase()).filter((m, i, a) => a.indexOf(m) === i).sort();
}

export async function collectHardware(): Promise<Hardware> {
  const base = { macs: localMacs(), host: hostname() };
  if (platform() === 'win32') {
    const [cpu, board, bios, disk] = await Promise.all([
      ps('(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId'),
      ps('(Get-CimInstance Win32_BaseBoard | Select-Object -First 1).SerialNumber'),
      ps('(Get-CimInstance Win32_BIOS | Select-Object -First 1).SerialNumber'),
      ps('(Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq 0 } | Select-Object -First 1).SerialNumber'),
    ]);
    return { cpu, board, bios, disk, ...base };
  }
  if (platform() === 'darwin') {
    // macOS: UUID và số serial của máy (IOPlatformExpertDevice) là định danh ổn định theo bo mạch; CPU chỉ là tên dòng chip nên yếu.
    const [io, cpu] = await Promise.all([run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']), run('sysctl', ['-n', 'machdep.cpu.brand_string'])]);
    const field = (name: string) => new RegExp('"' + name + '" = "([^"]+)"').exec(io)?.[1] ?? '';
    return { cpu: cpu || cpus()[0]?.model || '', board: field('IOPlatformUUID'), bios: field('IOPlatformSerialNumber'), disk: '', ...base };
  }
  if (platform() === 'linux') {
    const id = await run('cat', ['/etc/machine-id']);
    return { cpu: cpus()[0]?.model ?? '', board: id, bios: '', disk: '', ...base };
  }
  // Nền tảng khác: chỉ dùng thông tin hệ điều hành cung cấp (rất yếu: matchHardware sẽ từ chối vì thiếu thành phần).
  return { cpu: cpus()[0]?.model ?? '', board: '', bios: '', disk: '', ...base };
}
