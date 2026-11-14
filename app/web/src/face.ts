// NHẬN DẠNG KHUÔN MẶT CHẠY NGAY TRÊN MÁY NGƯỜI NHẬP (mô hình BlazeFace + FaceMesh nằm trong app, thư mục models/; KHÔNG gọi mạng, ảnh chưa mã hoá không rời máy).
// Kết quả chỉ là ĐỀ XUẤT khoanh vùng Mắt / Tai-Mũi-Họng / Răng-Hàm-Mặt để người nhập xem lại và sửa; không phải chẩn đoán.
// Thư viện và mô hình tải theo nhu cầu (lần đầu dùng mới tải) để không làm nặng màn hình đăng nhập.
import { faceRegionsFromMesh, type Advice, type Rgba } from '../../../security/src/index.js';

interface FaceResult { face: { mesh?: number[][]; score?: number }[] }
interface HumanLike { load(): Promise<void>; detect(input: HTMLCanvasElement): Promise<FaceResult> }
type HumanCtor = new (cfg: Record<string, unknown>) => HumanLike;

const MAX_SIDE = 800;           // thu nhỏ trước khi nhận dạng để nhanh; toạ độ được nhân lại về ảnh gốc
const MIN_SCORE = 0.5;
const instances = new Map<string, Promise<HumanLike>>();

function create(backend: 'webgl' | 'cpu'): Promise<HumanLike> {
  let p = instances.get(backend);
  if (!p) {
    p = (async () => {
      const mod = (await import('@vladmandic/human')) as unknown as { default: HumanCtor };
      const h = new mod.default({
        backend, modelBasePath: new URL('models/', document.baseURI).href, debug: false, async: false, cacheSensitivity: 0, filter: { enabled: false },
        face: { enabled: true, detector: { rotation: false, maxDetected: 1, minConfidence: 0.3 }, mesh: { enabled: true }, iris: { enabled: false }, description: { enabled: false }, emotion: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } },
        body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false },
      });
      await h.load();
      return h;
    })();
    p.catch(() => instances.delete(backend));
    instances.set(backend, p);
  }
  return p;
}

function toCanvas(px: Rgba): { cv: HTMLCanvasElement; k: number } {
  const full = document.createElement('canvas'); full.width = px.w; full.height = px.h;
  full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
  const k = Math.min(1, MAX_SIDE / Math.max(px.w, px.h));
  if (k === 1) return { cv: full, k };
  const cv = document.createElement('canvas'); cv.width = Math.round(px.w * k); cv.height = Math.round(px.h * k);
  cv.getContext('2d')!.drawImage(full, 0, 0, cv.width, cv.height);
  return { cv, k };
}

/** Tìm khuôn mặt lớn nhất trong ảnh; có thì trả về Advice với 5 vùng (mắt, mũi, hai tai, miệng+hàm), không thì null. */
export async function adviseFace(px: Rgba): Promise<Advice | null> {
  const { cv, k } = toCanvas(px);
  let res: FaceResult;
  try { res = await (await create('webgl')).detect(cv); }
  catch { res = await (await create('cpu')).detect(cv); }          // máy không có WebGL: chạy bằng CPU (chậm hơn)
  const f = res.face[0];
  if (!f?.mesh || (f.score ?? 0) < MIN_SCORE) return null;
  const mesh = f.mesh.map((p) => [p[0] / k, p[1] / k, p[2] ?? 0]);
  const regions = faceRegionsFromMesh(mesh, px.w, px.h);
  if (regions.length < 5) return null;
  return {
    decision: 'DE_XUAT', source: 'FACE', regions, needsAck: true, contentRatio: 1,
    notes: [
      `Nhận ra khuôn mặt người (độ tin cậy ${Math.round((f.score ?? 0) * 100)}%). Đã tự chia ${regions.length} vùng: mắt → khoa Mắt; mũi và hai tai → Tai-Mũi-Họng; miệng, răng, hàm → Răng-Hàm-Mặt.`,
      'Đây chỉ là đề xuất bằng nhận dạng khuôn mặt: hãy xem các khung trên ảnh và kéo/xóa/gán lại khoa nếu cần. Phần ngoài các khung (tóc, trán, cổ, nền…) chỉ có trong ảnh gốc của người nhập.',
    ],
    warnings: ['Ảnh khuôn mặt người có thể là dữ liệu sinh trắc học (nhóm dữ liệu cá nhân nhạy cảm). Chỉ lưu ảnh của người đã đồng ý bằng văn bản (trẻ dưới 16 tuổi: cha mẹ/người giám hộ), và kiểm tra ảnh không in kèm tên hay mã bệnh nhân.'],
  };
}
