// TẢI MỘT VÀI BỆNH NHÂN từ bộ UPENN-GBM (TCIA, giấy phép CC BY 4.0, DOI 10.7937/TCIA.709X-DN49) qua API công khai của TCIA — KHÔNG cần tải cả bộ 139 GB.
//   npx tsx app/test-ui/tai-upenn.ts            -> 5 bệnh nhân đầu tiên, mỗi người 2 chuỗi (FLAIR + T1 sau tiêm thuốc), vào E:\TLCN\du-lieu-anh\
//   npx tsx app/test-ui/tai-upenn.ts 3          -> 3 bệnh nhân
//   npx tsx app/test-ui/tai-upenn.ts UPENN-GBM-00006 UPENN-GBM-00007   -> đúng các mã này
// Dữ liệu tải về là DỮ LIỆU NGƯỜI THẬT ĐÃ ẨN DANH. Không tìm cách nhận dạng lại. Khi dùng phải ghi nguồn (xem NGHIEN_CUU_CPABE/04_...md). Thư mục đích đã nằm trong .gitignore.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const API = 'https://services.cancerimagingarchive.net/nbia-api/services/v1';
const COLLECTION = 'UPENN-GBM';
const OUT = resolve(process.env.UPENN_OUT ?? 'E:/TLCN/du-lieu-anh');
const MAX_MB_PER_SERIES = 25;
const WANT: { tag: string; re: RegExp }[] = [{ tag: 'flair', re: /flair/i }, { tag: 't1-sau-tiem', re: /t1.*(stealth|post|gd)/i }];

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`TCIA ${r.status} cho ${path}`);
  return (await r.json()) as T;
}

/** Giải nén zip qua thư mục trung tâm (hỗ trợ cờ "data descriptor" mà TCIA dùng). Chỉ lấy các tệp .dcm; bỏ qua mọi đường dẫn có "..". */
function unzipDcm(zip: Buffer, dest: string): number {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 70_000); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Không phải tệp zip hợp lệ');
  const n = zip.readUInt16LE(eocd + 10); let p = zip.readUInt32LE(eocd + 16); let count = 0;
  for (let i = 0; i < n; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Thư mục trung tâm zip hỏng');
    const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20), usize = zip.readUInt32LE(p + 24);
    const nlen = zip.readUInt16LE(p + 28), xlen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32), lho = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (!/\.dcm$/i.test(name) || name.includes('..') || name.includes(':')) continue;
    const dpos = lho + 30 + zip.readUInt16LE(lho + 26) + zip.readUInt16LE(lho + 28);
    const raw = zip.subarray(dpos, dpos + csize);
    const data = method === 0 ? raw : inflateRawSync(raw);
    if (data.length !== usize) throw new Error(`Kích thước giải nén không khớp cho ${name}`);
    writeFileSync(join(dest, `${String(++count).padStart(4, '0')}.dcm`), data);        // tên mới theo thứ tự; không dùng tên tệp trong zip
  }
  return count;
}

interface Series { SeriesInstanceUID: string; SeriesDescription: string; ImageCount: number; FileSize: number }
const arg = process.argv.slice(2);
const ids = arg.filter((a) => /^UPENN-GBM-\d{5}/.test(a));
const limit = ids.length ? ids.length : Number(arg.find((a) => /^\d+$/.test(a)) ?? 5);

const patients = ids.length ? ids : (await getJson<{ PatientId: string }[]>(`getPatient?Collection=${COLLECTION}&format=json`)).map((p) => p.PatientId);
mkdirSync(OUT, { recursive: true });
let done = 0;
for (const pid of patients) {
  if (done >= limit) break;
  const series = await getJson<Series[]>(`getSeries?Collection=${COLLECTION}&PatientID=${encodeURIComponent(pid)}&format=json`);
  const picks = WANT.map((w) => ({ w, s: series.find((s) => w.re.test(s.SeriesDescription) && s.FileSize / 1048576 <= MAX_MB_PER_SERIES && s.ImageCount <= 250) })).filter((x) => x.s);
  if (picks.length < WANT.length) { console.log(`- ${pid}: thiếu chuỗi cần thiết hoặc quá nặng, bỏ qua`); continue; }
  for (const { w, s } of picks) {
    const dest = join(OUT, pid, w.tag);
    if (existsSync(dest) && existsSync(join(dest, '0001.dcm'))) { console.log(`= ${pid}/${w.tag}: đã có`); continue; }
    mkdirSync(dest, { recursive: true });
    const r = await fetch(`${API}/getImage?SeriesInstanceUID=${s!.SeriesInstanceUID}`, { signal: AbortSignal.timeout(600_000) });
    if (!r.ok) throw new Error(`Tải chuỗi lỗi ${r.status}`);
    const n = unzipDcm(Buffer.from(await r.arrayBuffer()), dest);
    console.log(`✓ ${pid}/${w.tag}: ${n} lát (${(s!.FileSize / 1048576).toFixed(1)} MB) — "${s!.SeriesDescription}"`);
  }
  done++;
}
console.log(`\nXong ${done} bệnh nhân -> ${OUT}`);
