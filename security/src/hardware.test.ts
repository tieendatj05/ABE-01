import { describe, expect, it } from 'vitest';
import { hardwareHash, matchHardware, type Hardware } from './hardware.js';

const pc: Hardware = { cpu: 'BFEBFBFF000A0671', board: 'PF3ABCDE', bios: 'R1ZXYZ123', disk: 'WD-WX12A3456789', macs: ['AA:BB:CC:00:11:22'], host: 'MAY-BS-01' };

describe('ràng buộc phần cứng', () => {
  it('cùng máy: khớp', () => expect(matchHardware(pc, { ...pc }).ok).toBe(true));

  it('chịu được đổi card mạng/VPN, đổi tên máy và thay MỘT linh kiện (ổ đĩa)', () => {
    const upgraded = { ...pc, macs: ['DE:AD:BE:EF:00:01'], host: 'MAY-KHAC', disk: 'SAMSUNG-NEW-SSD' };
    const r = matchHardware(pc, upgraded);
    expect(r.matched).toBe(3);
    expect(r.ok).toBe(true);
  });

  it('máy khác (chép thư mục dữ liệu sang máy lạ): từ chối', () => {
    const other: Hardware = { cpu: 'BFEBFBFF000906EA', board: 'ZZZ999', bios: 'OTHERBIOS', disk: 'OTHERDISK', macs: pc.macs, host: pc.host };
    expect(matchHardware(pc, other).ok).toBe(false);   // trùng MAC + tên máy vẫn không đủ
  });

  it('thay 2 linh kiện cùng lúc thì coi là máy khác', () => {
    expect(matchHardware(pc, { ...pc, cpu: 'X', board: 'Y' }).ok).toBe(false);
  });

  it('serial giả/"To Be Filled By O.E.M." không được tính là bằng chứng khớp', () => {
    const oem = { ...pc, board: 'To Be Filled By O.E.M.', bios: 'Default string' };
    const same = matchHardware(oem, { ...oem });
    expect(same.available).toBe(2);                    // chỉ còn CPU + disk để so sánh
    const other = matchHardware(oem, { ...oem, cpu: 'KHAC', disk: 'KHAC' });
    expect(other.ok).toBe(false);
    // quá ít thành phần dùng được thì không đủ tin cậy để coi là khớp
    expect(matchHardware({ ...pc, board: '', bios: '', disk: '' }, { ...pc, board: '', bios: '', disk: '' }).ok).toBe(false);
  });

  it('băm gửi registry ổn định theo thành phần cố định và không lộ serial thô', () => {
    const h = hardwareHash(pc);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hardwareHash({ ...pc, macs: [], host: 'doi-ten' }));
    expect(h).not.toContain('PF3ABCDE');
  });

  it('MacBook (UUID + serial của máy, không có ổ đĩa): vẫn đủ thành phần để nhận diện đúng máy và từ chối máy khác', () => {
    const mac: Hardware = { cpu: 'Apple M2', board: '6F1C2D3E-AAAA-BBBB-CCCC-123456789ABC', bios: 'C02XYZ123ABC', disk: '', macs: ['AA:BB:CC:00:11:22'], host: 'MacBook-Air' };
    const same = matchHardware(mac, { ...mac, macs: ['DE:AD:BE:EF:00:01'], host: 'doi-ten' });
    expect(same.available).toBe(3);
    expect(same.ok).toBe(true);
    expect(matchHardware(mac, { ...mac, board: 'KHAC', bios: 'KHAC' }).ok).toBe(false);
  });
});
