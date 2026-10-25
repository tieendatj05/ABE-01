// Chuyển cây policy AND/OR thành ma trận LSSS (Lewko–Waters): mỗi lá là một hàng, mỗi hàng ứng
// với một thuộc tính. Tập hàng thoả policy <=> vector (1,0,...,0) nằm trong span của các hàng đó.
import { bls12_381 as bls } from '@noble/curves/bls12-381.js';
import type { PolicyNode } from './policy.js';

const Fr = bls.fields.Fr;
const R = Fr.ORDER;
export const mod = (a: bigint) => ((a % R) + R) % R;

export interface Lsss {
  /** Mỗi hàng dài `cols`, phần tử trong {0, 1, -1} (đã mod R khi dùng). */
  rows: bigint[][];
  attrs: string[];
  cols: number;
}

export function toLsss(tree: PolicyNode): Lsss {
  const rows: bigint[][] = [];
  const attrs: string[] = [];
  let cols = 1;

  const pad = (v: bigint[], n: number) => [...v, ...Array<bigint>(n - v.length).fill(0n)];

  function label(node: PolicyNode, vec: bigint[]): void {
    if (node.kind === 'leaf') {
      rows.push(vec);
      attrs.push(node.attr);
      return;
    }
    const n = node.children.length;
    if (node.k === 1) {
      node.children.forEach((c) => label(c, vec)); // OR: mọi con dùng chung vector cha
    } else if (node.k === n) {
      chain(node.children, vec); // AND
    } else {
      throw new Error('Chỉ hỗ trợ cổng AND/OR (ngưỡng k-trên-n tổng quát chưa cài)');
    }
  }

  // AND(c1, c2, ..., cn) = AND(c1, AND(c2, ...)): con trái nhận (v,1), phần còn lại nhận (0,-1)
  // => tổng hai vector = (v,0), nên chỉ khi có đủ cả hai thì mới tái tạo được v.
  function chain(children: PolicyNode[], vec: bigint[]): void {
    if (children.length === 1) return label(children[0], vec);
    const base = pad(vec, cols);
    const left = [...base, 1n];
    const right = [...Array<bigint>(cols).fill(0n), -1n];
    cols += 1;
    label(children[0], left);
    chain(children.slice(1), right);
  }

  label(tree, [1n]);
  return { rows: rows.map((r) => pad(r, cols)), attrs, cols };
}

/**
 * Tìm hệ số c_i sao cho Σ c_i · rows[i] = (1,0,...,0) (mod R) trên tập hàng `idx`.
 * Trả về Map(chỉ số hàng -> hệ số) hoặc null nếu tập hàng không thoả policy.
 */
export function reconstruction(l: Lsss, idx: number[]): Map<number, bigint> | null {
  const m = idx.length;
  if (m === 0) return null;
  // Hệ n phương trình, m ẩn: ma trận M[col][i] = rows[idx[i]][col], vế phải e1. Khử Gauss mod R.
  const M: bigint[][] = [];
  for (let c = 0; c < l.cols; c++) {
    M.push([...idx.map((i) => mod(l.rows[i][c])), c === 0 ? 1n : 0n]);
  }
  const pivotCol: number[] = [];
  let r = 0;
  for (let c = 0; c < m && r < M.length; c++) {
    let p = r;
    while (p < M.length && M[p][c] === 0n) p++;
    if (p === M.length) continue;
    [M[r], M[p]] = [M[p], M[r]];
    const inv = Fr.inv(M[r][c]);
    M[r] = M[r].map((v) => (v * inv) % R);
    for (let k = 0; k < M.length; k++) {
      if (k === r || M[k][c] === 0n) continue;
      const f = M[k][c];
      M[k] = M[k].map((v, j) => mod(v - f * M[r][j]));
    }
    pivotCol.push(c);
    r++;
  }
  for (let k = r; k < M.length; k++) if (M[k][m] !== 0n) return null; // vô nghiệm
  const out = new Map<number, bigint>();
  pivotCol.forEach((c, row) => out.set(idx[c], M[row][m]));
  return out;
}
