/// <reference types="vite/client" />
declare module '*.css';
declare const __EDITION__: string;
declare module 'qrcode' { const QRCode: { toDataURL(text: string, opts?: Record<string, unknown>): Promise<string> }; export default QRCode; }
