// Cây truy cập (access tree) cho CP-ABE. Cú pháp: thuộc tính, AND, OR, ngoặc.
// Ví dụ: (CapBac:Dai_ta AND ChienDich:Alpha) OR CapBac:Tuong
// AND = ngưỡng n-trên-n, OR = ngưỡng 1-trên-n (đúng khung ngưỡng của BSW07).
// Ưu tiên: AND chặt hơn OR.

export type PolicyNode =
  | { kind: 'leaf'; attr: string }
  | { kind: 'gate'; k: number; children: PolicyNode[] };

const ATTR = /^[A-Za-z0-9_:.#\-]+$/;

export function parsePolicy(input: string): PolicyNode {
  const tokens = input.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;

  const peek = () => tokens[pos];
  const isOp = (t: string | undefined, op: string) => t !== undefined && t.toUpperCase() === op;

  function parseOr(): PolicyNode {
    const parts = [parseAnd()];
    while (isOp(peek(), 'OR')) {
      pos++;
      parts.push(parseAnd());
    }
    return parts.length === 1 ? parts[0] : { kind: 'gate', k: 1, children: parts };
  }

  function parseAnd(): PolicyNode {
    const parts = [parseAtom()];
    while (isOp(peek(), 'AND')) {
      pos++;
      parts.push(parseAtom());
    }
    return parts.length === 1 ? parts[0] : { kind: 'gate', k: parts.length, children: parts };
  }

  function parseAtom(): PolicyNode {
    const t = tokens[pos++];
    if (t === undefined) throw new Error('Policy kết thúc đột ngột');
    if (t === '(') {
      const node = parseOr();
      if (tokens[pos++] !== ')') throw new Error('Thiếu dấu ")" trong policy');
      return node;
    }
    if (t === ')' || isOp(t, 'AND') || isOp(t, 'OR') || !ATTR.test(t)) {
      throw new Error(`Token không hợp lệ trong policy: "${t}"`);
    }
    return { kind: 'leaf', attr: t };
  }

  if (tokens.length === 0) throw new Error('Policy rỗng');
  const root = parseOr();
  if (pos !== tokens.length) throw new Error(`Policy thừa token: "${tokens[pos]}"`);
  return root;
}

/** Danh sách lá theo thứ tự duyệt sâu (DFS) - thứ tự này cố định, dùng để ghép ciphertext. */
export function leavesOf(node: PolicyNode): string[] {
  return node.kind === 'leaf' ? [node.attr] : node.children.flatMap(leavesOf);
}

/** Thay mọi tên thuộc tính trong chuỗi policy (giữ nguyên AND/OR/ngoặc). */
export function mapPolicyAttrs(policy: string, fn: (attr: string) => string): string {
  parsePolicy(policy); // kiểm tra cú pháp trước
  return policy.replace(/[^\s()]+/g, (t) => (/^(AND|OR)$/i.test(t) ? t : fn(t)));
}

/** Tập thuộc tính có thoả policy không (kiểm tra logic thuần, không mật mã). */
export function satisfies(node: PolicyNode, attrs: ReadonlySet<string>): boolean {
  if (node.kind === 'leaf') return attrs.has(node.attr);
  return node.children.filter((c) => satisfies(c, attrs)).length >= node.k;
}
