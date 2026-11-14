// APP TRA CỨU: "máy khác vừa nhập xong thì app tra cứu phải thấy ngay" — kiểm tra DẤU VÂN TAY THEO BỆNH NHÂN (GET /api/records/version?patientIdx=).
// Quy tắc cần chứng minh:
//  1. Có người nhập mục mới thì dấu vân tay của những tài khoản ĐƯỢC XEM mục đó đổi ngay; tài khoản không được xem thì KHÔNG đổi (không lộ việc có thêm mục của khoa khác).
//  2. Tài khoản không có quyền đọc gì (Quản trị) luôn thấy "0".
//  3. Hỏi nhiều lần khi không có ai nhập thì giá trị không đổi (app hỏi mỗi vài giây); tham số sai bị từ chối 400.
//     (Máy chủ không gọi audit/auditPrivilegedRead cho đường này nên không làm ngập nhật ký và không tính vào cảnh báo đọc nhiều của Giám sát; điều này thấy được ở mã, không kiểm bằng test.)
// DỮ LIỆU GIẢ. Cần jar: (cd security/storage && ./mvnw -DskipTests package).
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_USERS, startResearchStack, type ResearchStack } from '../deploy/research-stack.js';
import { fakePatients } from '../research/fake-data.js';
import { MemoryDeviceKeyStore } from '../research/keys.js';
import { MedClient } from './medclient.js';

const JAR = existsSync(resolve('security/storage/target')) && readdirSync(resolve('security/storage/target')).some((f) => /^medabe-storage-.*\.jar$/.test(f));
const pw = (u: string): string => DEMO_USERS.find((x) => x.username === u)!.password;
const [P] = fakePatients(1, 777);
const cccd = P.hanhchinh.cccd;
let S: ResearchStack;
const login = (u: string) => MedClient.signIn(S.baseUrl, u, pw(u), new MemoryDeviceKeyStore(), { fetch: S.fetch });
let td: MedClient, nl: MedClient, mat: MedClient, nhi: MedClient, qt: MedClient;

beforeAll(async () => {
  if (!JAR) return;
  S = await startResearchStack({ passwordIterations: 20000, legacyBridge: true });
  [td, nl, mat, nhi, qt] = await Promise.all(['tiepdon01', 'nhaplieu01', 'bsmat01', 'bsnhi01', 'quantri01'].map(login));
}, 300_000);
afterAll(async () => { await S?.stop(); });

describe.skipIf(!JAR)('Dấu vân tay theo bệnh nhân (app tra cứu cập nhật ngay)', () => {
  it('hồ sơ chưa có gì: mọi tài khoản thấy "0|"', async () => {
    for (const c of [td, nl, mat, nhi, qt]) expect(await c.patientVersion(cccd).catch(() => '0|')).toBe('0|');
  });

  it('Tiếp đón nhập Hành chính: Tiếp đón và bác sĩ thấy dấu vân tay ĐỔI ngay; Quản trị vẫn "0|"', async () => {
    const v0 = { td: await td.patientVersion(cccd), mat: await mat.patientVersion(cccd), nhi: await nhi.patientVersion(cccd) };
    await td.saveMany([{ patientCode: cccd, type: 'hanhchinh', khoa: 'KSK', data: { hoTen: P.hanhchinh.hoTen, cccd, canary: P.hanhchinh.canary }, group: 'TRUONG-A' }]);
    expect(await td.patientVersion(cccd)).not.toBe(v0.td);
    expect(await mat.patientVersion(cccd)).not.toBe(v0.mat);
    expect(await nhi.patientVersion(cccd)).not.toBe(v0.nhi);
    expect(await qt.patientVersion(cccd).catch(() => '0|')).toBe('0|');
  }, 120_000);

  it('người nhập lưu mục khoa Mắt: bác sĩ Mắt và người nhập thấy ĐỔI; bác sĩ Nhi KHÔNG đổi (không lộ mục của khoa khác)', async () => {
    const before = { mat: await mat.patientVersion(cccd), nhi: await nhi.patientVersion(cccd), nl: await nl.patientVersion(cccd) };
    await nl.saveRecord({ patientCode: cccd, type: 'lamsang', khoa: 'Mat', data: { ketLuan: P.lamsangMat.canary } });
    expect(await mat.patientVersion(cccd)).not.toBe(before.mat);
    expect(await nl.patientVersion(cccd)).not.toBe(before.nl);
    expect(await nhi.patientVersion(cccd)).toBe(before.nhi);
  }, 120_000);

  it('đúng thứ bác sĩ Mắt nhìn thấy khi tra: sau khi dấu vân tay đổi, danh sách đọc được có mục mới và giải mã đúng', async () => {
    const rows = await mat.listRecords(cccd);
    const ls = rows.filter((r) => r.type === 'lamsang' && r.khoa === 'Mat');
    expect(ls.length).toBeGreaterThan(0);
    const open = await mat.openRecord(ls[ls.length - 1]);
    expect(JSON.stringify(open!.data)).toContain(P.lamsangMat.canary);
  }, 120_000);

  it('hỏi dấu vân tay nhiều lần vẫn ổn định (không đổi khi không có ai nhập) và tham số sai bị từ chối', async () => {
    const v = await mat.patientVersion(cccd);
    for (let i = 0; i < 12; i++) expect(await mat.patientVersion(cccd)).toBe(v);
    const bad = await S.fetch(`${S.baseUrl}/api/records/version?patientIdx=khong-hop-le`, { headers: { authorization: `Bearer ${mat.s.token}` } });
    expect(bad.status).toBe(400);
  }, 120_000);
});
