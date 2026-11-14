// Thử đọc một thư mục DICOM thật: in thông số kỹ thuật (KHÔNG in tên/mã bệnh nhân) và lời khuyên của trợ lý cho từng lát.
//   npx tsx app/test-ui/dicom-thu-file.ts E:\TLCN\du-lieu-anh\UPENN-GBM-00002\flair
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adviseImage } from '../../security/src/client/advisor.js';
import { dicomToRgba, parseDicom, sortSlices } from '../../security/src/client/dicom.js';

const dir = process.argv[2];
if (!dir) throw new Error('Cú pháp: npx tsx app/test-ui/dicom-thu-file.ts <thư mục .dcm>');
const slices = sortSlices(readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.dcm')).map((f) => parseDicom(readFileSync(join(dir, f)))));
const m = slices[0].meta;
console.log(`${slices.length} lát | ${m.cols}x${m.rows} | ${m.bitsAllocated} bit | ${m.modality}/${m.bodyPart} | "${m.seriesDescription}" | nguồn nhận ra: ${m.sourceId ? 'UPENN-GBM' : 'không'} | cờ định danh: ${m.hasIdentityTags}`);
const kinds: Record<string, number> = {};
slices.forEach((s, i) => {
  const a = adviseImage(dicomToRgba(s), s.meta);
  kinds[a.decision] = (kinds[a.decision] ?? 0) + 1;
  if (i % 10 === 0) console.log(`  lát ${String(i + 1).padStart(2)} (inst ${s.meta.instanceNumber}): ${a.decision.padEnd(11)} tín hiệu ${(a.contentRatio * 100).toFixed(0).padStart(3)}% ${a.regions[0] ? JSON.stringify(a.regions[0].rect) + ' -> ' + a.regions[0].khoas : ''}`);
});
console.log('tổng hợp:', kinds);
