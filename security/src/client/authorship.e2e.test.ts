// NGHIỆM THU MÔ HÌNH TÁC GIẢ + ẢNH THEO VÙNG trên hệ thống thật: backend Spring HTTPS (cầu nối tài khoản) + 3 nút cấp khoá + MedClient.
// DỮ LIỆU GIẢ. Cần jar: (cd security/storage && ./mvnw -DskipTests package).
// Quy tắc cần chứng minh:
//  A. Người nhập đọc lại mọi thứ do CHÍNH TÀI KHOẢN mình nhập (nhiều khoa), cả trên thiết bị khác; không đọc của người nhập khác; không tự có quyền sửa/xóa của người khác.
//  B. Bác sĩ tra CCCD không cần phân công nhưng chỉ đọc phần thuộc chuyên khoa được cấp; bác sĩ nhiều khoa đọc hợp các phần; Quản trị không đọc bệnh án.
//  C. Ảnh: mỗi bác sĩ chỉ nhận/giải mã vùng của mình; điểm ảnh ngoài vùng không tồn tại trên máy; tráo vùng / sửa nhãn / sửa bản mã bị phát hiện.
//  D. DICOM (nguồn UPENN-GBM, dữ liệu tổng hợp): trợ lý gợi ý khoa Thần kinh -> chỉ bác sĩ Thần kinh đọc được vùng; nguồn lạ => chỉ tác giả.
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encrypt } from '../abe/rw15.js';
import { versioned } from '../common/epoch.js';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { COLOR, PHANTOM, decodePng, encodePng, hasColor, makePhantom, pixelAt, pixelsOutside } from '../research/fake-image.js';
import { fakePatients } from '../research/fake-data.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { adviseImage } from './advisor.js';
import { appPolicyString, type PolicyMatrix } from './app-policy.js';
import { dicomToRgba, parseDicom } from './dicom.js';
import { makeDicom } from './dicom-fixture.js';
import { listImages, openImage, saveImage } from './imaging.js';
import { MedClient, RecordIntegrityError, type RecordRow } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const [A, B] = fakePatients(2, 4242);
const cccdA = A.hanhchinh.cccd, cccdB = B.hanhchinh.cccd;
let S: ResearchStack;
const login = (u: string, p = pw(u), store = new MemoryDeviceKeyStore()) => MedClient.signIn(S.baseUrl, u, p, store, { fetch: S.fetch });
const raw = (c: MedClient, path: string, init: RequestInit = {}) => S.fetch(S.baseUrl + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${c.s.token}`, ...(init.headers as Record<string, string>) } });
const uid = (c: MedClient) => c.s.account!.userId;
let nl1: MedClient, nl2: MedClient, td: MedClient, qt: MedClient, nhi: MedClient, mat: MedClient, tmh: MedClient, nhimat: MedClient, ksk: MedClient, kl: MedClient;
const types = (rows: RecordRow[]) => rows.map((r) => `${r.type}:${r.khoa}`).sort();
const opened = async (c: MedClient, rows: RecordRow[]) => (await c.openMany(rows)).filter((x): x is NonNullable<typeof x> => !!x);
const png1 = encodePng(makePhantom(0));
const saved: Record<string, string> = {};

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
  [nl1, nl2, td, qt, nhi, mat, tmh, nhimat, ksk, kl] = await Promise.all(['nhaplieu01', 'nhaplieu02', 'tiepdon01', 'quantri01', 'bsnhi01', 'bsmat01', 'bstmh01', 'bsnhimat01', 'bsksk01', 'ketluan01'].map((u) => login(u)));
}, 300_000);
afterAll(async () => { await S?.stop(); });

describe.skipIf(!JAR)('A. Người nhập đọc lại dữ liệu CỦA CHÍNH TÀI KHOẢN mình', () => {
  it('thuộc tính do backend cấp: mỗi người chỉ có MED:Author:<userId của mình>; Quản trị không có thuộc tính nào', () => {
    expect(nl1.s.attrs.sort()).toEqual([`MED:Author:${uid(nl1)}`, 'MED:Role:NhapLieu'].sort());
    expect(nhimat.s.attrs.sort()).toEqual([`MED:Author:${uid(nhimat)}`, 'MED:Khoa:Mat', 'MED:Khoa:Nhi', 'MED:Role:BacSi'].sort());
    expect(new Set([uid(nl1), uid(nl2)]).size).toBe(2);
    expect(qt.s.attrs).toEqual([]);
  });

  it('Tiếp đón nhập Hành chính; người nhập 1 nhập hồ sơ nhiều khoa (Mắt, Nhi, TMH) + khám chung + ảnh có 2 vùng cho bệnh nhân A', async () => {
    await td.saveMany([{ patientCode: cccdA, type: 'hanhchinh', khoa: 'KSK', data: { hoTen: A.hanhchinh.hoTen, cccd: cccdA, canary: A.hanhchinh.canary }, group: 'TRUONG-A' }]);
    saved.mat = await nl1.saveRecord({ patientCode: cccdA, type: 'lamsang', khoa: 'MẮT', data: { ketLuan: A.lamsangMat.canary }, tags: ['can-theo-doi'] });     // tên hiển thị "MẮT" -> mã Mat
    saved.nhi = await nl1.saveRecord({ patientCode: cccdA, type: 'lamsang', khoa: 'nhi khoa', data: { ketLuan: A.lamsangNhi.canary } });
    saved.tmh = await nl1.saveRecord({ patientCode: cccdA, type: 'lamsang', khoa: 'Tai Mũi Họng', data: { ketLuan: 'CANARY-TMH-A' } });
    saved.ksk = await nl1.saveRecord({ patientCode: cccdA, type: 'lankham', khoa: 'KSK', data: { ghiChu: 'CANARY-KSK-A' } });
    const img = await saveImage(nl1, {
      patientCode: cccdA, original: { mime: 'image/png', bytes: png1 }, pixels: makePhantom(0), modality: 'CT',
      regions: [{ rect: PHANTOM.mat, khoas: ['Mat'], label: 'vung A' }, { rect: PHANTOM.nhiTmh, khoas: ['Nhi', 'TMH'], label: 'vung B (nhieu khoa)' }],
    });
    saved.image = img.imageId; saved.original = img.originalId; saved.regMat = img.regionIds[0]; saved.regNhiTmh = img.regionIds[1];
    expect(img.regionIds).toHaveLength(2);
  }, 300_000);

  it('người nhập đọc lại TOÀN BỘ dữ liệu mình nhập (nhiều khoa, ảnh gốc, vùng), chữ ký đúng, tác giả là tài khoản của mình', async () => {
    const rows = await nl1.listRecords(cccdA);
    expect(types(rows)).toEqual(['anh:KSK', 'lamsang:Mat', 'lamsang:Nhi', 'lamsang:TMH', 'lankham:KSK', 'vung:Mat', 'vung:Nhi,TMH'].sort());
    const res = await opened(nl1, rows);
    expect(res).toHaveLength(7);
    expect(res.every((r) => r.signatureValid && r.author.userId === uid(nl1))).toBe(true);
    expect(rows.every((r) => r.authorUserId === uid(nl1))).toBe(true);                              // tác giả do BACKEND gán từ phiên
    expect(JSON.stringify(res.map((r) => r.data))).toContain(A.lamsangMat.canary);
  }, 300_000);

  it('quyền đọc lại gắn TÀI KHOẢN, không gắn máy: đăng nhập trên thiết bị khác (đăng ký thiết bị hợp lệ) vẫn đọc được', async () => {
    const second = await login('nhaplieu01', pw('nhaplieu01'), new MemoryDeviceKeyStore());      // kho khoá thiết bị MỚI => thiết bị mới
    expect(second.s.deviceId).not.toBe(nl1.s.deviceId); expect(second.s.gid).toBe(nl1.s.gid);
    const res = await opened(second, await second.listRecords(cccdA));
    expect(res).toHaveLength(7); expect(res.every((r) => r.signatureValid)).toBe(true);
    const devices = await qt.api<{ userId: string; deviceId: string }[]>('GET', '/api/v2/admin/devices');
    expect(devices.filter((d) => d.userId === uid(nl1)).length).toBeGreaterThanOrEqual(2);            // thiết bị được đăng ký chính thức, có thể thu hồi
  }, 300_000);

  it('người nhập 2 nhập dữ liệu riêng cho cùng bệnh nhân: hai người nhập KHÔNG thấy/đọc dữ liệu của nhau; mỗi bản ghi theo dõi đúng tác giả', async () => {
    saved.mat2 = await nl2.saveRecord({ patientCode: cccdA, type: 'lamsang', khoa: 'Mat', data: { ketLuan: 'CANARY-MAT-NL2' } });
    const rows2 = await nl2.listRecords(cccdA);
    expect(types(rows2)).toEqual(['lamsang:Mat']);                                                   // chỉ thấy cái mình nhập
    expect((await opened(nl2, rows2))[0].data).toMatchObject({ ketLuan: 'CANARY-MAT-NL2' });
    const rows1 = await nl1.listRecords(cccdA);
    expect(rows1.some((r) => r.id === saved.mat2)).toBe(false);
    expect(JSON.stringify(await opened(nl1, rows1))).not.toContain('CANARY-MAT-NL2');
    // có bản mã trong tay (id biết) cũng không đọc được: backend 403, và giải mã bằng khoá của mình thất bại
    expect((await raw(nl1, `/api/records/${saved.mat2}`)).status).toBe(403);
    const stolen = (await nl2.listRecords(cccdA))[0];
    expect(await nl1.openRecord(stolen)).toBeNull();
  }, 300_000);

  it('quyền đọc lại KHÔNG kéo theo quyền sửa/xóa: người khác (kể cả bác sĩ đọc được) không xóa được; tác giả xóa được bản của mình; ghi đè id bị chặn', async () => {
    expect((await raw(mat, `/api/records/${saved.mat}`, { method: 'DELETE' })).status).toBe(403);
    const r = await raw(mat, `/api/records/${saved.mat}`, { method: 'DELETE' });
    expect(((await r.json()) as { error: string }).error).toBe('DENY_NOT_AUTHOR');
    expect((await raw(nl2, `/api/records/${saved.mat}`, { method: 'DELETE' })).status).toBe(403);
    const tmp = await nl1.saveRecord({ patientCode: cccdB, type: 'lamsang', khoa: 'Mat', data: { x: 1 } });
    await expect(nl1.deleteRecord(tmp)).resolves.toBeUndefined();
    expect((await nl1.listRecords(cccdB))).toHaveLength(0);
    // sửa = ghi bản mới, không có đường ghi đè bản của người khác
    expect((await raw(nl2, `/api/records/${saved.mat}/header`, { method: 'PUT', body: JSON.stringify({ v: 2 }) })).status).toBeGreaterThanOrEqual(400);
  }, 300_000);
});

describe.skipIf(!JAR)('B. Bác sĩ tra CCCD nhưng chỉ đọc chuyên khoa được cấp', () => {
  it('mỗi bác sĩ tra CCCD của A (không cần phân công) và chỉ nhận đúng phần của khoa mình; biết CCCD không tăng quyền', async () => {
    const view = async (c: MedClient) => types(c === qt ? ((await (await raw(qt, `/api/records?patientIdx=${mat.patientIdx(cccdA)}`)).json()) as RecordRow[]) : await c.listRecords(cccdA));       // Quản trị không có khoá chỉ mục: gọi thẳng API với chỉ mục thật
    expect(await view(mat)).toEqual(['hanhchinh:KSK', 'lamsang:Mat', 'lamsang:Mat', 'vung:Mat'].sort());
    expect(await view(nhi)).toEqual(['hanhchinh:KSK', 'lamsang:Nhi', 'vung:Nhi,TMH'].sort());
    expect(await view(tmh)).toEqual(['hanhchinh:KSK', 'lamsang:TMH', 'vung:Nhi,TMH'].sort());
    expect(await view(nhimat)).toEqual(['hanhchinh:KSK', 'lamsang:Mat', 'lamsang:Mat', 'lamsang:Nhi', 'vung:Mat', 'vung:Nhi,TMH'].sort());   // bác sĩ NHIỀU khoa: hợp quyền
    expect(await view(ksk)).toEqual(['hanhchinh:KSK', 'lankham:KSK']);                                // khám chung phải được cấp tường minh
    expect(await view(kl)).toEqual(['hanhchinh:KSK', 'lankham:KSK']);                                 // Kết luận KHÔNG còn đọc mọi khoa
    expect(await view(td)).toEqual(['hanhchinh:KSK']);
    expect(await view(qt)).toEqual([]);                                                                // Quản trị không đọc bệnh án
  }, 300_000);

  it('giải mã THẬT: bác sĩ Mắt mở được Mắt, KHÔNG mở được Nhi/TMH dù có bản mã trong tay; Quản trị cũng không', async () => {
    const all = await nl1.listRecords(cccdA);                                                         // bản mã của mọi khoa (tác giả cầm)
    const by = (t: string, k: string) => all.find((r) => r.type === t && r.khoa === k)!;
    const matDoc = await opened(mat, await mat.listRecords(cccdA));
    expect(JSON.stringify(matDoc.map((x) => x.data))).toContain(A.lamsangMat.canary);
    expect(JSON.stringify(matDoc.map((x) => x.data))).not.toContain(A.lamsangNhi.canary);
    expect(await mat.openRecord(by('lamsang', 'Nhi'))).toBeNull();                                   // mã hoá từ chối, không phải thông báo giao diện
    expect(await mat.openRecord(by('lamsang', 'TMH'))).toBeNull();
    expect(await mat.openRecord(by('anh', 'KSK'))).toBeNull();                                       // ảnh gốc chỉ tác giả
    expect(await mat.openRecord(by('vung', 'Nhi,TMH'))).toBeNull();
    expect(await nhi.openRecord(by('lamsang', 'Mat'))).toBeNull();
    expect(await tmh.openRecord(by('lamsang', 'Nhi'))).toBeNull();
    expect(await qt.openRecord(by('lamsang', 'Mat'))).toBeNull();
    expect(await ksk.openRecord(by('lamsang', 'Mat'))).toBeNull();
    for (const c of [mat, nhi, tmh, ksk, kl, qt, td]) for (const k of ['anh:KSK']) expect(await c.openRecord(by(k.split(':')[0], k.split(':')[1]))).toBeNull();
    // gọi API trực tiếp theo id: 403, không có bản mã
    for (const [c, id] of [[nhi, saved.mat], [mat, saved.nhi], [qt, saved.mat], [td, saved.nhi], [mat, saved.original]] as [MedClient, string][]) expect((await raw(c, `/api/records/${id}`)).status).toBe(403);
    expect((await opened(nhimat, await nhimat.listRecords(cccdA))).map((x) => JSON.stringify(x.data)).join()).toContain(A.lamsangNhi.canary);
  }, 300_000);

  it('tìm kiếm / báo cáo / xuất không làm lộ phần bị hạn chế: toàn bộ thứ bác sĩ Mắt nhận được không chứa canary khoa khác', async () => {
    const rows = await mat.listRecords(cccdA);
    const report = JSON.stringify({ rows, opened: await opened(mat, rows), images: (await listImages(mat, cccdA)).map((i) => i.rows.map((r) => r.id)) });
    for (const secret of [A.lamsangNhi.canary, 'CANARY-TMH-A', 'CANARY-KSK-A', 'CANARY-MAT-NL2'.replace('MAT', 'XXX')]) expect(report).not.toContain(secret);
    expect(JSON.stringify(rows)).not.toContain('"denied"');
    // an toàn chẩn đoán: chỉ báo SỐ mục bị hạn chế (không lộ loại/khoa) để giao diện không hiện ô trống như thể bình thường
    expect(mat.restrictedCount(cccdA)).toBeGreaterThanOrEqual(5);
    await td.listRecords(cccdA);
    expect(td.restrictedCount(cccdA)).toBeGreaterThanOrEqual(8);                                          // không có dòng "bị khóa" làm lộ khoa khác
  }, 300_000);

  it('Quản trị tạo tài khoản với tên hiển thị bất kỳ -> mã khoa chuẩn; từ chối khoa không có trong danh mục / mơ hồ; người nhập không nhận khoa', async () => {
    const mk = (body: Record<string, unknown>) => raw(qt, '/api/v2/admin/users', { method: 'POST', body: JSON.stringify(body) });
    const ok = await mk({ username: 'bs.da.khoa@congty.vn', role: 'BAC_SI', khoa: ' MẮT , nhi khoa ' });
    expect(ok.status).toBe(201); expect(((await ok.json()) as { khoa: string }).khoa).toBe('Nhi,Mat');
    for (const bad of ['Tim mạch', 'Mat;Nhi', 'MED:Role:BacSi', '', 'Khoa:Mat']) {
      const r = await mk({ username: `bad${Math.random().toString(36).slice(2, 8)}@congty.vn`, role: 'BAC_SI', khoa: bad });
      expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([400, 'KHOA_INVALID']);
    }
    const nlKhoa = await mk({ username: 'nl.khoa@congty.vn', role: 'NHAP_LIEU', khoa: 'Mat' });
    expect([nlKhoa.status, ((await nlKhoa.json()) as { error: string }).error]).toEqual([400, 'KHOA_NOT_ALLOWED_FOR_ROLE']);
    // đổi khoa là thay đổi quyền: ghi nhật ký; khoa bị gỡ làm tăng bộ đếm epoch của khoa đó
    const made = await mk({ username: 'bs.rhm@congty.vn', role: 'BAC_SI', khoa: 'Răng Hàm Mặt' });
    const u = (await made.json()) as { userId: string; khoa: string };
    expect(u.khoa).toBe('RHM');
    const before = ((await (await S.fetch(`${S.baseUrl}/api/epochs`)).json()) as { counters: Record<string, number> }).counters['MED:Khoa:RHM'] ?? 0;
    await qt.api('PUT', `/api/v2/admin/users/${u.userId}`, { khoa: 'Nhi' });
    const after = ((await (await S.fetch(`${S.baseUrl}/api/epochs`)).json()) as { counters: Record<string, number> }).counters['MED:Khoa:RHM'] ?? 0;
    expect(after).toBe(before + 1);
    const log = JSON.stringify((await qt.api<{ records: unknown[] }>('GET', '/api/v2/admin/audit?limit=200')).records);
    expect(log).toContain('khoa-bi-go:epoch-tang');
    const nhiOnly = await qt.api<{ khoa: string }>('PUT', `/api/v2/admin/users/${u.userId}`, { role: 'NHAP_LIEU', khoa: null });
    expect(nhiOnly.khoa).toBeNull();
  }, 300_000);
});

describe.skipIf(!JAR)('C. Chống giả mạo thuộc tính / policy / nhãn qua API trực tiếp', () => {
  const post = async (c: MedClient, policy: string, over: Record<string, unknown> = {}, ctxType = 'lamsang') => {
    const cfg = await c.config(); const id = crypto.randomUUID(); const patientIdx = nl1.patientIdx(cccdB);        // qt không có khoá chỉ mục: dùng chỉ mục thật của bệnh nhân B
    const envelope = await encrypt({ MED: cfg.pk }, policy, new TextEncoder().encode('{}'), `${patientIdx}|${ctxType}|${id}`);
    return raw(c, '/api/records', { method: 'POST', body: JSON.stringify({ id, patientIdx, type: ctxType, khoa: 'Mat', authorDevice: c.s.deviceId, envelope, ...over }) });
  };
  const matrix = async (c: MedClient) => JSON.parse((await c.api<{ payload: string }>('GET', '/api/v2/policy')).payload).matrix as PolicyMatrix;

  it('ghi bản mã với policy giả mạo (tác giả của người khác, thêm nhánh đọc rộng, bỏ nhánh bác sĩ) bị từ chối POLICY_MISMATCH; policy đúng được nhận', async () => {
    const dir = await nl2.epochs(); const v = (a: string) => versioned(a, dir);
    const m = await matrix(nl2);
    const err = async (r: Response) => [r.status, ((await r.json()) as { error: string }).error];
    expect(await err(await post(nl2, `${v(`MED:Author:${uid(nl1)}`)} OR (${v('MED:Role:BacSi')} AND ${v('MED:Khoa:Mat')})`))).toEqual([403, 'POLICY_MISMATCH']);     // mạo danh tác giả
    expect(await err(await post(nl2, `${v(`MED:Author:${uid(nl2)}`)} OR ${v('MED:Role:BacSi')}`))).toEqual([403, 'POLICY_MISMATCH']);                                    // "mọi bác sĩ"
    expect(await err(await post(nl2, `${v(`MED:Author:${uid(nl2)}`)} OR (${v('MED:Role:BacSi')} AND ${v('MED:Khoa:Mat')}) OR ${v('MED:Role:KetLuan')}`))).toEqual([403, 'POLICY_MISMATCH']);
    expect(await err(await post(nl2, `${v(`MED:Author:${uid(nl2)}`)} OR (${v('MED:Role:BacSi')} AND ${v('MED:Khoa:Mat')}) OR ${v('MED:Device:' + nl2.s.deviceId)}`))).toEqual([403, 'POLICY_MISMATCH']);
    expect(await err(await post(nl2, `(${v('MED:Role:BacSi')} AND ${v('MED:Khoa:Mat')})`))).toEqual([403, 'POLICY_MISMATCH']);
    // trường authorUserId / nhãn do client tự khai bị bỏ qua: backend gán từ phiên
    const good = appPolicyString(m, 'lamsang', ['Mat'], uid(nl2), v);
    const r = await post(nl2, good, { authorUserId: uid(nl1), tags: ['MED:Role:BacSi'] });
    expect(r.status).toBe(201);
    const mine = (await nl2.listRecords(cccdB)).find((x) => x.type === 'lamsang')!;
    expect(mine.authorUserId).toBe(uid(nl2));                                                         // không phải nl1 như client khai
    expect(await nl1.listRecords(cccdB)).toHaveLength(0);
  }, 300_000);

  it('khoa ngoài danh mục / vai trò không đủ quyền / sai loại bị từ chối ở backend dù gọi API trực tiếp', async () => {
    const dir = await nhi.epochs(); const v = (a: string) => versioned(a, dir);
    const polOf = async (c: MedClient, type: string, ks: string[]) => appPolicyString(await matrix(c), type, ks, uid(c), v);
    const err = async (r: Response) => [r.status, ((await r.json()) as { error: string }).error];
    expect(await err(await post(nl2, await polOf(nl2, 'lamsang', ['Mat']), { khoa: 'Tim mach' }))).toEqual([403, 'DENY_KHOA_INVALID']);
    expect(await err(await post(nhi, await polOf(nhi, 'lamsang', ['Mat']), { khoa: 'Mat' }))).toEqual([403, 'DENY_KHOA_MISMATCH']);       // bác sĩ Nhi ghi lâm sàng Mắt
    expect(await err(await post(td, await polOf(td, 'lamsang', ['Mat']), { khoa: 'Mat' }))).toEqual([403, 'DENY_ROLE_NOT_ALLOWED']);
    expect(await err(await post(mat, await polOf(mat, 'anh', []), { khoa: 'KSK' }, 'anh'))).toEqual([403, 'DENY_ROLE_NOT_ALLOWED']);       // bác sĩ không tải ảnh
    expect(await err(await post(qt, await polOf(nl2, 'lamsang', ['Mat']), { khoa: 'Mat' }))).toEqual([403, 'DENY_ROLE_NOT_ALLOWED']);       // Quản trị không ghi bệnh án
    expect((await post(nl2, await polOf(nl2, 'lamsang', ['Mat']), { khoa: 'Mat', refId: crypto.randomUUID() })).status).toBe(400);           // refId chỉ cho vùng
    expect((await post(nl2, await polOf(nl2, 'vung', ['Mat']), { khoa: 'Mat' }, 'vung')).status).toBe(400);                                  // vùng thiếu refId
  }, 300_000);

  it('không tự cấp thuộc tính của người khác: xin vé cho MED:Author:<người khác> / vai trò khác bị từ chối, chỉ nhận thuộc tính được phép', async () => {
    const dir = await nl2.epochs();
    const asked = [versioned(`MED:Author:${uid(nl1)}`, dir), versioned(`MED:Author:${uid(nl2)}`, dir), versioned('MED:Role:BacSi', dir), versioned('MED:Khoa:Mat', dir)];
    const t = (await (await raw(nl2, '/api/v2/keys/ticket', { method: 'POST', body: JSON.stringify({ attrs: asked }) })).json()) as { attrs: string[]; denied: Record<string, string> };
    expect(t.attrs).toEqual([`MED:Author:${uid(nl2)}`]);
    expect(Object.keys(t.denied).sort()).toEqual([asked[0], asked[2], asked[3]].sort());
    const q = await raw(qt, '/api/v2/keys/ticket', { method: 'POST', body: JSON.stringify({ attrs: [asked[0]] }) });
    expect(q.status).toBe(403);
  }, 300_000);

  it('nhãn mô tả KHÔNG đổi quyền: bản ghi gắn tag trùng tên thuộc tính/khoa vẫn chỉ đọc được theo policy', async () => {
    const id = await nl1.saveRecord({ patientCode: cccdB, type: 'lamsang', khoa: 'Mat', data: { a: 1 }, tags: ['MED:Role:BacSi', 'Khoa:Nhi', 'Nhi', 'tat-ca'] });
    expect(await nhi.listRecords(cccdB)).toHaveLength(0);
    expect(await nhi.openRecord((await nl1.listRecords(cccdB)).find((r) => r.id === id)!)).toBeNull();
    const own = (await opened(nl1, await nl1.listRecords(cccdB)))[0];
    expect(own.signatureValid).toBe(true);
  }, 300_000);
});

describe.skipIf(!JAR)('D. Ảnh CT/MRI theo vùng', () => {
  const imageRows = async (c: MedClient) => {
    if (c === qt) return ((await (await raw(qt, `/api/records?patientIdx=${mat.patientIdx(cccdA)}`)).json()) as RecordRow[]).filter((r) => r.refId === saved.image);
    return (await listImages(c, cccdA)).find((i) => i.imageId === saved.image)?.rows ?? [];
  };

  it('bác sĩ Mắt: chỉ nhận + giải mã vùng Mắt; điểm ảnh ngoài vùng là nền trống; không có điểm ảnh của vùng Nhi/TMH hay ảnh gốc', async () => {
    const rows = await imageRows(mat);
    expect(rows.map((r) => `${r.type}:${r.khoa}`)).toEqual(['vung:Mat']);                             // máy chủ không trả ảnh gốc và vùng khác
    const view = (await openImage(mat, rows))!;
    expect(view.limited).toBe(true); expect(view.original).toBeUndefined(); expect(view.tampered).toBe(0);
    expect([view.width, view.height]).toEqual([PHANTOM.w, PHANTOM.h]);
    expect(pixelsOutside(view.pixels, [PHANTOM.mat])).toBe(0);                                        // không có điểm ảnh nào ngoài vùng được cấp
    expect(hasColor(view.pixels, COLOR.nhiTmh)).toBe(false); expect(hasColor(view.pixels, COLOR.ksk)).toBe(false);
    expect(pixelAt(view.pixels, PHANTOM.mat.x + 3, PHANTOM.mat.y + 3)).toEqual([...COLOR.mat]);
    expect(pixelAt(view.pixels, 0, 0)).toEqual([0, 0, 0, 0]);
  }, 300_000);

  it('bác sĩ Nhi và bác sĩ TMH cùng thấy vùng nhiều khoa; bác sĩ Nhi+Mắt thấy hợp hai vùng; bác sĩ khám chung / Tiếp đón / Quản trị không thấy ảnh', async () => {
    const vNhi = (await openImage(nhi, await imageRows(nhi)))!;
    expect(pixelsOutside(vNhi.pixels, [PHANTOM.nhiTmh])).toBe(0); expect(hasColor(vNhi.pixels, COLOR.mat)).toBe(false);
    const vTmh = (await openImage(tmh, await imageRows(tmh)))!;
    expect(pixelsOutside(vTmh.pixels, [PHANTOM.nhiTmh])).toBe(0); expect(hasColor(vTmh.pixels, COLOR.nhiTmh)).toBe(true);
    const vBoth = (await openImage(nhimat, await imageRows(nhimat)))!;
    expect(vBoth.regions).toHaveLength(2); expect(pixelsOutside(vBoth.pixels, [PHANTOM.mat, PHANTOM.nhiTmh])).toBe(0);
    expect(hasColor(vBoth.pixels, COLOR.mat) && hasColor(vBoth.pixels, COLOR.nhiTmh)).toBe(true); expect(hasColor(vBoth.pixels, COLOR.ksk)).toBe(false);
    for (const c of [ksk, kl, td, qt]) expect(await imageRows(c)).toEqual([]);
    expect(await openImage(ksk, [])).toBeNull();
  }, 300_000);

  it('người nhập (tác giả) mở được ảnh gốc NGUYÊN VẸN (khớp từng byte) và cả hai vùng; người nhập khác không thấy gì', async () => {
    const v = (await openImage(nl1, await imageRows(nl1)))!;
    expect(v.limited).toBe(false);
    expect(Buffer.from(v.original!.bytes).equals(Buffer.from(png1))).toBe(true);
    expect(decodePng(v.original!.bytes).data).toEqual(makePhantom(0).data);                           // giải mã PNG gốc == điểm ảnh gốc
    expect(v.regions).toHaveLength(2);
    expect(await imageRows(nl2)).toEqual([]);
    // đăng nhập thiết bị khác vẫn mở được
    const other = await login('nhaplieu01', pw('nhaplieu01'), new MemoryDeviceKeyStore());
    expect((await openImage(other, await imageRows(other)))!.original!.sha256).toBe(v.original!.sha256);
  }, 300_000);

  it('bộ ảnh nhiều lát cắt 2D: giữ đúng thứ tự + liên kết vùng với lát cắt (phạm vi: chuỗi ảnh 2D, KHÔNG phải khối 3D/DICOM)', async () => {
    const series = { id: crypto.randomUUID(), count: 2 };
    const s0 = await saveImage(nl1, { patientCode: cccdB, original: { mime: 'image/png', bytes: encodePng(makePhantom(0)) }, pixels: makePhantom(0), modality: 'MRI', series: { ...series, index: 0 }, regions: [{ rect: PHANTOM.mat, khoas: ['Mat'] }] });
    const s1 = await saveImage(nl1, { patientCode: cccdB, original: { mime: 'image/png', bytes: encodePng(makePhantom(1)) }, pixels: makePhantom(1), modality: 'MRI', series: { ...series, index: 1 }, regions: [{ rect: PHANTOM.mat, khoas: ['Mat'] }] });
    const views = await Promise.all((await listImages(mat, cccdB)).map(async (i) => openImage(mat, i.rows)));
    const ordered = views.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.series!.index - b.series!.index);
    expect(ordered.map((x) => [x.series!.id, x.series!.index, x.series!.count])).toEqual([[series.id, 0, 2], [series.id, 1, 2]]);
    expect(ordered.map((x) => x.imageId)).toEqual([s0.imageId, s1.imageId]);
    expect(Buffer.from(ordered[1].pixels.data.subarray((PHANTOM.mat.y * PHANTOM.w + PHANTOM.mat.x) * 4, (PHANTOM.mat.y * PHANTOM.w + PHANTOM.mat.x) * 4 + 4))).toEqual(Buffer.from(COLOR.mat));
    await expect(saveImage(nl1, { patientCode: cccdB, original: { mime: 'image/png', bytes: png1 }, pixels: makePhantom(0), series: { ...series, index: 2 }, regions: [] })).rejects.toThrow(/lát cắt/);
  }, 300_000);

  it('đầu vào ảnh không hợp lệ bị từ chối: vùng vượt ảnh, thiếu khoa, khoa ngoài danh mục, loại tệp lạ, tệp quá lớn, bác sĩ tải ảnh', async () => {
    const base = { patientCode: cccdB, original: { mime: 'image/png', bytes: png1 }, pixels: makePhantom(0) };
    await expect(saveImage(nl1, { ...base, regions: [{ rect: { x: 90, y: 0, w: 20, h: 10 }, khoas: ['Mat'] }] })).rejects.toThrow(/không hợp lệ/);
    await expect(saveImage(nl1, { ...base, regions: [{ rect: PHANTOM.mat, khoas: [] }] })).rejects.toThrow(/chuyên khoa/);
    await expect(saveImage(nl1, { ...base, regions: [{ rect: PHANTOM.mat, khoas: ['Tim mach'] }] })).rejects.toThrow(/danh mục/);
    await expect(saveImage(nl1, { ...base, original: { mime: 'application/dicom', bytes: png1 }, regions: [] })).rejects.toThrow(/PNG hoặc JPEG/);
    await expect(saveImage(nl1, { ...base, original: { mime: 'image/png', bytes: new Uint8Array(7 * 1024 * 1024) }, regions: [] })).rejects.toThrow(/Tệp ảnh gốc/);
    await expect(saveImage(mat, { ...base, regions: [{ rect: PHANTOM.mat, khoas: ['Mat'] }] })).rejects.toThrow(/DENY_ROLE_NOT_ALLOWED/);
    expect((await nl1.listRecords(cccdB)).filter((r) => r.type === 'vung' || r.type === 'anh').length).toBe(4);   // chỉ còn 2 lát cắt hợp lệ (mỗi lát: 1 gốc + 1 vùng); lỗi không để lại bản ghi dở dang
  }, 300_000);

  it('phát hiện tráo vùng / sửa nhãn khoa / sửa refId / sửa bản mã / ghép mảnh của ảnh khác', async () => {
    const mine = await nl1.listRecords(cccdA);
    const rMat = mine.find((r) => r.type === 'vung' && r.khoa === 'Mat')!;
    const rNhi = mine.find((r) => r.type === 'vung' && r.khoa === 'Nhi,TMH')!;
    const rOrig = mine.find((r) => r.type === 'anh')!;
    const clone = <T,>(x: T): T => structuredClone(x);
    // 1. tráo bản mã giữa hai vùng (giữ nguyên id/nhãn): AAD gắn id bản ghi => giải mã thất bại
    const swapped = { ...clone(rMat), envelope: clone(rNhi.envelope) };
    await expect(nl1.openRecord(swapped)).rejects.toBeInstanceOf(RecordIntegrityError);
    // 2. sửa một byte bản mã
    const flipped = clone(rMat) as RecordRow & { envelope: { ciphertext: string } };
    const last = flipped.envelope.ciphertext.slice(-1); flipped.envelope.ciphertext = flipped.envelope.ciphertext.slice(0, -1) + (last === '0' ? '1' : '0');
    await expect(nl1.openRecord(flipped)).rejects.toBeInstanceOf(RecordIntegrityError);
    // 3. máy chủ/quản trị DB sửa nhãn khoa của vùng (để nới quyền hiển thị): chữ ký + nhãn đã ký không còn khớp
    const relabelled = { ...clone(rMat), khoa: 'Nhi,TMH' };
    expect((await nl1.openRecord(relabelled))?.signatureValid).toBe(false);
    // 4. sửa refId (gán vùng sang ảnh khác)
    const moved = { ...clone(rMat), refId: crypto.randomUUID() };
    expect((await nl1.openRecord(moved))?.signatureValid).toBe(false);
    // 5. openImage loại các mảnh hỏng và báo số lượng
    expect((await openImage(nl1, [rOrig, relabelled, rNhi]))!.tampered).toBe(1);
    expect((await openImage(nl1, [rOrig, swapped, rNhi]))!.tampered).toBe(1);
    // 6. ghép vùng của ảnh khác vào ảnh này: đúng chữ ký nhưng sai ràng buộc imageId/kích thước/băm
    const other = (await nl1.listRecords(cccdB)).find((r) => r.type === 'vung')!;
    const view = (await openImage(nl1, [rOrig, rMat, rNhi, { ...other, refId: rMat.refId }]))!;
    expect(view.tampered).toBe(1); expect(view.regions).toHaveLength(2);
  }, 300_000);

  it('đăng xuất / chuyển tài khoản: khoá + DEK + dữ liệu trong bộ nhớ bị xoá, phiên bị thu hồi; tài khoản kế tiếp không dùng lại gì của người trước', async () => {
    const tmpMat = await login('bsmat01');
    const rows = await tmpMat.listRecords(cccdA);
    expect((await opened(tmpMat, rows)).length).toBeGreaterThan(0);
    expect(Object.keys(tmpMat.s.keys).length).toBeGreaterThan(0);
    await tmpMat.api('POST', '/api/v2/auth/logout');                                                  // thu hồi phiên ở backend TRƯỚC (sau khi ngắt mạng thì không gọi được nữa)
    tmpMat.suspendNetwork();                                                                          // rồi xoá khoá khỏi bộ nhớ, đúng như session.signOut() làm
    expect(Object.keys(tmpMat.s.keys)).toEqual([]);                                                   // không còn khoá giải mã trong bộ nhớ
    const dead = await S.fetch(`${S.baseUrl}/api/records?patientIdx=${tmpMat.patientIdx(cccdA)}`, { headers: { authorization: `Bearer ${tmpMat.s.token}` } });
    expect(dead.status).toBe(401);                                                                    // token phiên cũ vô hiệu
    // người dùng kế tiếp trên cùng tiến trình: dùng lại bản ghi của bác sĩ Mắt mà không có quyền => không giải mã được
    const nextNhi = await login('bsnhi01');
    expect(await nextNhi.openRecord(rows.find((r) => r.type === 'lamsang')!)).toBeNull();
    await expect(tmpMat.listRecords(cccdA)).rejects.toThrow();
  }, 300_000);
});

describe.skipIf(!JAR)('D. DICOM nguồn UPENN-GBM: trợ lý gợi ý khoa Thần kinh, ABE theo vùng', () => {
  const brainDicom = (n: number, pid = 'UPENN-GBM-00099') => {
    const rows = 40, cols = 30; const px: number[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) px.push(x >= 6 + n && x < 24 && y >= 8 && y < 32 ? 700 + n : 0);
    const s = parseDicom(makeDicom({ rows, cols, px, pid, name: pid }));
    return { s, px: dicomToRgba(s, { low: 0, high: 800 }) };
  };
  let tk: MedClient;
  const code = '999000000555';

  it('tài khoản Thần kinh chỉ nhận thuộc tính Author + Role:BacSi + Khoa:ThanKinh; khoa Thần kinh có trong danh mục', async () => {
    tk = await login('bsthankinh01');
    expect(tk.s.attrs.sort()).toEqual([`MED:Author:${uid(tk)}`, 'MED:Khoa:ThanKinh', 'MED:Role:BacSi'].sort());
  }, 300_000);

  it('đường đi đủ: DICOM -> trợ lý đề xuất ThanKinh -> lưu cả chuỗi 3 lát -> chỉ bác sĩ Thần kinh (và tác giả) đọc vùng; bác sĩ khoa khác không nhận gì', async () => {
    const seriesId = crypto.randomUUID();
    const slices = [0, 1, 2].map((n) => brainDicom(n));
    const saved2: string[] = [];
    for (const [i, { s, px }] of slices.entries()) {
      const adv = adviseImage(px, s.meta);
      expect(adv.decision).toBe('DE_XUAT');
      expect(adv.regions.map((r) => r.khoas)).toEqual([['ThanKinh']]);
      const out = await saveImage(nl1, { patientCode: code, original: { mime: 'image/png', bytes: encodePng(px) }, pixels: px, modality: 'MRI',
        regions: adv.regions.map((r) => ({ rect: r.rect, khoas: r.khoas, label: r.label })), series: { id: seriesId, index: i, count: 3 } });
      saved2.push(out.imageId);
    }
    // bác sĩ Thần kinh: thấy 3 vùng, KHÔNG có ảnh gốc, điểm ảnh ngoài vùng là nền trống
    const gs = await listImages(tk, code);
    expect(gs.map((g) => g.imageId).sort()).toEqual([...saved2].sort());
    for (const g of gs) {
      expect(g.rows.map((r) => r.type)).toEqual(['vung']);                                  // không nhận bản mã của ảnh gốc
      const v = (await openImage(tk, g.rows))!;
      expect(v.limited).toBe(true); expect(v.original).toBeUndefined(); expect(v.tampered).toBe(0);
      expect(v.regions.map((r) => r.khoas)).toEqual([['ThanKinh']]);
      expect(v.pixels.data[3]).toBe(0);                                                     // góc ảnh (ngoài vùng) không có điểm ảnh
    }
    // chính sách bản mã trên máy chủ chỉ có tác giả + bác sĩ Thần kinh + vai trò Giám sát (đọc tất cả, từ chính sách 2.2.0)
    const vung = (await nl1.listRecords(code)).find((r) => r.type === 'vung')! as RecordRow & { envelope: { abe: { policy: string } } };
    expect(vung.envelope.abe.policy.replace(/#\d{4}W\d{2}\.\d+/g, '')).toBe(`MED:Author:${uid(nl1)} OR (MED:Role:BacSi AND MED:Khoa:ThanKinh) OR (MED:Role:GiamSat AND MED:Auth:MFA)`);
    // các khoa khác, tiếp đón, quản trị, người nhập khác: không nhận gì của chuỗi này
    for (const c of [mat, nhi, tmh, nhimat, ksk, kl, td, nl2]) {
      const rows = (await listImages(c, code)).filter((g) => saved2.includes(g.imageId));
      expect(rows, 'không được nhận bản mã chuỗi Thần kinh').toEqual([]);
    }
    await expect(listImages(qt, code)).rejects.toThrow(/khoá chỉ mục/);                    // Quản trị không có khoá chỉ mục: không tra được hồ sơ nào
    // người nhập vẫn mở được ảnh gốc nguyên vẹn của từng lát
    const mine = await openImage(nl1, (await listImages(nl1, code)).find((g) => g.imageId === saved2[1])!.rows);
    expect(mine!.limited).toBe(false); expect(mine!.original!.bytes).toEqual(encodePng(slices[1].px));
  }, 300_000);

  it('nguồn KHÔNG nhận ra (mã bệnh nhân lạ) hoặc PNG: trợ lý không đề xuất vùng; lưu ở dạng chỉ tác giả thì bác sĩ Thần kinh không thấy', async () => {
    const lạ = brainDicom(0, 'BN-LAGI-123');
    const adv = adviseImage(lạ.px, lạ.s.meta);
    expect(adv.decision).toBe('CHI_TAC_GIA'); expect(adv.regions).toEqual([]);
    const before = (await listImages(tk, code)).length;
    await saveImage(nl1, { patientCode: code, original: { mime: 'image/png', bytes: encodePng(lạ.px) }, pixels: lạ.px, modality: 'MRI', regions: [] });
    expect((await listImages(tk, code)).length).toBe(before);
  }, 300_000);

  it('khoa Thần kinh được backend chấp nhận ở mọi cách viết trong danh mục, và vẫn từ chối tên gần giống', async () => {
    for (const k of ['Thần kinh', 'than kinh', 'ThanKinh']) {
      const id = await nl1.saveRecord({ patientCode: code, type: 'lamsang', khoa: k, data: { ghiChu: 'x' } });
      const row = (await nl1.listRecords(code)).find((r) => r.id === id)!;
      expect(row.khoa).toBe('ThanKinh');
    }
    await expect(nl1.saveRecord({ patientCode: code, type: 'lamsang', khoa: 'Thần kinh sọ', data: { a: 1 } })).rejects.toThrow();
  }, 300_000);
});
