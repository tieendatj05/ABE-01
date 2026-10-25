// Lưu trạng thái JSON ra file (ghi nguyên tử) + audit log dạng chuỗi băm.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AuditRec { seq: number; ts: string; actor: string; action: string; detail: string; prev: string; hash: string }

export class JsonStore<T extends { audit: AuditRec[] }> {
  state!: T;
  private file: string;

  constructor(readonly dir: string, name = 'state.json') {
    mkdirSync(join(dir, 'blobs'), { recursive: true });
    this.file = join(dir, name);
  }

  open(init: () => T): T {
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : init();
    this.save();
    return this.state;
  }

  save() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }

  blobPath(id: string) { return join(this.dir, 'blobs', id + '.json'); }

  /** Mỗi dòng băm kèm hash dòng trước: sửa/xoá một dòng thì mọi dòng sau lệch -> phát hiện được. */
  log(actor: string, action: string, detail = '') {
    const a = this.state.audit;
    const prev = a.length ? a[a.length - 1].hash : '0'.repeat(64);
    const rec = { seq: a.length + 1, ts: new Date().toISOString(), actor, action, detail, prev };
    a.push({ ...rec, hash: createHash('sha256').update(JSON.stringify(rec)).digest('hex') });
    this.save();
  }

  verifyAudit(): { ok: boolean; brokenAt?: number } {
    let prev = '0'.repeat(64);
    for (const r of this.state.audit) {
      const { hash, ...rest } = r;
      if (r.prev !== prev || createHash('sha256').update(JSON.stringify(rest)).digest('hex') !== hash) return { ok: false, brokenAt: r.seq };
      prev = hash;
    }
    return { ok: true };
  }
}
