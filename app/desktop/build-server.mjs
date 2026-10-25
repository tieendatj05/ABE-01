// Dựng "máy chủ nhúng" cho MedABE-Admin.exe: gói demo.ts thành một file ESM + jar Spring + Java runtime rút gọn (jlink).
// Kết quả: release/server-stage/server/{server.mjs, medabe-storage.jar, jre/}. pack.mjs đưa thư mục này vào resources/ của ứng dụng.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const out = resolve('release', 'server-stage', 'server');
rmSync(resolve('release', 'server-stage'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['security/src/deploy/demo.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: join(out, 'server.mjs'), logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
if (!existsSync(resolve('app/parent/dist/index.html'))) throw new Error('Chưa build app phụ huynh: npm run parent:build');
cpSync(resolve('app/parent/dist'), join(out, 'parent'), { recursive: true });
const jarDir = resolve('security/storage/target');
const jar = readdirSync(jarDir).find((f) => /^medabe-storage-.*\.jar$/.test(f));
if (!jar) throw new Error('Chưa có jar Spring: cd security/storage && ./mvnw -DskipTests package');
cpSync(join(jarDir, jar), join(out, 'medabe-storage.jar'));
const found = (process.env.JAVA_HOME ? [join(process.env.JAVA_HOME, 'bin', 'jlink.exe')] : []).concat(
  execFileSync('where', ['jlink'], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean)).find((p) => existsSync(p));
if (!found) throw new Error('Không tìm thấy jlink (cần JDK 25, đặt JAVA_HOME)');
const jlink = found;
const mods = 'java.base,java.logging,java.sql,java.naming,java.management,java.desktop,java.instrument,java.xml,java.net.http,java.security.jgss,java.security.sasl,java.compiler,java.rmi,java.prefs,java.transaction.xa,java.sql.rowset,jdk.unsupported,jdk.crypto.ec,jdk.management,jdk.net,jdk.zipfs,jdk.naming.dns';
execFileSync(jlink, ['--add-modules', mods, '--strip-debug', '--no-header-files', '--no-man-pages', '--compress', 'zip-6', '--output', join(out, 'jre')], { stdio: 'inherit' });
console.log('Đã dựng máy chủ nhúng:', out);
