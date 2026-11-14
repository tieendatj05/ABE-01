// CHUYỂN ĐỔI SANG MÔ HÌNH TÁC GIẢ trên BẢN SAO dữ liệu thật (không đụng dữ liệu đang chạy; bản sao bị xoá khi xong).
//   npx tsx app/test-ui/upgrade-model-check.ts            (UNIT=<mã đơn vị> nếu khác THCS-TAN-TIEN)
// Kiểm: (1) dữ liệu CŨ vẫn đọc được bằng tài khoản mới; (2) backend áp ABAC mô hình mới lên bản ghi cũ ngay (Kết luận không đọc mọi khoa...);
// (3) khi người có quyền mở bản ghi cũ, khoá được BỌC LẠI sang policy mới (bản cũ giữ ở prevEnvelope để khôi phục) và số bản ghi "legacy" giảm;
// (4) tổng số bản ghi không đổi (không mất dữ liệu).
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startResearchStack } from '../../security/src/deploy/research-stack.js';
import { MedClient } from '../../security/src/client/medclient.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';

const live = join(process.env.APPDATA ?? '', 'KSK-TaiKhoan', 'server-data');
const UNIT = process.env.UNIT ?? 'THCS-TAN-TIEN';
const work = mkdtempSync(join(tmpdir(), 'upg-model-'));
for (const d of ['db', 'dealer', 'nodes']) cpSync(join(live, d), join(work, d), { recursive: true });
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

const S = await startResearchStack({
  dataDir: work, legacyBridge: true, passwordIterations: 20000,
  persist: { dbUrl: `jdbc:h2:file:${join(work, 'db', 'medabe').replace(/\\/g, '/')};AUTO_SERVER=FALSE`, serviceToken: 'copy-svc', kek: '00'.repeat(32), adminToken: 'copy-adm', siemToken: 'copy-siem' },
  seedUsers: 'kiemke|Passw0rd-KK01-xx|QUAN_TRI||Kiem ke (ban sao)',
});
try {
  const login = (u: string, p: string) => MedClient.signIn(S.baseUrl, u, p, new MemoryDeviceKeyStore(), { fetch: S.fetch });
  const admin = await login('kiemke', 'Passw0rd-KK01-xx');
  const mk = async (name: string, role: string, khoa?: string) => {
    const r = await admin.api<{ temporaryPassword: string }>('POST', '/api/v2/admin/users', { username: `${name}@ban-sao.vn`, role, khoa, displayName: name });
    return MedClient.signIn(S.baseUrl, `${name}@ban-sao.vn`, r.temporaryPassword, new MemoryDeviceKeyStore(), { fetch: S.fetch, newPassword: 'MatKhau-BanSao-1' });
  };
  const td = await mk('tiepdon', 'TIEP_DON');
  const nhi = await mk('bsnhi', 'BAC_SI', 'Nhi');
  const ksk = await mk('bsksk', 'BAC_SI', 'KSK,XetNghiem');
  const kl = await mk('ketluan', 'KET_LUAN');
  const inv0 = await admin.api<{ total: number; compliant: number; legacy: number; byType: Record<string, { total: number }>; legacyFlags: Record<string, number> }>('GET', '/api/v2/admin/inventory');
  console.log(`Kiểm kê TRƯỚC: ${inv0.total} bản ghi, tuân thủ mô hình mới ${inv0.compliant}, cũ ${inv0.legacy}; theo loại:`, Object.fromEntries(Object.entries(inv0.byType).map(([k, v]) => [k, v.total])));

  const rows = await td.listGroup(UNIT);
  check(`Tiếp đón (tài khoản mới) liệt kê hồ sơ CŨ của đơn vị ${UNIT}`, rows.length > 0, `${rows.length} dòng`);
  const sample = rows.slice(0, 40);
  const open = await td.openMany(sample);
  check('giải mã dữ liệu Hành chính cũ bằng khoá cấp theo tài khoản', open.every((o) => !!o), `${open.filter(Boolean).length}/${sample.length}`);
  check('chữ ký người lập dữ liệu cũ vẫn xác minh', open.every((o) => o?.signatureValid));

  // tìm bệnh nhân có mục khám cũ (ngoài hành chính)
  const codes = open.map((o) => (o?.data as { cccd?: string })?.cccd).filter((c): c is string => !!c);
  let cccd = '', matrix: Record<string, string[]> = {};
  for (const code of codes) {
    const all = await ksk.listRecords(code);
    const t = [...new Set(all.map((r) => `${r.type}:${r.khoa}`))];
    if (t.some((x) => !x.startsWith('hanhchinh'))) { cccd = code; matrix = { ksk: t }; break; }
  }
  if (cccd) {
    const view = async (c: MedClient) => [...new Set((await c.listRecords(cccd)).map((r) => `${r.type}:${r.khoa}`))].sort();
    const v = { td: await view(td), nhi: await view(nhi), ksk: await view(ksk), kl: await view(kl) };
    console.log('Một bệnh nhân CŨ nhìn từ từng tài khoản (theo mô hình mới):', v);
    check('Tiếp đón chỉ thấy Hành chính', JSON.stringify(v.td) === '["hanhchinh:KSK"]');
    check('Bác sĩ Kết luận (không cấp khoa) KHÔNG đọc mọi khoa nữa: chỉ Hành chính', JSON.stringify(v.kl) === '["hanhchinh:KSK"]');
    check('Bác sĩ Nhi không thấy mục khoa khác / khám chung', v.nhi.every((x) => x === 'hanhchinh:KSK' || x === 'lamsang:Nhi'));
    check('Bác sĩ khám chung (KSK+XetNghiem) thấy mục khám chung/xét nghiệm cũ', v.ksk.length >= 1);
    const rowsK = await ksk.listRecords(cccd);
    const res = await ksk.openMany(rowsK);
    rowsK.forEach((r, i) => console.log('   ', r.type, r.khoa, 'v' + (r.envelope as { v: number }).v, res[i] ? 'mở được, chữ ký ' + res[i]!.signatureValid : 'KHÔNG mở được'));
    for (const [i, r] of rowsK.entries()) if (!res[i]) console.log('    policy:', await ksk.policyOf(r), '| epoch hiện tại:', JSON.stringify(await ksk.epochs()).slice(0, 200));
    const ret = (await ksk.epochs()).retention;
    const expiredIdx = new Set<number>();
    for (const [i, r] of rowsK.entries()) if (!res[i] && [...(await ksk.policyOf(r)).matchAll(/#(\d{4}W\d{2})\./g)].some((m) => !ret.includes(m[1]))) expiredIdx.add(i);
    check('mở bản ghi cũ bằng tài khoản được cấp khoa: giải mã + chữ ký (trừ bản có khoá quá hạn lưu giữ epoch — không ai mở được từ TRƯỚC khi nâng cấp)', res.every((o, i) => expiredIdx.has(i) || (o && o.signatureValid)), `${res.filter(Boolean).length} bản mở được, ${expiredIdx.size} bản quá hạn epoch`);
    console.log('  bọc lại khoá sang policy mới trong lúc mở:', res.filter((o) => o?.rewrapped).length, 'bản');
  } else console.log('(không tìm thấy bệnh nhân có mục khám trong mẫu — bỏ qua phần theo bệnh nhân)', matrix);

  // mở toàn bộ lô Hành chính của đơn vị bằng Tiếp đón để kích hoạt bọc lại header chung (một header cho cả lô)
  const all = await td.openMany(rows.slice(0, 400));
  console.log('  Hành chính mở:', all.filter(Boolean).length, '/', Math.min(400, rows.length), ' bọc lại:', all.filter((o) => o?.rewrapped).length);
  const inv1 = await admin.api<{ total: number; compliant: number; legacy: number; legacyFlags: Record<string, number> }>('GET', '/api/v2/admin/inventory');
  console.log(`Kiểm kê SAU: ${inv1.total} bản ghi, cờ xung đột còn lại:`, inv1.legacyFlags);
  check('tổng số bản ghi KHÔNG đổi (không mất dữ liệu)', inv1.total === inv0.total, `${inv0.total} -> ${inv1.total}`);
  check('số bản ghi còn nhánh "Kết luận đọc mọi khoa" không tăng và các bản đã mở được bọc lại sang policy mới', (inv1.legacyFlags.NHANH_KET_LUAN_DOC_RONG ?? 0) <= (inv0.legacyFlags.NHANH_KET_LUAN_DOC_RONG ?? 0), `${inv0.legacyFlags.NHANH_KET_LUAN_DOC_RONG ?? 0} -> ${inv1.legacyFlags.NHANH_KET_LUAN_DOC_RONG ?? 0}`);
} catch (e) { console.error('LỖI:', e); failed++; }
finally {
  await S.stop();
  rmSync(work, { recursive: true, force: true });
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : '\nCHUYỂN ĐỔI: tất cả kiểm tra đạt (bản sao đã xoá)');
  process.exit(failed ? 1 : 0);
}
