// CHỨNG MINH ABE THEO TỪNG KỊCH BẢN (chạy trực tiếp trên MÁY CHỦ DEMO đang chạy, đăng nhập bằng các tài khoản mẫu thật, giải mã thật):
//   npx tsx app/test-ui/demo-chung-minh-abe.ts            (tất cả)         |   --chi=S3,S5 (chỉ các kịch bản này)   |   --bo-qua-gio (bỏ S8 — kịch bản tạm đóng cửa)
// Mỗi kịch bản in BẰNG CHỨNG và ✓/✗. Dùng bệnh nhân giả riêng (CCCD 048212604711); chạy lại an toàn (không nhân đôi dữ liệu).
// Tác dụng phụ trên máy chủ demo (nói trước): S7 tạo 1 tài khoản bác sĩ tạm (tên bs.thu.<số>@congty.vn) và gỡ khoa Xét nghiệm của nó (tăng bộ đếm epoch của MED:Khoa:XetNghiem);
// S8 đóng cửa ~2 giây rồi trả LỊCH CŨ; S10 tạo 1 tài khoản Giám sát ở trạng thái chờ duyệt (rồi khoá nó). Các tài khoản tạm đều được khoá khi xong.
import { cleanupDevices, DEMO_URL, demoFetch, loginDemo, loginGiamSat } from './demo-util.js';
import { listImages, openImage, saveImage } from '../../security/src/client/imaging.js';
import { MedClient, type RecordRow } from '../../security/src/client/medclient.js';
import { COLOR, PHANTOM, encodePng, hasColor, makePhantom } from '../../security/src/research/fake-image.js';
import { MemoryDeviceKeyStore } from '../../security/src/research/keys.js';
import { UNITS } from '../web/src/data/catalog.js';
import { blank } from '../web/src/model.js';

const PATIENT = '048212604711';
const NAME = 'NGUYEN THI BANG CHUNG (gia)';
const CANARY = { mat: 'CANARY-MAT-BANGCHUNG', nhi: 'CANARY-NHI-BANGCHUNG', xn: 'CANARY-XETNGHIEM-BANGCHUNG' };
const only = (process.argv.find((a) => a.startsWith('--chi=')) ?? '').slice(6).split(',').filter(Boolean);
const skipHours = process.argv.includes('--bo-qua-gio');

let pass = 0, fail = 0, skipped = 0;
const ok = (cond: boolean, msg: string, extra = '') => { console.log(`   ${cond ? '✓' : '✗ KHÔNG ĐẠT'} ${msg}${extra ? ' — ' + extra : ''}`); cond ? pass++ : fail++; };
const note = (msg: string) => console.log(`   · ${msg}`);
const raw = (c: MedClient, path: string, init: RequestInit = {}) => demoFetch(DEMO_URL + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${c.s.token}`, ...(init.headers as Record<string, string>) } });

async function tryLogin(u: string): Promise<MedClient | null> {
  try { return await loginDemo(u); } catch (e) { note(`(không đăng nhập được ${u}: ${(e as Error).message.slice(0, 60)})`); return null; }
}
const brief = (rows: RecordRow[]) => rows.map((r) => `${r.type}:${r.khoa}`).sort().join(' | ') || '(không có gì)';
const dataOf = async (c: MedClient, rows: RecordRow[]) => JSON.stringify((await c.openMany(rows)).map((x) => x?.data ?? null));
const colors = (v: { pixels: { w: number; h: number; data: Uint8Array | Uint8ClampedArray } }) => ({ mat: hasColor(v.pixels as never, COLOR.mat), nhiTmh: hasColor(v.pixels as never, COLOR.nhiTmh), ksk: hasColor(v.pixels as never, COLOR.ksk) });

console.log(`MÁY CHỦ: ${DEMO_URL}\nBỆNH NHÂN GIẢ: ${NAME} — CCCD ${PATIENT}\n`);
const nl = (await tryLogin('nhaplieu01'))!, nl2 = await tryLogin('nhaplieu02'), td = (await tryLogin('tiepdon01'))!;
const mat = (await tryLogin('bsmat01'))!, nhi = (await tryLogin('bsnhi01'))!, tmh = await tryLogin('bstmh01'), nhimat = await tryLogin('bsnhimat01');
const ksk = await tryLogin('bsksk01'), tk = await tryLogin('bsthankinh01'), qt = (await tryLogin('quantri02'))!, gs = await loginGiamSat('Chung minh ABE: kich ban tu dong');   // Giám sát: đăng nhập + vượt MFA (thuộc tính ABE)
if (!nl || !td || !mat || !nhi || !qt) { await cleanupDevices(); throw new Error('Thiếu tài khoản mẫu cơ bản (nhaplieu01, tiepdon01, bsmat01, bsnhi01, quantri02): máy chủ demo chưa chạy bản mới hoặc chưa có tài khoản mẫu'); }

// ---- chuẩn bị dữ liệu (một lần)
const exist = await nl.listRecords(PATIENT);
if (!exist.some((r) => r.type === 'anh')) {
  await td.saveRecord({ patientCode: PATIENT, type: 'hanhchinh', khoa: 'KSK', group: UNITS[0].ma, name: NAME, data: { ...blank.hanhchinh(), hoTen: NAME, cccd: PATIENT, ngaySinh: '2013-06-21', gioiTinh: 'nu', lop: '6A', nguonChiTra: 'BHYT' } });
  await nl.saveRecord({ patientCode: PATIENT, type: 'lamsang', khoa: 'Mat', data: { ketLuan: CANARY.mat } });
  await nl.saveRecord({ patientCode: PATIENT, type: 'lamsang', khoa: 'Nhi', data: { ketLuan: CANARY.nhi } });
  await nl.saveRecord({ patientCode: PATIENT, type: 'lamsang', khoa: 'XetNghiem', data: { ketLuan: CANARY.xn } });
  await saveImage(nl, { patientCode: PATIENT, original: { mime: 'image/png', bytes: encodePng(makePhantom(0)) }, pixels: makePhantom(0), modality: 'MRI',
    regions: [{ rect: PHANTOM.mat, khoas: ['Mat'], label: 'vung-xanh-duong' }, { rect: PHANTOM.nhiTmh, khoas: ['Nhi', 'TMH'], label: 'vung-do' }, { rect: PHANTOM.ksk, khoas: ['KSK'], label: 'vung-xanh-la' }] });
  console.log('(đã tạo dữ liệu mẫu cho bệnh nhân giả: hành chính, lâm sàng Mắt/Nhi/Xét nghiệm có "canary", ảnh 3 vùng màu)\n');
}
const rowsAs = (c: MedClient) => c.listRecords(PATIENT);

type Sc = { id: string; title: string; run: () => Promise<void> };
const scenarios: Sc[] = [
  { id: 'S1', title: 'Máy chủ chỉ giữ BẢN MÃ — không có họ tên, CCCD hay nội dung dạng rõ', run: async () => {
    const rows = await rowsAs(td); const lamsangRows = await rowsAs(nl);
    const stored = JSON.stringify(lamsangRows.map((r) => r.envelope)) + JSON.stringify(rows.map((r) => r.envelope));
    const hc = rows.find((r) => r.type === 'hanhchinh') as RecordRow & { envelope: { ciphertext?: string } };
    note(`hồ sơ hành chính trên máy chủ: bản mã ${((hc.envelope.ciphertext?.length ?? 0) / 2)} byte — ${(hc.envelope.ciphertext ?? '').slice(0, 48)}…`);
    const needles = [NAME.replace(' (gia)', ''), 'NGUYEN', 'BANGCHUNG', PATIENT, ...Object.values(CANARY)];
    const leaks = needles.filter((n) => stored.toLowerCase().includes(n.toLowerCase()));
    ok(!leaks.length, 'bản lưu (hành chính + lâm sàng + ảnh) KHÔNG chứa họ tên / CCCD / nội dung dạng rõ', leaks.length ? 'LỘ: ' + leaks.join(', ') : `đã tìm ${needles.length} chuỗi`);
    ok((await td.openMany([hc]))[0]?.data !== null, 'nhưng Tiếp đón (đủ quyền) giải mã được trên máy mình');
  } },
  { id: 'S2', title: 'Mỗi bác sĩ chỉ nhận ĐÚNG phần thuộc khoa của mình (lâm sàng)', run: async () => {
    const cases: [string, MedClient | null, { has: string[]; not: string[] }][] = [
      ['bsmat01 (Mắt)', mat, { has: [CANARY.mat], not: [CANARY.nhi, CANARY.xn] }],
      ['bsnhi01 (Nhi)', nhi, { has: [CANARY.nhi], not: [CANARY.mat, CANARY.xn] }],
      ['bsnhimat01 (Nhi+Mắt)', nhimat, { has: [CANARY.mat, CANARY.nhi], not: [CANARY.xn] }],
      ['bsksk01 (Khám chung+Xét nghiệm)', ksk, { has: [CANARY.xn], not: [CANARY.mat, CANARY.nhi] }],
      ['bsthankinh01 (Thần kinh)', tk, { has: [], not: [CANARY.mat, CANARY.nhi, CANARY.xn] }],
    ];
    for (const [label, c, exp] of cases) {
      if (!c) { skipped++; note(`BỎ QUA ${label}: tài khoản chưa có`); continue; }
      const rows = (await rowsAs(c)).filter((r) => r.type === 'lamsang');
      const text = await dataOf(c, rows);
      ok(exp.has.every((x) => text.includes(x)) && exp.not.every((x) => !text.includes(x)), `${label} nhận: ${brief(rows)}`, `ẩn ${c.restrictedCount(PATIENT)} mục khác`);
    }
  } },
  { id: 'S3', title: 'Có BẢN MÃ trong tay cũng không giải mã được (mã hoá, không phải che giao diện)', run: async () => {
    const nhiRow = (await rowsAs(nl)).find((r) => r.type === 'lamsang' && r.khoa === 'Nhi')!;
    note(`lấy bản mã lâm sàng Nhi (id ${nhiRow.id.slice(0, 8)}…) bằng tài khoản người nhập rồi ĐƯA cho bác sĩ Mắt`);
    ok((await mat.openRecord(nhiRow)) === null, 'bsmat01 có bản mã trong tay nhưng KHÔNG giải mã được (không có thuộc tính Khoa:Nhi)');
    const r = await raw(mat, `/api/records/${nhiRow.id}`);
    ok(r.status === 403, 'gọi thẳng API lấy bản ghi Nhi bằng phiên bsmat01 bị máy chủ từ chối', `HTTP ${r.status}`);
    ok((await rowsAs(mat)).every((x) => !(x.type === 'lamsang' && x.khoa === 'Nhi')), 'danh sách của bsmat01 không hề chứa bản ghi Nhi (máy chủ không tiết lộ sự tồn tại)');
  } },
  { id: 'S4', title: 'Quản trị KHÔNG đọc được bệnh án (dù có toàn quyền quản lý tài khoản)', run: async () => {
    ok(qt.s.attrs.length === 0, 'quantri02 không có thuộc tính ABE nào', JSON.stringify(qt.s.attrs));
    let threw = '';
    try { await qt.listRecords(PATIENT); } catch (e) { threw = (e as Error).message; }
    ok(/khoá chỉ mục/.test(threw), 'quantri02 không có khoá chỉ mục: không tra được hồ sơ nào', threw.slice(0, 60));
    const some = (await rowsAs(nl))[0];
    const r = await raw(qt, `/api/records/${some.id}`);
    ok(r.status === 403, 'gọi thẳng API bằng id bản ghi bị từ chối', `HTTP ${r.status}`);
    const users = await raw(qt, '/api/v2/admin/users');
    ok(users.status === 200, 'nhưng vẫn quản lý được tài khoản (tách quyền quản trị khỏi quyền đọc)');
  } },
  { id: 'S5', title: 'ẢNH theo vùng: mỗi khoa chỉ nhận vùng của mình, điểm ảnh ngoài vùng KHÔNG tồn tại trên máy', run: async () => {
    const seen = async (c: MedClient) => { const gs2 = await listImages(c, PATIENT); if (!gs2.length) return null; const v = await openImage(c, gs2[0].rows); return v && v.width > 0 ? { v, c: colors(v) } : null; };
    const cases: [string, MedClient | null, { mat: boolean; nhiTmh: boolean; ksk: boolean; original: boolean } | null][] = [
      ['bsmat01 (Mắt)', mat, { mat: true, nhiTmh: false, ksk: false, original: false }],
      ['bsnhi01 (Nhi)', nhi, { mat: false, nhiTmh: true, ksk: false, original: false }],
      ['bstmh01 (TMH)', tmh, { mat: false, nhiTmh: true, ksk: false, original: false }],
      ['bsnhimat01 (Nhi+Mắt)', nhimat, { mat: true, nhiTmh: true, ksk: false, original: false }],
      ['bsksk01 (KSK)', ksk, { mat: false, nhiTmh: false, ksk: true, original: false }],
      ['nhaplieu01 (người nhập)', nl, { mat: true, nhiTmh: true, ksk: true, original: true }],
      ['nhaplieu02 (người nhập khác)', nl2, null],
      ['tiepdon01 (Tiếp đón)', td, null],
      ['giamsat01 (Giám sát)', gs, { mat: true, nhiTmh: true, ksk: true, original: true }],
    ];
    if (gs) gs.accessReason = 'Chung minh ABE: kich ban S5';
    for (const [label, c, exp] of cases) {
      if (!c) { skipped++; note(`BỎ QUA ${label}: tài khoản chưa có`); continue; }
      const s = await seen(c);
      const got = s ? { ...s.c, original: !!s.v.original } : null;
      const same = JSON.stringify(got) === JSON.stringify(exp);
      ok(same, `${label}: ${got ? `xanh dương=${got.mat ? 'CÓ' : '—'} đỏ=${got.nhiTmh ? 'CÓ' : '—'} xanh lá=${got.ksk ? 'CÓ' : '—'} ảnh gốc=${got.original ? 'CÓ' : 'không'}` : 'không nhận ảnh nào'}`);
    }
  } },
  { id: 'S6', title: 'Chống GIẢ MẠO: sửa nhãn khoa / sửa bản mã bị phát hiện', run: async () => {
    const rows = await rowsAs(nl);
    const matRow = rows.find((r) => r.type === 'lamsang' && r.khoa === 'Mat')!;
    const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
    const relabelled = { ...clone(matRow), khoa: 'Nhi' };
    ok((await nl.openRecord(matRow))?.signatureValid === true, 'bản gốc: chữ ký hợp lệ');
    ok((await nl.openRecord(relabelled))?.signatureValid === false, 'đổi nhãn khoa Mắt→Nhi (để lọt sang bác sĩ Nhi): chữ ký SAI, bị phát hiện');
    const bad = clone(matRow) as RecordRow & { envelope: { ciphertext: string } };
    bad.envelope.ciphertext = (bad.envelope.ciphertext[0] === 'a' ? 'b' : 'a') + bad.envelope.ciphertext.slice(1);
    let rejected = false;
    try { const r = await nl.openRecord(bad); rejected = r === null || r.signatureValid === false; } catch { rejected = true; }
    ok(rejected, 'sửa 1 ký tự của bản mã: giải mã/chữ ký thất bại (AES-GCM toàn vẹn)');
  } },
  { id: 'S7', title: 'THU HỒI quyền: gỡ khoa của bác sĩ → hết khoá ngay, phiên bị đăng xuất', run: async () => {
    const user = `bs.thu.${Date.now()}@congty.vn`, temp = 'Tam-thoi-2026-ab', mine = 'Mat-khau-rieng-2026';
    const created = (await qt.api<{ userId: string }>('POST', '/api/v2/admin/users', { username: user, role: 'BAC_SI', khoa: 'XetNghiem', displayName: 'BS thu hoi quyen (tam)', password: temp }));
    try {
      const a = await MedClient.signIn(DEMO_URL, user, temp, new MemoryDeviceKeyStore(), { fetch: demoFetch, newPassword: mine });
      const before = await dataOf(a, (await a.listRecords(PATIENT)).filter((r) => r.type === 'lamsang'));
      ok(before.includes(CANARY.xn), `bác sĩ vừa được cấp khoa Xét nghiệm: ĐỌC được kết quả (${CANARY.xn})`);
      await qt.api('PUT', `/api/v2/admin/users/${created.userId}`, { khoa: 'Nhi' });
      let dead = '';
      try { await a.listRecords(PATIENT); } catch (e) { dead = (e as Error).message; }
      ok(dead !== '', 'quản trị gỡ khoa Xét nghiệm (đổi sang Nhi): phiên đang mở bị thu hồi NGAY', dead.slice(0, 50));
      const b = await MedClient.signIn(DEMO_URL, user, mine, new MemoryDeviceKeyStore(), { fetch: demoFetch });
      const after = await dataOf(b, (await b.listRecords(PATIENT)).filter((r) => r.type === 'lamsang'));
      ok(!after.includes(CANARY.xn) && after.includes(CANARY.nhi), 'đăng nhập lại: KHÔNG còn đọc được Xét nghiệm, chỉ đọc phần Nhi', 'khoá mới theo thuộc tính mới');
    } finally { await qt.api('PUT', `/api/v2/admin/users/${created.userId}`, { status: 'DISABLED' }).catch(() => undefined); note(`đã khoá tài khoản tạm ${user}`); }
  } },
  { id: 'S8', title: 'GIỜ LÀM VIỆC: ngoài giờ mọi thao tác dữ liệu bị chặn ở máy chủ (cả khi có phiên hợp lệ)', run: async () => {
    if (skipHours) { skipped++; note('BỎ QUA (--bo-qua-gio)'); return; }
    const cur = await qt.api<{ version: number; days: Record<string, unknown> }>('GET', '/api/v2/admin/schedule');
    const closed = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => [d, { closed: true }]));
    try {
      await qt.api('PUT', '/api/v2/admin/schedule', { expectedVersion: cur.version, days: closed, reason: 'Demo ABE S8: dong cua tam thoi' });
      const r = await raw(nl, `/api/records?patientIdx=${nl.patientIdx(PATIENT)}`);
      ok(r.status === 423, 'đóng cửa: bác sĩ/người nhập đọc dữ liệu bị chặn HTTP 423 dù phiên còn hợp lệ', `HTTP ${r.status}`);
      const w = await raw(nl, '/api/records', { method: 'POST', body: '{}' });
      ok(w.status === 423, 'ghi dữ liệu cũng bị chặn 423', `HTTP ${w.status}`);
      ok((await raw(qt, '/api/v2/admin/schedule')).status === 200, 'quản trị vẫn mở lại được lịch (quyền riêng), nên không tự khoá mình');
    } finally {
      const now = await qt.api<{ version: number }>('GET', '/api/v2/admin/schedule');
      await qt.api('PUT', '/api/v2/admin/schedule', { expectedVersion: now.version, days: cur.days, reason: 'Demo ABE S8: tra lai lich cu' });
    }
    ok((await raw(nl, `/api/records?patientIdx=${nl.patientIdx(PATIENT)}`)).status === 200, 'đã trả lịch cũ: đọc lại bình thường');
  } },
  { id: 'S9', title: 'CÁCH LY NGƯỜI NHẬP: hai người nhập không thấy dữ liệu của nhau', run: async () => {
    if (!nl2) { skipped++; note('BỎ QUA: nhaplieu02 chưa có'); return; }
    const mine = await rowsAs(nl), theirs = await rowsAs(nl2);
    ok(mine.length > 0, `nhaplieu01 thấy dữ liệu do chính mình nhập: ${brief(mine)}`);
    ok(theirs.length === 0, 'nhaplieu02 (cùng vai trò) KHÔNG nhận bản ghi nào của nhaplieu01', brief(theirs));
    const r = await raw(nl2, `/api/records/${mine[0].id}`, { method: 'DELETE' });
    ok(r.status === 403, 'nhaplieu02 không xoá được bản ghi của nhaplieu01', `HTTP ${r.status}`);
  } },
  { id: 'S10', title: 'GIÁM SÁT: đọc tất cả nhưng phải nêu LÝ DO; cấp tài khoản cần HAI quản trị', run: async () => {
    if (!gs) { skipped++; note('BỎ QUA: giamsat01 chưa có (cần máy chủ chính sách 2.2.0)'); return; }
    gs.accessReason = '';
    let msg = ''; try { await gs.listRecords(PATIENT); } catch (e) { msg = (e as Error).message; }
    ok(/ACCESS_REASON_REQUIRED/.test(msg), 'không nhập lý do: máy chủ từ chối (428) và KHÔNG trả bản mã');
    gs.accessReason = 'Chung minh ABE: kich ban S10 kiem tra tuan thu';
    const rows = await rowsAs(gs);
    const texts = await dataOf(gs, rows.filter((r) => r.type === 'lamsang'));
    ok([CANARY.mat, CANARY.nhi, CANARY.xn].every((x) => texts.includes(x)), 'có lý do: đọc được lâm sàng của MỌI khoa', brief(rows));
    const audit = await qt.api<{ records: { action: string; detail: string }[] }>('GET', '/api/v2/admin/audit?limit=400');
    ok(audit.records.some((r) => r.action === 'v2.giamsat.read' && r.detail.includes('kich ban S10')), 'lý do được ghi vào NHẬT KÝ (quản trị xem được ai đọc, vì sao)');
    ok((await raw(gs, '/api/v2/admin/users')).status === 403, 'Giám sát KHÔNG quản trị được tài khoản');
    ok((await gs.saveRecord({ patientCode: PATIENT, type: 'lamsang', khoa: 'Mat', data: { x: 1 } }).then(() => false, (e: Error) => /DENY_ROLE_NOT_ALLOWED/.test(e.message))), 'Giám sát KHÔNG ghi được dữ liệu');
    const nu = `gs.thu.${Date.now()}@congty.vn`;
    const c = await qt.api<{ userId: string; status: string }>('POST', '/api/v2/admin/users', { username: nu, role: 'GIAM_SAT', displayName: 'GS thu (tam)' });
    ok(c.status === 'PENDING_APPROVAL', 'quản trị tạo tài khoản Giám sát mới: trạng thái CHỜ DUYỆT (chưa dùng được)');
    const self = await raw(qt, `/api/v2/admin/users/${c.userId}/approve`, { method: 'POST', body: '{}' });
    ok(self.status === 403, 'chính người yêu cầu KHÔNG tự duyệt được (cần quản trị KHÁC)', `HTTP ${self.status}`);
    await qt.api('PUT', `/api/v2/admin/users/${c.userId}`, { status: 'DISABLED' }).catch(() => undefined);
    note(`(đã khoá tài khoản thử ${nu}; duyệt bằng quản trị thứ hai làm thủ công trên giao diện)`);
  } },
  { id: 'S11', title: 'TÊN bệnh nhân mã hoá: ai thấy tên, ai chỉ thấy ổ khoá', run: async () => {
    const who: [string, MedClient | null][] = [['tiepdon01', td], ['bsmat01', mat], ['bsnhi01', nhi], ['nhaplieu01', nl], ['nhaplieu02', nl2], ['quantri02', qt], ['giamsat01', gs]];
    for (const [u, c] of who) {
      if (!c) { skipped++; continue; }
      let shown = '🔒';
      try { const rows = (await rowsAs(c)).filter((r) => r.type === 'hanhchinh'); const n = rows.length ? ((await c.openMany(rows))[0]?.data as { hoTen?: string } | undefined)?.hoTen : undefined; if (n) shown = n; } catch { shown = '🔒 (không tra được)'; }
      const expectSee = ['tiepdon01', 'bsmat01', 'bsnhi01', 'giamsat01'].includes(u);
      ok(expectSee === shown.startsWith('NGUYEN'), `${u.padEnd(11)} → ${shown}`);
    }
  } },
  { id: 'S12', title: 'MFA là THUỘC TÍNH ABE: thiếu Auth:MFA thì có khoá Giám sát cũng không giải mã được', run: async () => {
    if (!gs) { skipped++; note('BỎ QUA: cần giamsat01 đã vượt MFA (xem GIAMSAT_TOTP_SECRET)'); return; }
    const st = await gs.mfaStatus();
    ok(st.required && st.enrolled && st.verified, 'giamsat01: MFA bắt buộc, đã đăng ký, phiên này vừa xác thực', JSON.stringify(st));
    ok(gs.s.attrs.includes('MED:Auth:MFA'), 'phiên có thuộc tính ABE MED:Auth:MFA (máy chủ chỉ cấp sau khi nhập đúng mã TOTP)');
    const rows = (await rowsAs(gs)).filter((r) => r.type === 'lamsang');
    ok((await gs.openRecord(rows[0]))?.signatureValid === true, 'có MFA: giải mã được bản ghi lâm sàng');
    const saved = [...gs.s.attrs]; gs.resetKeys(); gs.s.attrs = saved.filter((a) => a !== 'MED:Auth:MFA');
    let opened: unknown = 'chua-thu'; try { opened = await gs.openRecord(rows[0]); } catch { opened = null; }
    ok(opened === null, 'bỏ thuộc tính MFA (mô phỏng phiên chưa xác thực): có khoá Role:GiamSat vẫn KHÔNG giải mã được — chính sách là (Role:GiamSat AND Auth:MFA)');
    gs.s.attrs = saved;
    ok((await gs.openRecord(rows[0]))?.signatureValid === true, 'có lại thuộc tính MFA: giải mã được');
    let wrong = ''; try { await gs.mfaVerify('000000'); } catch (e) { wrong = (e as Error).message; }
    ok(/MFA_CODE_INVALID/.test(wrong), 'mã sai bị từ chối', wrong.slice(0, 40));
    let mine = ''; try { await mat.mfaEnroll('khong-quan-trong-123'); } catch (e) { mine = (e as Error).message; }
    ok(/MFA_NOT_AVAILABLE_FOR_ROLE/.test(mine) && !mat.s.attrs.includes('MED:Auth:MFA'), 'vai trò thường (bác sĩ) không bị bắt buộc MFA và không nhận thuộc tính MFA');
  } },
];

for (const s of scenarios) {
  if (only.length && !only.includes(s.id)) continue;
  console.log(`\n━━ ${s.id}. ${s.title}`);
  try { await s.run(); } catch (e) { ok(false, 'kịch bản gặp lỗi', (e as Error).message.slice(0, 120)); }
}
await cleanupDevices();
console.log(`\n══════════ KẾT QUẢ: ${pass} đạt, ${fail} không đạt${skipped ? `, ${skipped} bỏ qua` : ''} ══════════`);
process.exit(fail ? 1 : 0);
