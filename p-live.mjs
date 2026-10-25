import fs from 'node:fs';
const rd = (f) => fs.readFileSync(f, 'utf8');
const sub = (f, a, b) => { const s = rd(f); if (!s.includes(a)) throw new Error(f + ': ' + a.slice(0, 70)); fs.writeFileSync(f, s.replace(a, () => b)); };
const base = 'security/storage/src/main/java/com/medabe/storage/';

// ---- Spring: dấu vân tay của một nhóm (đơn vị) để các máy biết có người khác vừa nhập ----
sub(base + 'domain/Repos.java', '        List<MedicalRecord> findTop500ByParentIdxOrderByCreatedAtAsc(String parentIdx);', '        List<MedicalRecord> findTop500ByParentIdxOrderByCreatedAtAsc(String parentIdx);\n        long countByGroupIdxAndType(String groupIdx, String type);\n        java.util.Optional<MedicalRecord> findFirstByGroupIdxAndTypeOrderByCreatedAtDesc(String groupIdx, String type);');
sub(base + 'web/RecordController.java', '    @GetMapping("/api/records")', `    /** Dau van tay cua mot nhom (so ban ghi + thoi diem moi nhat): may khach hoi moi vai giay, co nguoi khac nhap thi tai lai danh sach. */
    @GetMapping("/api/records/version")
    public Map<String, Object> groupVersion(HttpServletRequest req, @RequestParam String groupIdx, @RequestParam String type) {
        auth.device(req);
        if (!groupIdx.matches("[0-9a-f]{32}") || !TYPES.contains(type)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tham so sai");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("n", records.countByGroupIdxAndType(groupIdx, type));
        m.put("last", records.findFirstByGroupIdxAndTypeOrderByCreatedAtDesc(groupIdx, type).map(r -> r.createdAt.toString()).orElse(""));
        return m;
    }

    @GetMapping("/api/records")`);

// ---- SDK ----
sub('security/src/client/medclient.ts', '  /** Chỉ chủ bản ghi (thiết bị đã tạo) mới xoá được', `  /** Dấu vân tay của danh sách một đơn vị: đổi giá trị nghĩa là có người nhập/sửa hồ sơ. Rất nhẹ, gọi mỗi vài giây. */
  async groupVersion(group: string, type: RecordType = 'hanhchinh'): Promise<string> {
    const v = (await this.get(\`/api/records/version?groupIdx=\${this.groupIdx(group)}&type=\${type}\`)) as unknown as { n: number; last: string };
    return \`\${v.n}|\${v.last}\`;
  }

  /** Chỉ chủ bản ghi (thiết bị đã tạo) mới xoá được`);

// ---- Exam: danh sách tự cập nhật khi người khác nhập ----
const E = 'app/web/src/Exam.tsx';
sub(E, "import { useCallback, useEffect, useMemo, useRef, useState } from 'react';", "import { useCallback, useEffect, useMemo, useRef, useState } from 'react';");
sub(E, `  const load = useCallback(async () => {
    setRows([]); setSel(null);
    const all = await c.listGroup(unit);
    const latest = new Map<string, RecordRow>();
    for (const r of all) { const p = latest.get(r.patientIdx); if (!p || r.createdAt >= p.createdAt) latest.set(r.patientIdx, r); }
    const recs = [...latest.values()];
    setProg({ d: 0, t: recs.length });
    const res = await c.openMany(recs, (d, t) => setProg({ d, t }));
    setRows(recs.map((rec, i) => ({ rec, data: (res[i]?.data as HanhChinh) ?? null })));
    setProg(null);
    log(\`Đã tải \${recs.length} hồ sơ của đơn vị và giải mã trên máy này.\`, 'ok');
  }, [c, unit]);`,
`  // Bản đã giải mã của từng bản ghi (theo id): tải lại chỉ giải mã phần MỚI, nên cập nhật khi người khác nhập rất nhanh.
  const decrypted = useRef(new Map<string, HanhChinh | null>());
  const lastVersion = useRef('');
  const loading = useRef(false);
  const [liveAt, setLiveAt] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    loading.current = true;
    try {
      if (!silent) { setRows([]); setSel(null); }
      lastVersion.current = await c.groupVersion(unit).catch(() => lastVersion.current);   // lấy dấu vân tay TRƯỚC khi tải: thay đổi trong lúc tải sẽ bị bắt ở lần hỏi kế tiếp
      const all = await c.listGroup(unit);
      const latest = new Map<string, RecordRow>();
      for (const r of all) { const p = latest.get(r.patientIdx); if (!p || r.createdAt >= p.createdAt) latest.set(r.patientIdx, r); }
      const recs = [...latest.values()];
      const todo = recs.filter((r) => !decrypted.current.has(r.id));
      if (!silent && todo.length > 20) setProg({ d: 0, t: todo.length });
      const res = await c.openMany(todo, silent ? undefined : (d, t) => setProg({ d, t }));
      todo.forEach((r, i) => decrypted.current.set(r.id, (res[i]?.data as HanhChinh) ?? null));
      setRows(recs.map((rec) => ({ rec, data: decrypted.current.get(rec.id) ?? null })));
      setProg(null);
      setLiveAt(new Date());
      if (!silent) log(\`Đã tải \${recs.length} hồ sơ của đơn vị và giải mã trên máy này.\`, 'ok');
    } finally { loading.current = false; }
  }, [c, unit]);

  // Nhiều người cùng nhập: cứ 4 giây hỏi "có dữ liệu mới chưa" (rất nhẹ); có người khác lưu thì tự tải lại, số liệu các tab cập nhật ngay.
  useEffect(() => {
    const t = setInterval(() => {
      if (loading.current) return;
      void c.groupVersion(unit).then((v) => { if (lastVersion.current && v !== lastVersion.current && !loading.current) return load(true); }).catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [c, unit, load]);`);
sub(E, "useEffect(() => { reset(); setMode('new'); setSec('hanhchinh'); void run('Tải danh sách đơn vị', load); }, [unit]);", "useEffect(() => { reset(); setMode('new'); setSec('hanhchinh'); decrypted.current.clear(); lastVersion.current = ''; void run('Tải danh sách đơn vị', () => load()); }, [unit]);");
sub(E, "              <button className=\"reload\" onClick={() => void run('Tải lại danh sách đã lưu', load)}>⟳ Tải lại danh sách đã lưu</button>", "              <button className=\"reload\" onClick={() => void run('Tải lại danh sách đã lưu', () => load())}>⟳ Tải lại danh sách đã lưu</button>\n              <span className=\"livepill\" title=\"Danh sách tự cập nhật khi người khác nhập\">● trực tiếp{liveAt ? ' · ' + liveAt.toLocaleTimeString('vi-VN') : ''}</span>");
fs.appendFileSync('app/web/src/styles.css', "\n.livepill{margin-left:10px;font-size:12px;color:#17692f;white-space:nowrap}\n");
console.log('ok');
