// CỔNG DUY NHẤT của phần bảo mật (SDK chạy trong trình duyệt/Electron). Ứng dụng chỉ được import từ file này.
// Không export gì thuộc Node (phần cứng, nút cấp khoá, kho lưu trữ) - các phần đó là dịch vụ/tiến trình chính, xem security/README.md.

// Ứng dụng nói chuyện với bảo mật qua MedClient: saveRecord / openRecord / breakGlass ... Khoá, policy, epoch, bọc lại khoá là việc của SDK.
export { MedClient, type BytFacility, type BytRow, type ClientState, type NodeRef, type OpenResult, type RecordRow } from './client/medclient.js';

// Biên nhận liên thông Bộ Y tế (cổng mô phỏng ký Ed25519).
export { verifyReceipt, type Receipt } from './byt/receipt.js';

// Tra cứu của phụ huynh (nhập CCCD học sinh, không cần tài khoản).
export { fetchForParent, parentVersion, parentIdxOf, normId, normDob, type ParentItem } from './client/parent.js';

// Khoá thiết bị + kho khoá (passphrase + khoá thiết bị).
export {
  loadOrCreateDeviceKeys, openVault, sealVault, MemoryKeyStore,
  type DeviceKeys, type KeyStore, type SealedVault,
} from './client/device.js';

// Policy tự sinh theo hồ sơ (bản đồ "ai được đọc loại dữ liệu nào").
export { policyBranches, policyFor, isStale, SECTION_TYPES, type RecordProfile, type RecordType } from './client/policy.js';
