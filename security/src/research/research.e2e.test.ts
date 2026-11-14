// BẰNG CHỨNG đầu-cuối của luồng nghiên cứu CP-ABE trên hệ thống THẬT: Spring (HTTPS) + 3 nút cấp khoá ngưỡng 2/3 (HTTPS, cấp theo vé).
// Cần jar:  (cd security/storage && ./mvnw -DskipTests package). Dữ liệu 100% giả (fake-data.ts).
// Mốc giờ biên (06:59, 07:00, 20:59, 21:00, CN 17:29/17:30) được kiểm bằng đồng hồ giả ở phía Java (ResearchFlowTest.cacMocGioBien);
// ở đây kiểm chặn ngoài giờ bằng cách ĐỔI LỊCH qua API quản trị (không có cách nào khác để đổi giờ máy chủ).
import { createHash } from 'node:crypto';
import { readdirSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decrypt, type Envelope } from '../abe/rw15.js';
import { tlsFetch } from '../common/tls.js';
import { generateDevTls } from '../deploy/devtls.js';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { encrypt } from '../abe/rw15.js';
import { BusinessClosedError, PasswordChangeRequiredError, ResearchClient, type Mode, type SectionKey, type SectionView } from './client.js';
import { fakePatients, type FakePatient } from './fake-data.js';
import { MemoryDeviceKeyStore } from './keys.js';
import { SIG_DOMAIN, sha256Hex, verifyRecord, type SignedRecordView } from './verify.js';
import { signHex } from './keys.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string) => DEMO_USERS.find((x) => x.username === u)!.password;
const patients: FakePatient[] = fakePatients(3);
const sectionData = (p: FakePatient, s: SectionKey) => (s === 'hanhchinh' ? p.hanhchinh : s === 'lamsang.Nhi' ? p.lamsangNhi : p.lamsangMat);
const canaryOf = (p: FakePatient, s: SectionKey) => sectionData(p, s).canary;
const by = (v: SectionView[]) => Object.fromEntries(v.map((s) => [s.section, s])) as Partial<Record<SectionKey, SectionView>>;
const failsToOpen = async (p: Promise<Uint8Array | null>) => { try { return (await p) === null; } catch { return true; } };

let S: ResearchStack;
const bodies: { url: string; body: string }[] = [];
const recording = (f: typeof fetch): typeof fetch => (async (i: RequestInfo | URL, init?: RequestInit) => {
  if (typeof init?.body === 'string') bodies.push({ url: String(i), body: init.body });
  return f(i, init);
}) as typeof fetch;

// MỘT máy dùng chung (mọi người dùng cùng kho khoá, khác mục) — chứng minh hai người cùng máy không chia sẻ phiên/khoá.
const machine1 = new MemoryDeviceKeyStore();
const machine2 = new MemoryDeviceKeyStore();           // máy khác của cùng người dùng
const client = (store = machine1) => new ResearchClient({ baseUrl: S.baseUrl, fetch: recording(S.fetch), store, pin: { registryPk: S.registryPk, abePkSha256: S.abePkSha256 } });
let td: ResearchClient, nhi: ResearchClient, mat: ResearchClient, qt: ResearchClient;

async function setSchedule(admin: ResearchClient, days: Record<string, unknown>, reason: string) {
  const cur = await admin.call<{ version: number }>('GET', '/api/v2/admin/schedule');
  return admin.call('PUT', '/api/v2/admin/schedule', { expectedVersion: cur.version, days, reason });
}
const ALL_CLOSED = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => [d, { closed: true }]));
const ALL_OPEN = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => [d, { open: '00:00', close: '23:59' }]));

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, nodeHost: 'localhost' });   // nút ở tên máy KHÁC backend (localhost vs 127.0.0.1)
  td = client(); nhi = client(); mat = client(); qt = client();
  await Promise.all([td.signIn('tiepdon01', pw('tiepdon01')), nhi.signIn('bsnhi01', pw('bsnhi01')), mat.signIn('bsmat01', pw('bsmat01')), qt.signIn('quantri01', pw('quantri01'))]);
}, 300_000);

afterAll(async () => { await S?.stop(); });

describe.skipIf(!JAR)('luồng nghiên cứu CP-ABE — bằng chứng đầu-cuối', () => {
  // ================================================================== A. nền: HTTPS + danh tính
  describe('A. HTTPS và danh tính cá nhân', () => {
    it('máy khách kiểm chứng chứng chỉ HTTPS: CA lạ, HTTP thường và sai tên máy chủ đều bị từ chối', async () => {
      const other = generateDevTls(resolve(S.dataDir, 'tls-other'), ['dns:localhost', 'ip:127.0.0.1']);
      await expect(tlsFetch(other.caPem)(`${S.baseUrl}/api/v2/status`)).rejects.toThrow();                  // CA không phải của hệ thống
      const plain = await fetch(`${S.baseUrl.replace('https', 'http')}/api/v2/status`, { signal: AbortSignal.timeout(3000) }).then((r) => r.status, () => 0);
      expect(plain).not.toBe(200);                                                                              // cổng TLS không phục vụ HTTP thường
      const wrongHost = await tlsFetch(S.caPem)(`https://127.0.0.2:${new URL(S.baseUrl).port}/api/v2/status`).then(() => 'ok', (e: NodeJS.ErrnoException & { cause?: { code?: string } }) => e.code ?? e.cause?.code ?? e.message);
      expect(String(wrongHost)).toMatch(/ALTNAME|ERR_TLS_CERT|hostname|altname/i);                         // 127.0.0.2 không nằm trong SAN
      expect((await tlsFetch(S.caPem)(`${S.baseUrl}/api/v2/status`)).status).toBe(200);                      // đúng CA + đúng tên: vào được
    }, 60_000);

    it('danh tính do backend quản lý: userId/vai trò/khoa lấy từ tài khoản, mỗi người một GID, phiên gắn đúng thiết bị', async () => {
      expect(nhi.me).toMatchObject({ username: 'bsnhi01', role: 'BAC_SI', khoa: 'Nhi' });
      expect(mat.me).toMatchObject({ username: 'bsmat01', role: 'BAC_SI', khoa: 'Mat' });
      expect(new Set([td.me!.userId, nhi.me!.userId, mat.me!.userId, qt.me!.userId]).size).toBe(4);
      expect(new Set([td.me!.gid, nhi.me!.gid, mat.me!.gid, qt.me!.gid]).size).toBe(4);
      expect(new Set([td.me!.deviceId, nhi.me!.deviceId, mat.me!.deviceId]).size).toBe(3);   // cùng một máy nhưng mỗi người một thiết bị/khoá ký
      expect(await machine1.list()).toEqual(expect.arrayContaining(['tiepdon01', 'bsnhi01', 'bsmat01']));
      // sai mật khẩu / tên tự khai không đăng nhập được
      await expect(client(new MemoryDeviceKeyStore()).signIn('bsnhi01', 'sai-mat-khau-1')).rejects.toMatchObject({ code: 'BAD_CREDENTIALS' });
      await expect(client().call('GET', '/api/v2/auth/me', undefined, false)).rejects.toMatchObject({ status: 401 });
    });

    it('đổi máy hợp lệ: cùng userId, cùng GID, cùng quyền; không phải phá vỡ kính', async () => {
      const second = client(machine2);
      const me2 = await second.signIn('bsnhi01', pw('bsnhi01'));         // máy MỚI → đăng ký thiết bị (nhập lại mật khẩu) → đăng nhập kèm chứng minh khoá
      expect(me2.userId).toBe(nhi.me!.userId);
      expect(me2.gid).toBe(nhi.me!.gid);
      expect(me2.deviceId).not.toBe(nhi.me!.deviceId);
      expect(me2.role).toBe('BAC_SI'); expect(me2.khoa).toBe('Nhi');
      await second.signOut();
    });
  });

  // ================================================================== B. đúng khoa mở được, sai khoa không (cả hai chế độ)
  describe.each<Mode>(['baseline', 'abe'])('B. ma trận quyền đọc/ghi — chế độ %s', (mode) => {
    it('Tiếp đón import Hành chính; bác sĩ ghi lâm sàng đúng khoa của mình', async () => {
      const n = await td.importMany(mode, patients.map((p) => ({ patientCode: p.code, section: 'hanhchinh' as const, data: p.hanhchinh })));
      expect(n).toBe(patients.length);
      for (const p of patients.slice(0, 2)) {
        await nhi.saveSection(mode, { patientCode: p.code, section: 'lamsang.Nhi', data: p.lamsangNhi });
        await mat.saveSection(mode, { patientCode: p.code, section: 'lamsang.Mat', data: p.lamsangMat });
      }
    }, 240_000);

    it('đúng khoa mở được, sai khoa không mở được, Quản trị không đọc được gì; chữ ký xác định đúng người ký', async () => {
      const p = patients[0];
      const [rTd, rNhi, rMat] = [by(await td.readPatient(mode, p.code)), by(await nhi.readPatient(mode, p.code)), by(await mat.readPatient(mode, p.code))];
      // Quản trị: ở BASELINE bị PDP từ chối từng mục; ở ABE còn chặt hơn — không có thuộc tính nên không có khoá chỉ mục để TÍNH patientRef.
      let rQt: Partial<Record<SectionKey, SectionView>> = {};
      if (mode === 'baseline') rQt = by(await qt.readPatient(mode, p.code));
      else await expect(qt.readPatient(mode, p.code)).rejects.toMatchObject({ code: 'DENY_NO_ATTRIBUTES' });
      // Tiếp đón: chỉ Hành chính
      expect(rTd.hanhchinh?.status).toBe('OPEN'); expect(rTd['lamsang.Nhi']?.status).toBe('DENIED_BACKEND'); expect(rTd['lamsang.Mat']?.status).toBe('DENIED_BACKEND');
      // Bác sĩ Nhi: Hành chính + Nhi
      expect(rNhi.hanhchinh?.status).toBe('OPEN'); expect(rNhi['lamsang.Nhi']?.status).toBe('OPEN'); expect(rNhi['lamsang.Mat']?.status).toBe('DENIED_BACKEND');
      // Bác sĩ Mắt: Hành chính + Mắt
      expect(rMat.hanhchinh?.status).toBe('OPEN'); expect(rMat['lamsang.Mat']?.status).toBe('OPEN'); expect(rMat['lamsang.Nhi']?.status).toBe('DENIED_BACKEND');
      // Quản trị: không mục nào
      for (const s of Object.values(rQt)) expect(s!.status).toBe('DENIED_BACKEND');
      // nội dung đúng
      expect(rNhi['lamsang.Nhi']!.data).toMatchObject({ canary: p.lamsangNhi.canary });
      expect(rMat['lamsang.Mat']!.data).toMatchObject({ canary: p.lamsangMat.canary });
      expect(rTd.hanhchinh!.data).toMatchObject({ canary: p.hanhchinh.canary, cccd: p.hanhchinh.cccd });
      // chữ ký: đúng người ký (userId), kiểm chứng bằng chứng chỉ do registry ký
      expect(rTd.hanhchinh!.signature).toMatchObject({ ok: true, signerUserId: td.me!.userId });
      expect(rNhi['lamsang.Nhi']!.signature).toMatchObject({ ok: true, signerUserId: nhi.me!.userId });
      expect(rMat['lamsang.Mat']!.signature).toMatchObject({ ok: true, signerUserId: mat.me!.userId });
      expect(rMat.hanhchinh!.signature!.signerUserId).toBe(td.me!.userId);          // bác sĩ Mắt thấy đúng người nhập Hành chính là Tiếp đón
    }, 240_000);

    it('ghi sai quyền bị backend từ chối với mã lý do rõ ràng', async () => {
      const p = patients[2];
      await expect(nhi.saveSection(mode, { patientCode: p.code, section: 'hanhchinh', data: {} })).rejects.toMatchObject({ code: 'DENY_ROLE_NOT_ALLOWED' });
      await expect(nhi.saveSection(mode, { patientCode: p.code, section: 'lamsang.Mat', data: {} })).rejects.toMatchObject({ code: 'DENY_KHOA_MISMATCH' });
      await expect(td.saveSection(mode, { patientCode: p.code, section: 'lamsang.Nhi', data: {} })).rejects.toMatchObject({ code: 'DENY_ROLE_NOT_ALLOWED' });
      await expect(td.importMany(mode, [{ patientCode: p.code, section: 'lamsang.Mat', data: {} }])).rejects.toMatchObject({ code: expect.stringMatching(/^DENY_/) });
      await expect(qt.saveSection(mode, { patientCode: p.code, section: 'hanhchinh', data: {} })).rejects.toMatchObject({ code: mode === 'abe' ? 'DENY_NO_ATTRIBUTES' : 'DENY_ROLE_NOT_ALLOWED' });
    }, 120_000);
  });

  describe('B2. Quản trị gọi thẳng API với một patientRef có thật (bỏ qua thư viện client)', () => {
    it.each<Mode>(['baseline', 'abe'])('chế độ %s: backend từ chối mọi mục, không có khoá để giải mã', async (mode) => {
      const rows = (await (await S.fetch(`${S.baseUrl}/api/v2/evidence/raw?mode=${mode}`, { headers: { 'x-service-token': S.serviceToken } })).json()) as { patientRef: string }[];
      const res = await qt.call<{ sections: { denied: boolean; reason: string; latest?: unknown }[] }>('GET', `/api/v2/${mode}/records?patientRef=${rows[0].patientRef}`);
      expect(res.sections.length).toBeGreaterThan(0);
      for (const s of res.sections) { expect(s.denied).toBe(true); expect(s.reason).toBe('DENY_ROLE_NOT_ALLOWED'); expect(s.latest).toBeUndefined(); }
    });
  });

  // ================================================================== C. cùng bản mã, khoá sai gọi thẳng hàm giải mã vẫn thất bại
  describe('C. CP-ABE thực thi bằng toán học, độc lập với backend', () => {
    let rec: SignedRecordView & { payload: string; id: string; patientRef: string; section: string };
    let ctx: string; let env: Envelope;

    it('lấy bản mã Lâm sàng Nhi bằng đường HỢP LỆ (bác sĩ Nhi) rồi thử giải mã bằng khoá không đủ thuộc tính', async () => {
      const v = by(await nhi.readPatient('abe', patients[0].code));
      rec = v['lamsang.Nhi']!.record as typeof rec;
      env = JSON.parse(rec.payload) as Envelope;
      ctx = `${rec.patientRef}|${rec.section}|${rec.id}`;
      expect(env.abe.policy).toMatch(/^MED:Role:BacSi#\d{4}W\d{2}\.0 AND MED:Khoa:Nhi#\d{4}W\d{2}\.0 OR MED:Role:KetLuan#\d{4}W\d{2}\.0$/);   // policy sinh từ ma trận
      expect(env.abe.policy).not.toMatch(/Device|SoYTe|BG:/);                                                 // không còn nhánh "máy tạo", Sở Y tế, phá vỡ kính

      await mat.readPatient('abe', patients[0].code); await td.readPatient('abe', patients[0].code);          // để hai người này giữ khoá của họ
      // control: đúng khoá → giải mã được
      const ok = await decrypt(nhi.gid, nhi.heldKeys(), env, ctx);
      expect(new TextDecoder().decode(ok!)).toContain(patients[0].lamsangNhi.canary);
      // sai khoa: có Role:BacSi nhưng Khoa:Mat
      expect(Object.keys(mat.heldKeys()).some((k) => k.startsWith('MED:Khoa:Mat'))).toBe(true);
      expect(await failsToOpen(decrypt(mat.gid, mat.heldKeys(), env, ctx))).toBe(true);
      // Tiếp đón (sai vai trò), Quản trị (không có khoá), và tập khoá rỗng
      expect(await failsToOpen(decrypt(td.gid, td.heldKeys(), env, ctx))).toBe(true);
      expect(Object.keys(qt.heldKeys())).toHaveLength(0);
      await expect(qt.ensureKeys([`MED:Role:BacSi#${env.abe.policy.match(/#(\d{4}W\d{2}\.\d+)/)![1]}`])).rejects.toMatchObject({ code: 'DENY_NO_ATTRIBUTES' });
      expect(await failsToOpen(decrypt(qt.me!.gid, {}, env, ctx))).toBe(true);
    }, 240_000);

    it('chống thông đồng: ghép khoá của hai người (GID khác nhau) không mở được; sai ngữ cảnh bản ghi cũng không', async () => {
      const nk = nhi.heldKeys(), mk = mat.heldKeys();
      const role = Object.keys(mk).find((k) => k.startsWith('MED:Role:BacSi'))!;
      const khoaNhi = Object.keys(nk).find((k) => k.startsWith('MED:Khoa:Nhi'))!;
      // Bác sĩ Mắt (gid M) có Role:BacSi@M và "mượn" Khoa:Nhi@N của bác sĩ Nhi: đủ thuộc tính nhưng khoá gắn H(GID) khác nhau
      const mixed = { [role]: mk[role], [khoaNhi]: nk[khoaNhi] };
      expect(await failsToOpen(decrypt(mat.gid, mixed, env, ctx))).toBe(true);
      expect(await failsToOpen(decrypt(nhi.gid, mixed, env, ctx))).toBe(true);
      // tráo phong bì sang bản ghi khác (ctx khác) → AES-GCM từ chối
      expect(await failsToOpen(decrypt(nhi.gid, nk, env, `${rec.patientRef}|${rec.section}|${crypto.randomUUID()}`))).toBe(true);
    }, 120_000);

    it('giả lập LỖI PHÂN QUYỀN backend: BASELINE lộ bản rõ, ABE chỉ lộ bản mã (người sai khoa vẫn không giải mã được)', async () => {
      const target = patients[1];
      await expect(qt.call('POST', '/api/v2/evidence/pdp-defect', { enabled: true })).rejects.toMatchObject({ status: 401 });   // phiên người dùng (kể cả Quản trị) không bật được lỗi giả lập
      const defect = (enabled: boolean) => S.fetch(`${S.baseUrl}/api/v2/evidence/pdp-defect`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': S.serviceToken }, body: JSON.stringify({ enabled }) });
      expect((await S.fetch(`${S.baseUrl}/api/v2/evidence/pdp-defect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' })).status).toBe(401);
      expect((await defect(true)).status).toBe(200);
      try {
        const baseline = by(await mat.readPatient('baseline', target.code));
        expect(baseline['lamsang.Nhi']!.status).toBe('OPEN');                                                  // BASELINE: backend lỗi → bản rõ của khoa khác
        expect(JSON.stringify(baseline['lamsang.Nhi']!.data)).toContain(target.lamsangNhi.canary);
        const abe = by(await mat.readPatient('abe', target.code));
        expect(abe['lamsang.Nhi']!.status).toBe('DENIED_CRYPTO');                                               // ABE: nhận được bản mã nhưng không giải mã được
        expect(JSON.stringify(abe['lamsang.Nhi']!.record)).not.toContain(target.lamsangNhi.canary);
      } finally { await defect(false); }
      expect(by(await mat.readPatient('baseline', target.code))['lamsang.Nhi']!.status).toBe('DENIED_BACKEND');   // sửa lỗi → chặn lại
    }, 240_000);
  });

  // ================================================================== D. mô hình đe doạ: lấy riêng kho lưu trữ
  describe('D. kho lưu trữ bị lộ (mô hình đe dọa T1/T2)', () => {
    const raw = async (mode: string) => (await (await S.fetch(`${S.baseUrl}/api/v2/evidence/raw?mode=${mode}`, { headers: { 'x-service-token': S.serviceToken } })).json()) as Record<string, string | null>[];
    const openKek = async (wrappedDek: string, wrapIv: string, id: string) => {
      const key = await crypto.subtle.importKey('raw', Buffer.from(S.kek, 'hex'), 'AES-GCM', false, ['decrypt']);
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(wrapIv, 'hex'), additionalData: new TextEncoder().encode(`kek|${id}`) }, key, Buffer.from(wrappedDek, 'hex')));
    };

    it('T1 — chỉ có CSDL (không có khoá): CẢ HAI chế độ đều không lộ nội dung (không có khác biệt)', async () => {
      for (const mode of ['BASELINE', 'ABE']) {
        const dump = JSON.stringify(await raw(mode));
        for (const p of patients.slice(0, 2)) for (const s of ['hanhchinh', 'lamsang.Nhi', 'lamsang.Mat'] as SectionKey[]) expect(dump).not.toContain(canaryOf(p, s));
        for (const p of patients) { expect(dump).not.toContain(p.code); expect(dump).not.toContain(p.hanhchinh.cccd); }
      }
    });

    it('T2 — CSDL + KEK máy chủ (chiếm máy chủ/sysadmin): BASELINE giải mã được toàn bộ, ABE vẫn không', async () => {
      const base = await raw('BASELINE');
      let recovered = 0;
      for (const r of base) {
        const dek = await openKek(r.baselineWrappedDek!, r.baselineWrapIv!, r.id!);
        const section = r.type === 'hanhchinh' ? 'hanhchinh' : `lamsang.${r.khoa}`;
        const key = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['decrypt']);
        const pt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(r.baselineIv!, 'hex'), additionalData: new TextEncoder().encode(`${r.id}|${r.patientRef}|${section}`) }, key, Buffer.from(r.baselineCt!, 'hex')));
        if (/CANARY-/.test(pt)) recovered++;
      }
      expect(recovered).toBe(base.length);                                                   // BASELINE: có KEK = đọc hết
      expect(base.length).toBeGreaterThanOrEqual(patients.length + 4);

      const abe = await raw('ABE');
      expect(abe.length).toBeGreaterThanOrEqual(patients.length + 4);
      for (const r of abe) {
        expect(r.baselineCt).toBeNull(); expect(r.baselineWrappedDek).toBeNull();          // ABE: backend không có DEK nào để bọc bằng KEK
        const env = JSON.parse(r.payload!) as Envelope;
        const key = await crypto.subtle.importKey('raw', Buffer.from(S.kek, 'hex'), 'AES-GCM', false, ['decrypt']);
        // thử dùng KEK (và mọi bí mật phía máy chủ) làm khoá bọc DEK: phải thất bại
        await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(env.wrapIv, 'hex'), additionalData: new TextEncoder().encode(env.abe.policy) }, key, Buffer.from(env.wrappedDek, 'hex'))).rejects.toThrow();
        expect(r.payload).not.toMatch(/CANARY-/);
      }
      expect(JSON.stringify(abe)).not.toContain(createHash('sha256').update(`MEDABE-BASELINE-REF|${patients[0].code.toUpperCase()}`).digest('hex').slice(0, 32));   // chỉ mục mù: không suy ngược được mã bệnh nhân
    });

    it('trên đường truyền (trong TLS): BASELINE gửi bản rõ cho backend, ABE KHÔNG BAO GIỜ gửi bản rõ', async () => {
      const writes = bodies.filter((b) => /\/api\/v2\/(baseline|abe)\/records/.test(b.url));
      const baseW = writes.filter((b) => b.url.includes('/baseline/')), abeW = writes.filter((b) => b.url.includes('/abe/'));
      expect(baseW.length).toBeGreaterThan(0); expect(abeW.length).toBeGreaterThan(0);
      expect(baseW.some((b) => b.body.includes('CANARY-'))).toBe(true);
      expect(abeW.some((b) => b.body.includes('CANARY-'))).toBe(false);
      expect(abeW.some((b) => b.body.includes(patients[0].hanhchinh.cccd))).toBe(false);
    });
  });

  // ================================================================== E. chữ ký + toàn vẹn
  describe('E. chữ ký cá nhân và phát hiện sửa dữ liệu', () => {
    it('người nhận phát hiện mọi kiểu sửa: nội dung, bản mã, manifest, chữ ký, chứng chỉ người khác', async () => {
      for (const mode of ['baseline', 'abe'] as Mode[]) {
        const sec = by(await nhi.readPatient(mode, patients[0].code))['lamsang.Nhi']!;
        const rec = sec.record as SignedRecordView;
        expect((await verifyRecord(rec, S.registryPk)).ok).toBe(true);
        const body = mode === 'abe' ? { payload: rec.payload!.replace(/.$/, (c) => (c === '0' ? '1' : '0')) } : { content: rec.content!.replace('CANARY', 'KANARY') };
        expect((await verifyRecord({ ...rec, ...body }, S.registryPk)).failed).toBe('DIGEST');
        expect((await verifyRecord({ ...rec, manifest: rec.manifest.replace('"v":1', '"v":2') }, S.registryPk)).failed).toBe('SIGNATURE');
        expect((await verifyRecord({ ...rec, signature: '0'.repeat(128) }, S.registryPk)).failed).toBe('SIGNATURE');
        const otherCert = by(await mat.readPatient(mode, patients[0].code))['lamsang.Mat']!.record!.signer;   // chứng chỉ+khoá của bác sĩ Mắt
        expect((await verifyRecord({ ...rec, signer: otherCert }, S.registryPk)).ok).toBe(false);
        expect((await verifyRecord(rec, '00'.repeat(32))).failed).toBe('CERT');                                // sai khoá registry đã ghim
      }
    }, 240_000);

    it('backend không tin userId/tên tự khai: bản ghi ký cho người khác bị từ chối ngay khi ghi', async () => {
      const dev = await machine1.get('bsnhi01');
      expect(dev).not.toBeNull();
      const p = patients[2];
      const rec = await (nhi as unknown as { buildRecord(m: Mode, i: unknown): Promise<Record<string, unknown>> }).buildRecord('baseline', { patientCode: p.code, section: 'lamsang.Nhi', data: { x: 1 } });
      const forged = { ...rec, manifest: String(rec.manifest).replace(nhi.me!.userId, mat.me!.userId) };
      await expect(nhi.call('POST', '/api/v2/baseline/records', forged)).rejects.toMatchObject({ code: 'SIGNER_NOT_SESSION_USER' });
      await expect(nhi.call('POST', '/api/v2/baseline/records', { ...rec, content: '{"x":2}' })).rejects.toMatchObject({ code: 'DIGEST_MISMATCH' });
      await expect(nhi.call('POST', '/api/v2/abe/records', { ...rec, content: undefined, payload: undefined })).rejects.toMatchObject({ code: 'PAYLOAD_REQUIRED' });
      await expect(nhi.call('POST', '/api/v2/abe/records', { ...rec, content: '{"leak":1}', payload: '{}' })).rejects.toMatchObject({ code: 'PLAINTEXT_REJECTED_IN_ABE_MODE' });
    }, 120_000);

    it('backend kiểm chuỗi policy của phong bì ABE: người dùng hợp lệ dùng máy khách sửa đổi cũng không ghi được bản mã có policy yếu hơn ma trận', async () => {
      const p = patients[2];
      const dev = (await machine1.get('bsnhi01'))!;
      const doc = await nhi.policy(), cfg = await nhi.config(), dir = await nhi.epochs();
      expect(doc.abePolicies['lamsang.Nhi']).toBe('MED:Role:BacSi AND MED:Khoa:Nhi OR MED:Role:KetLuan');
      const patientRef = await nhi.patientRef('abe', p.code);
      const attempt = async (policy: string) => {
        const id = crypto.randomUUID();
        const payload = JSON.stringify(await encrypt({ MED: cfg.pk }, policy, new TextEncoder().encode('{"x":1}'), `${patientRef}|lamsang.Nhi|${id}`));
        const manifest = JSON.stringify({ v: 1, recordId: id, patientRef, section: 'lamsang.Nhi', mode: 'ABE', policyVersion: doc.version, payloadDigest: sha256Hex(payload), signerUserId: nhi.me!.userId, signerDeviceId: nhi.me!.deviceId, signedAt: new Date().toISOString() });
        return nhi.call('POST', '/api/v2/abe/records', { id, patientRef, type: 'lamsang', khoa: 'Nhi', manifest, signature: await signHex(dev.signKey, SIG_DOMAIN + manifest), payload });
      };
      const v = (a: string) => `${a}#${dir.tag}.0`;
      await expect(attempt(`${v('MED:Role:BacSi')} AND ${v('MED:Khoa:Nhi')} OR ${v('MED:Role:TiepDon')}`)).rejects.toMatchObject({ code: 'POLICY_MISMATCH' });   // thêm nhánh Tiếp đón
      await expect(attempt(v('MED:Role:BacSi'))).rejects.toMatchObject({ code: 'POLICY_MISMATCH' });                                                          // bỏ điều kiện khoa
      await expect(attempt(`${v('MED:Device:abc')} OR ${v('MED:Role:BacSi')} AND ${v('MED:Khoa:Nhi')}`)).rejects.toMatchObject({ code: 'POLICY_MISMATCH' });   // nhánh "máy tạo luôn đọc được"
      await expect(attempt('MED:Role:BacSi#2020W01.0 AND MED:Khoa:Nhi#2020W01.0')).rejects.toMatchObject({ code: 'EPOCH_STALE' });
      await expect(attempt(`${v('MED:Role:BacSi')} AND ${v('MED:Khoa:Nhi')} OR ${v('MED:Role:KetLuan')}`)).resolves.toBeDefined();                                                        // đúng policy thì ghi được
    }, 120_000);
  });

  // ================================================================== F. giờ làm việc
  describe('F. lịch giờ làm việc (giờ máy chủ, đánh giá ở từng yêu cầu)', () => {
    it('đổi lịch hợp lệ có version + nhật ký; lịch sai bị từ chối; chỉ Quản trị (quyền riêng) được đổi', async () => {
      const cur = await qt.call<{ version: number; days: Record<string, unknown> }>('GET', '/api/v2/admin/schedule');
      expect(cur.version).toBe(1);
      await expect(nhi.call('PUT', '/api/v2/admin/schedule', { expectedVersion: 1, days: ALL_OPEN, reason: 'khong co quyen' })).rejects.toMatchObject({ status: 403 });
      await expect(qt.call('PUT', '/api/v2/admin/schedule', { expectedVersion: 99, days: ALL_OPEN, reason: 'sai version' })).rejects.toMatchObject({ status: 409 });
      await expect(qt.call('PUT', '/api/v2/admin/schedule', { expectedVersion: 1, days: { ...ALL_OPEN, MON: { open: '21:00', close: '07:00' } }, reason: 'mo sau dong' })).rejects.toMatchObject({ status: 400 });
      const audit = await qt.call<{ chain: { ok: boolean }; records: { action: string; detail: string }[] }>('GET', '/api/v2/admin/audit?limit=500');
      expect(audit.chain.ok).toBe(true);
    });

    it('NGOÀI GIỜ: phiên đã đăng nhập, API gọi trực tiếp, xin khoá mới, import đều bị chặn (423); trạng thái/đăng xuất/quản trị lịch vẫn dùng được', async () => {
      // trước khi đóng cửa: bác sĩ Nhi đã giữ khoá và đã sao chép bản mã + khoá (kẻ giữ bản sao)
      const before = by(await nhi.readPatient('abe', patients[0].code))['lamsang.Nhi']!;
      const copiedKeys = nhi.heldKeys(); const copiedEnv = JSON.parse((before.record as unknown as { payload: string }).payload) as Envelope;
      const copiedCtx = `${before.record!.patientRef}|${before.record!.section}|${before.record!.id}`;

      let notified = false; (nhi as unknown as { o: { onBusinessClosed?: () => void } }).o.onBusinessClosed = () => { notified = true; };
      await setSchedule(qt, ALL_CLOSED, 'kiem thu: mo phong ngoai gio lam viec');

      // phiên CŨ (đăng nhập từ trước) bị chặn ngay ở yêu cầu kế tiếp
      await expect(nhi.readPatient('baseline', patients[0].code)).rejects.toBeInstanceOf(BusinessClosedError);
      expect(notified).toBe(true);
      await expect(nhi.readPatient('abe', patients[0].code)).rejects.toMatchObject({ status: 423, code: 'OUTSIDE_BUSINESS_HOURS' });
      expect(Object.keys(nhi.heldKeys())).toHaveLength(0);               // máy khách bỏ khoá khỏi bộ nhớ (nỗ lực tốt nhất)
      // ghi / import / xin khoá / quản lý người dùng
      await expect(td.saveSection('baseline', { patientCode: patients[2].code, section: 'hanhchinh', data: patients[2].hanhchinh })).rejects.toMatchObject({ status: 423 });
      await expect(td.importMany('abe', [{ patientCode: patients[2].code, section: 'hanhchinh', data: patients[2].hanhchinh }])).rejects.toMatchObject({ status: 423 });
      await expect(nhi.ensureKeys(['MED:Role:BacSi#2026W44.0'])).rejects.toMatchObject({ status: 423 });
      await expect(qt.call('GET', '/api/v2/admin/users')).rejects.toMatchObject({ status: 423 });
      // gọi API trực tiếp bằng token hợp lệ, không qua thư viện client
      const raw = await S.fetch(`${S.baseUrl}/api/v2/baseline/records?patientRef=${'a'.repeat(32)}`, { headers: { authorization: `Bearer ${(nhi as unknown as { token: string }).token}` } });
      expect(raw.status).toBe(423);
      const body = (await raw.json()) as { businessOpen: boolean; nextOpenAt: string | null; policyVersion: string };
      expect(body).toMatchObject({ businessOpen: false, policyVersion: '2.3.0' });
      // các chức năng tối thiểu, được liệt kê tường minh
      const st = await nhi.status();
      expect(st.businessOpen).toBe(false);
      expect(st.afterHoursAllowed).toEqual(['status.read', 'auth.challenge', 'auth.login', 'auth.logout', 'auth.me', 'schedule.manage']);
      await expect(nhi.call('GET', '/api/v2/auth/me')).resolves.toMatchObject({ username: 'bsnhi01' });
      await expect(qt.call('GET', '/api/v2/admin/schedule')).resolves.toMatchObject({ businessOpen: false });   // quản trị lịch (quyền riêng) dùng được
      // đăng nhập lại ngoài giờ được (không phải truy cập nghiệp vụ) nhưng phiên mới cũng bị chặn nghiệp vụ
      const again = client(); await again.signIn('bsnhi01', pw('bsnhi01'));
      await expect(again.readPatient('baseline', patients[0].code)).rejects.toMatchObject({ status: 423 });
      await again.signOut();

      // GIỚI HẠN ĐÃ CÔNG BỐ: khoá + bản mã ĐÃ SAO CHÉP trước đó không hết hiệu lực khi đồng hồ qua giờ đóng cửa
      const offline = await decrypt(nhi.gid, copiedKeys, copiedEnv, copiedCtx);
      expect(new TextDecoder().decode(offline!)).toContain(patients[0].lamsangNhi.canary);

      // mở cửa lại: phiên cũ dùng tiếp được, KHÔNG có thao tác ghi nào tự chạy lại
      await setSchedule(qt, ALL_OPEN, 'kiem thu: mo cua lai');
      const after = by(await nhi.readPatient('abe', patients[0].code));
      expect(after['lamsang.Nhi']!.status).toBe('OPEN');
      expect(by(await td.readPatient('baseline', patients[2].code)).hanhchinh?.versions ?? 1).toBeGreaterThanOrEqual(1);
      const refAfter = await td.patientRef('baseline', patients[2].code);
      const listed = await td.call<{ sections: unknown[] }>('GET', `/api/v2/baseline/records?patientRef=${refAfter}`);
      expect(listed.sections.length).toBe(1);                            // vẫn chỉ là bản Hành chính đã import trước đó, không có bản ghi bị chặn nào tự lưu
    }, 300_000);

    it('xin vé lấy trước giờ đóng cửa không sống qua giờ đóng cửa; nút cấp khoá đánh giá lại tại backend', async () => {
      const dir = await nhi.epochs();
      const attr = `MED:Role:BacSi#${dir.tag}.0`;
      const t = await nhi.call<{ jti: string }>('POST', '/api/v2/keys/ticket', { attrs: [attr] });
      await setSchedule(qt, ALL_CLOSED, 'kiem thu: dong cua sau khi da lay ve');
      const cfg = await nhi.config();
      const sig = '00'.repeat(64);
      const res = await S.fetch(`${cfg.nodes[0].url}/v2/partials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jti: t.jti, sig, attrs: [attr] }) });
      expect(res.status).toBe(423);                                      // backend đánh giá GIỜ trước chứng minh khoá: nút nhận 423 và không cấp gì
      expect(((await res.json()) as { partials?: unknown }).partials).toBeUndefined();
      await setSchedule(qt, ALL_OPEN, 'kiem thu: mo cua lai');
    }, 120_000);
  });

  // ================================================================== G. đường cũ bị đóng, nhật ký
  describe('G. không có đường vòng qua phân quyền backend', () => {
    it('các endpoint bản ghi/header/phụ huynh cũ bị đóng khi bật luồng nghiên cứu; nhật ký chuỗi băm còn nguyên vẹn và ghi lý do từ chối', async () => {
      for (const p of ['/api/records?patientIdx=' + 'a'.repeat(32), '/api/headers?ids=x', '/api/public/parent-records?parentIdx=' + 'a'.repeat(32)])
        expect((await S.fetch(S.baseUrl + p)).status).toBe(410);
      const audit = await qt.call<{ chain: { ok: boolean }; records: { action: string; detail: string }[] }>('GET', '/api/v2/admin/audit?limit=1000');
      expect(audit.chain.ok).toBe(true);
      const text = JSON.stringify(audit.records);
      expect(text).toContain('deny action=record.write section=lamsang.Mat reason=DENY_KHOA_MISMATCH');
      expect(text).toContain('reason=DENY_OUTSIDE_BUSINESS_HOURS');
      expect(text).toContain('policy=2.3.0');
      expect(text).toContain('v2.schedule.update');
      expect(text).toContain('v2.key.redeem');
    });
  });
});

describe.skipIf(!JAR)('I. admin cấp tài khoản theo số điện thoại nhân viên', () => {
  it('mật khẩu tạm → bắt buộc tự đổi → dùng đúng quyền; admin (biết mật khẩu tạm) không đăng nhập thay được; quên mật khẩu thì cấp lại', async () => {
    const made = await qt.call<{ username: string; temporaryPassword: string; mustChangePassword: boolean; role: string; khoa: string }>('POST', '/api/v2/admin/users',
      { phone: '0901 111 222', displayName: 'Bac si Nhi (moi vao lam)', role: 'BAC_SI', khoa: 'Nhi' });
    expect(made).toMatchObject({ username: '0901111222', mustChangePassword: true, role: 'BAC_SI', khoa: 'Nhi' });
    expect(made.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    await expect(qt.call('POST', '/api/v2/admin/users', { phone: '+84901111222', username: 'trung-sdt', role: 'TIEP_DON' })).rejects.toMatchObject({ code: 'PHONE_EXISTS' });

    const nv = client(new MemoryDeviceKeyStore());                          // máy của nhân viên
    await expect(nv.signIn(made.username, made.temporaryPassword)).rejects.toBeInstanceOf(PasswordChangeRequiredError);   // chưa đặt mật khẩu mới thì không vào
    const me = await nv.signIn(made.username, made.temporaryPassword, { newPassword: 'MatKhau-Moi-2026' });
    expect(me).toMatchObject({ role: 'BAC_SI', khoa: 'Nhi', mustChangePassword: false, displayName: 'Bac si Nhi (moi vao lam)' });
    const v = by(await nv.readPatient('abe', patients[0].code));
    expect(v['lamsang.Nhi']?.status).toBe('OPEN'); expect(v['lamsang.Mat']?.status).toBe('DENIED_BACKEND');

    // admin biết mật khẩu TẠM nhưng nó đã vô hiệu: không đăng nhập/đăng ký thiết bị/ký thay nhân viên được
    await expect(client(new MemoryDeviceKeyStore()).signIn(made.username, made.temporaryPassword)).rejects.toMatchObject({ code: 'BAD_CREDENTIALS' });

    // quên mật khẩu → admin cấp lại mật khẩu tạm → phiên cũ chết ngay → phải đổi lại
    const again = await qt.call<{ temporaryPassword: string }>('POST', `/api/v2/admin/users/${me.userId}/reset-password`, {});
    await expect(nv.call('GET', '/api/v2/auth/me')).rejects.toMatchObject({ status: 401 });
    await expect(nv.signIn(made.username, 'MatKhau-Moi-2026')).rejects.toMatchObject({ code: 'BAD_CREDENTIALS' });
    await expect(nv.signIn(made.username, again.temporaryPassword)).rejects.toBeInstanceOf(PasswordChangeRequiredError);
    const back = await nv.signIn(made.username, again.temporaryPassword, { newPassword: 'MatKhau-Moi-2027' });
    expect(back.userId).toBe(me.userId); expect(back.gid).toBe(me.gid);   // vẫn là CÙNG người: cùng userId/GID, không mất quyền đọc dữ liệu cũ
    expect(by(await nv.readPatient('abe', patients[0].code))['lamsang.Nhi']?.status).toBe('OPEN');
    // chỉ Quản trị tạo được tài khoản
    await expect(td.call('POST', '/api/v2/admin/users', { phone: '0912345678', role: 'TIEP_DON' })).rejects.toMatchObject({ status: 403 });
  }, 240_000);
});

// ================================================================== H. nhiều VLAN (dùng địa chỉ LAN THẬT của máy làm "vùng mạng khác")
const lanIp = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal && !/^169\.254\./.test(i.address))?.address;
describe.skipIf(!JAR || !lanIp)('H. truy cập qua VLAN khác (nguồn kết nối là IP LAN thật, không phải loopback)', () => {
  let vlan: ResearchStack | undefined;
  let blocked: ResearchStack | undefined;
  afterAll(async () => { await vlan?.stop(); await blocked?.stop(); });
  const cidr = () => lanIp!.split('.').slice(0, 3).join('.') + '.0/24';

  it('vùng mạng được cấp phép: kết nối + đăng nhập + dùng ABE bình thường qua IP LAN; log ghi vùng mạng như NGỮ CẢNH, vai trò không đổi', async () => {
    vlan = await startResearchStack({ host: lanIp!, sans: [`ip:${lanIp}`], zones: `KHOA-NHI:${cidr()}`, passwordIterations: 20000 });
    const c = new ResearchClient({ baseUrl: vlan.baseUrl, fetch: vlan.fetch, store: new MemoryDeviceKeyStore(), pin: { registryPk: vlan.registryPk } });
    const me = await c.signIn('bsnhi01', pw('bsnhi01'));
    expect(me.networkZone).toBe('KHOA-NHI');                     // nguồn: IP LAN, thuộc vùng cấu hình (không phải LOOPBACK)
    expect(me).toMatchObject({ role: 'BAC_SI', khoa: 'Nhi' });  // chuyển vùng không đổi vai trò/khoa
    await c.saveSection('abe', { patientCode: 'BN-GIA-VLAN', section: 'lamsang.Nhi', data: { canary: 'CANARY-VLAN' } });
    expect(by(await c.readPatient('abe', 'BN-GIA-VLAN'))['lamsang.Nhi']!.status).toBe('OPEN');
    await expect(c.status()).resolves.toMatchObject({ networkZone: 'KHOA-NHI' });
  }, 240_000);

  it('vùng KHÔNG được cấp phép bị chặn ở tầng mạng (403 LAN_ONLY) dù có tài khoản đúng; loopback vẫn vào được', async () => {
    blocked = await startResearchStack({ host: lanIp!, sans: [`ip:${lanIp}`], zones: 'KHOA-KHAC:10.99.0.0/24', noNodes: true, passwordIterations: 20000 });
    const viaLan = await blocked.fetch(`${blocked.baseUrl}/api/v2/status`);
    expect(viaLan.status).toBe(403);
    expect(((await viaLan.json()) as { error: string }).error).toMatch(/LAN_ONLY/);
    const viaLoop = await blocked.fetch(`https://127.0.0.1:${new URL(blocked.baseUrl).port}/api/v2/status`);
    expect(viaLoop.status).toBe(200);
  }, 240_000);
});
