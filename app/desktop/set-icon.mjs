// Dán icon mới vào một .exe đã đóng gói sẵn, KHÔNG cần đóng gói lại toàn bộ (không cần JDK/jlink).
//   node app/desktop/set-icon.mjs <duong-dan.exe> <duong-dan.ico>
import { readFile, writeFile } from 'node:fs/promises';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

const [exePath, icoPath] = process.argv.slice(2);
if (!exePath || !icoPath) { console.error('Dùng: node app/desktop/set-icon.mjs <exe> <ico>'); process.exit(1); }

const exe = NtExecutable.from(await readFile(exePath));
const res = NtExecutableResource.from(exe);
const groups = Resource.IconGroupEntry.fromEntries(res.entries);
if (groups.length !== 1) throw new Error('Không tìm thấy đúng 1 icon group trong file exe');
const iconFile = Data.IconFile.from(await readFile(icoPath));
Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups[0].id, groups[0].lang, iconFile.icons.map((i) => i.data));
res.outputResource(exe);
await writeFile(exePath, Buffer.from(exe.generate()));
console.log('Đã cập nhật icon:', exePath);
