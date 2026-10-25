import { describe, expect, it } from 'vitest';
import { makeFailLimiter } from './http.js';

describe('chống dò token quản trị', () => {
  it('sai 5 lần trong 1 phút thì khoá 1 phút; hết hạn thì mở lại; địa chỉ khác không bị ảnh hưởng', () => {
    let t = 0;
    const l = makeFailLimiter(5, 60_000, () => t);
    for (let i = 0; i < 4; i++) l.fail('1.1.1.1');
    expect(l.blocked('1.1.1.1')).toBe(false);
    l.fail('1.1.1.1');
    expect(l.blocked('1.1.1.1')).toBe(true);
    expect(l.blocked('2.2.2.2')).toBe(false);
    t += 59_999;
    expect(l.blocked('1.1.1.1')).toBe(true);
    t += 2;
    expect(l.blocked('1.1.1.1')).toBe(false);
  });

  it('các lần sai cách nhau quá 1 phút không cộng dồn; thành công thì xoá bộ đếm', () => {
    let t = 0;
    const l = makeFailLimiter(3, 60_000, () => t);
    l.fail('a'); l.fail('a');
    t += 61_000;
    l.fail('a'); l.fail('a');
    expect(l.blocked('a')).toBe(false);
    l.ok('a'); l.fail('a'); l.fail('a');
    expect(l.blocked('a')).toBe(false);
  });
});
