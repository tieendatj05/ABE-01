// Từ 468 điểm mốc khuôn mặt (FaceMesh) -> các vùng ảnh theo chuyên khoa: MẮT (mắt + lông mày), TAI-MŨI-HỌNG (mũi, hai tai), RĂNG-HÀM-MẶT (miệng + hàm).
// Hàm thuần (không phụ thuộc trình duyệt) để kiểm thử được; việc chạy mô hình nhận dạng nằm ở app/web/src/face.ts và CHẠY TRÊN MÁY NGƯỜI NHẬP (ảnh chưa mã hoá không rời máy).
// Chỉ số điểm mốc theo bản đồ 468 điểm của MediaPipe FaceMesh. Đây là ĐỀ XUẤT khoanh vùng để người nhập xem lại, không phải chẩn đoán.
import type { Rect } from './imaging.js';
import type { ProposedRegion } from './advisor.js';

export type Pt = readonly number[];                       // [x, y, (z)] theo điểm ảnh của ảnh đưa vào mô hình
export const FACE_MESH_POINTS = 468;

const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const LEFT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const RIGHT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const LEFT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const NOSE = [6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327, 129, 358, 49, 279, 48, 278, 64, 294, 219, 439];
const CHIN = 152, CHEEK_A = 234, CHEEK_B = 454, FOREHEAD = 10;

interface Box { x0: number; y0: number; x1: number; y1: number }
const bbox = (pts: Pt[]): Box => ({ x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) });

function toRect(b: Box, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.round(b.x0)), y = Math.max(0, Math.round(b.y0));
  const x1 = Math.min(w, Math.round(b.x1)), y1 = Math.min(h, Math.round(b.y1));
  return x1 - x >= 4 && y1 - y >= 4 ? { x, y, w: x1 - x, h: y1 - y } : null;
}

/** Trả về các vùng đề xuất (đã cắt trong khung ảnh w×h) hoặc [] nếu bộ điểm mốc không hợp lệ. Các vùng không chồng lên nhau theo chiều dọc: mắt < mũi < miệng. */
export function faceRegionsFromMesh(mesh: readonly Pt[], w: number, h: number): ProposedRegion[] {
  if (mesh.length < FACE_MESH_POINTS || mesh.slice(0, FACE_MESH_POINTS).some((p) => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return [];
  const P = (idx: number[]) => idx.map((i) => mesh[i]);
  const faceW = Math.abs(mesh[CHEEK_B][0] - mesh[CHEEK_A][0]), faceH = Math.abs(mesh[CHIN][1] - mesh[FOREHEAD][1]);
  if (!(faceW > 8 && faceH > 8)) return [];
  const eyes = bbox([...P(RIGHT_EYE), ...P(LEFT_EYE), ...P(RIGHT_BROW), ...P(LEFT_BROW)]), nose = bbox(P(NOSE)), lips = bbox(P(LIPS));
  const mat: Box = { x0: eyes.x0 - 0.04 * faceW, y0: eyes.y0 - 0.03 * faceH, x1: eyes.x1 + 0.04 * faceW, y1: eyes.y1 + 0.04 * faceH };
  const mui: Box = { x0: nose.x0 - 0.03 * faceW, y0: mat.y1, x1: nose.x1 + 0.03 * faceW, y1: nose.y1 + 0.02 * faceH };
  const mieng: Box = { x0: lips.x0 - 0.12 * faceW, y0: mui.y1, x1: lips.x1 + 0.12 * faceW, y1: mesh[CHIN][1] + 0.02 * faceH };
  const earTop = (eyes.y0 + eyes.y1) / 2, earBot = lips.y0;
  const tai1: Box = { x0: Math.min(mesh[CHEEK_A][0], mesh[CHEEK_B][0]) - 0.12 * faceW, y0: earTop, x1: Math.min(mesh[CHEEK_A][0], mesh[CHEEK_B][0]) + 0.03 * faceW, y1: earBot };
  const tai2: Box = { x0: Math.max(mesh[CHEEK_A][0], mesh[CHEEK_B][0]) - 0.03 * faceW, y0: earTop, x1: Math.max(mesh[CHEEK_A][0], mesh[CHEEK_B][0]) + 0.12 * faceW, y1: earBot };
  const out: ProposedRegion[] = [];
  const add = (b: Box, khoas: string[], label: string, basis: string) => { const r = toRect(b, w, h); if (r) out.push({ rect: r, khoas, label, basis }); };
  add(mat, ['Mat'], 'vung-mat', 'mắt và lông mày (nhận dạng khuôn mặt)');
  add(mui, ['TMH'], 'vung-mui', 'mũi (nhận dạng khuôn mặt)');
  add(tai1, ['TMH'], 'vung-tai-1', 'tai bên trái ảnh (ước lượng từ đường viền mặt)');
  add(tai2, ['TMH'], 'vung-tai-2', 'tai bên phải ảnh (ước lượng từ đường viền mặt)');
  add(mieng, ['RHM'], 'vung-mieng-ham', 'miệng, răng và hàm (nhận dạng khuôn mặt)');
  return out;
}
