// Gói một thư mục ứng dụng đã đóng gói (Electron) thành MỘT FILE .exe duy nhất, bấm là chạy, không cần cài gì thêm -
// dùng IExpress có sẵn trong Windows (không cần tải công cụ ngoài). Giải nén vào %TEMP%, tự chạy app, tự dọn khi đóng app.
//   node app/desktop/make-single-exe.mjs <thư-mục-app> <tên.exe-chạy-bên-trong> <đường-dẫn-xuất-ra.exe>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

const [srcDir, runExe, outExe] = process.argv.slice(2);
if (!srcDir || !runExe || !outExe) { console.error('Dùng: node app/desktop/make-single-exe.mjs <thư-mục> <chạy.exe> <xuất-ra.exe>'); process.exit(1); }
const root = resolve(srcDir);

// Liệt kê toàn bộ cây thư mục, gom theo thư mục cha (IExpress yêu cầu mỗi [SourceFilesN] ứng với MỘT thư mục nguồn).
const byDir = new Map(); // "" | "locales" | "resources" -> [absPath,...]
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    const rel = relative(root, dir);
    if (!byDir.has(rel)) byDir.set(rel, []);
    byDir.get(rel).push(p);
  }
})(root);
const dirs = [...byDir.keys()].sort((a, b) => a.localeCompare(b)); // "" trước, rồi theo tên
if (dirs[0] !== '') throw new Error('Thiếu file ở thư mục gốc');

let fileIdx = 0;
const fileVars = []; // dòng FILEn="duong dan"
const sourceSections = []; // [SourceFilesN] ... ứng với mỗi thư mục
const sourceFilesList = []; // SourceFilesN=duong-dan-thu-muc\
dirs.forEach((dir, dirIdx) => {
  const files = byDir.get(dir);
  sourceFilesList.push(`SourceFiles${dirIdx}=${join(root, dir)}${sep}`);
  const lines = [`[SourceFiles${dirIdx}]`];
  for (const abs of files) {
    const v = `FILE${fileIdx++}`;
    fileVars.push(`${v}="${abs}"`);
    lines.push(`%${v}%=`);
  }
  sourceSections.push(lines.join('\r\n'));
});

const sed = [
  '[Version]', 'Class=IEXPRESS', 'SEDVersion=3', '',
  '[Options]', 'PackagePurpose=InstallApp', 'ShowInstallProgramWindow=0', 'HideExtractAnimation=1',
  'UseLongFileName=1', 'InsideCompressed=0', 'CAB_FixedSize=0', 'CAB_ResvCodeSigning=0', 'RebootMode=N',
  'InstallPrompt=%InstallPrompt%', 'DisplayLicense=%DisplayLicense%', 'FinishMessage=%FinishMessage%',
  'TargetName=%TargetName%', 'FriendlyName=%FriendlyName%', 'AppLaunched=%AppLaunched%',
  'PostInstallCmd=%PostInstallCmd%', 'AdminQuietInstCmd=%AdminQuietInstCmd%', 'UserQuietInstCmd=%UserQuietInstCmd%',
  'SourceFiles=SourceFiles', '',
  '[Strings]',
  'InstallPrompt=', 'DisplayLicense=', 'FinishMessage=',
  `TargetName=${resolve(outExe)}`,
  'FriendlyName=KSK',
  `AppLaunched=${runExe}`,
  'PostInstallCmd=<None>', 'AdminQuietInstCmd=', 'UserQuietInstCmd=',
  ...fileVars, '',
  '[SourceFiles]', ...sourceFilesList, '',
  ...sourceSections, '',
].join('\r\n');

const tmp = mkdtempSync(join(tmpdir(), 'iexpress-'));
const sedPath = join(tmp, 'pkg.sed');
writeFileSync(sedPath, sed, 'latin1'); // IExpress SED đọc ANSI; đường dẫn ở đây không dấu nên an toàn
console.log(`Đang đóng gói ${dirs.reduce((n, d) => n + byDir.get(d).length, 0)} file...`);
execFileSync('iexpress.exe', ['/N', '/Q', sedPath], { stdio: 'inherit' });
console.log('Đã tạo:', resolve(outExe));
