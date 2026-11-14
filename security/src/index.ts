// CỔNG DUY NHẤT của phần bảo mật (SDK chạy trong trình duyệt/Electron). Ứng dụng chỉ được import từ file này.
// Không export gì thuộc Node (phần cứng, nút cấp khoá, kho lưu trữ) - các phần đó là dịch vụ/tiến trình chính, xem security/README.md.

// Ứng dụng nói chuyện với bảo mật qua MedClient: saveRecord / openRecord / breakGlass ... Khoá, policy, epoch, bọc lại khoá là việc của SDK.
export { MedClient, BusinessHoursError, SessionExpiredError, type BytFacility, type BytRow, type ClientState, type NodeRef, type OpenResult, type RecordRow } from './client/medclient.js';

// Biên nhận liên thông Bộ Y tế (cổng mô phỏng ký Ed25519).
export { verifyReceipt, type Receipt } from './byt/receipt.js';

// Tra cứu của phụ huynh (nhập CCCD học sinh, không cần tài khoản).
export {
  fetchForParent, parentVersion, parentIdxOf, normId, normName, validName, normDob, parentCreds, exportCreds, importCreds, fetchWithCreds, versionWithCreds,
  type ParentItem, type ParentCreds,
} from './client/parent.js';

// Khoá thiết bị + kho khoá (passphrase + khoá thiết bị).
export {
  loadOrCreateDeviceKeys, openVault, sealVault, MemoryKeyStore,
  type DeviceKeys, type KeyStore, type SealedVault,
} from './client/device.js';

// Policy tự sinh theo hồ sơ (bản đồ "ai được đọc loại dữ liệu nào").
export { policyBranches, policyFor, isStale, SECTION_TYPES, type RecordProfile, type RecordType } from './client/policy.js';

// Đăng nhập bằng TÀI KHOẢN (email + mật khẩu): kho khoá ký cá nhân theo người dùng trên máy + lỗi cần xử lý ở giao diện.
export { MemoryDeviceKeyStore, type DeviceKeyStore, type LocalDevice } from './research/keys.js';
export { PasswordChangeRequiredError, ApiError } from './research/client.js';

// Mô hình tác giả + ảnh theo vùng (chế độ tài khoản)
export { appBranches, appPolicyString, khoasForType, normalizeKhoa, normalizeKhoaList, type KhoaCatalogItem, type PolicyMatrix } from './client/app-policy.js';
export { saveImage, listImages, openImage, cropRgba, blankRgba, pasteRgba, packPixels, unpackPixels, validateRect, MAX_ORIGINAL_BYTES, MAX_REGIONS, type ImageView, type Rect, type Rgba, type SaveImageInput, type SavedImage, type SeriesRef } from './client/imaging.js';
export { parseDicom, dicomToRgba, sortSlices, looksLikeDicom, DicomUnsupportedError, type DicomMeta, type DicomSlice } from './client/dicom.js';
export { adviseImage, contentStats, type Advice, type ProposedRegion, type AdvisorDecision } from './client/advisor.js';
export { faceRegionsFromMesh, FACE_MESH_POINTS } from './client/face-regions.js';
