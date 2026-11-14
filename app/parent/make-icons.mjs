// Sinh biểu tượng app (PWA + Android/iOS) từ logo khiên + chữ thập: node app/parent/make-icons.mjs
// Kết quả: icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png (180) trong app/parent/public, và icon-1024.png (nguồn cho Capacitor assets) trong app/mobile/resources.
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = resolve('app/parent/public');
const RES = resolve('app/mobile/resources');
mkdirSync(RES, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('Cần Edge hoặc Chrome để vẽ biểu tượng');

const svg = (size, { maskable = false, rounded = true } = {}) => {
  const r = maskable ? 0 : rounded ? 22 : 0;                     // maskable: nền tràn viền, hệ điều hành tự cắt hình
  const k = maskable ? 0.62 : 1;                                 // maskable: logo nằm trong vùng an toàn 80%
  const t = (96 - 96 * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fb7f2"/><stop offset=".55" stop-color="#0a6cc4"/><stop offset="1" stop-color="#0f9d9a"/></linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d7ecff"/></linearGradient>
  </defs>
  <rect width="96" height="96" rx="${r}" fill="url(#g)"/>
  <g transform="translate(${t} ${t}) scale(${k})">
    <path d="M48 16c8 6 17 8 26 8v22c0 17-11 28-26 34C33 74 22 63 22 46V24c9 0 18-2 26-8z" fill="url(#s)"/>
    <path d="M48 31v26M35 44h26" stroke="#0a6cc4" stroke-width="8" stroke-linecap="round"/>
  </g></svg>`;
};

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
const render = async (file, size, opt) => {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size, opt)}</body>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};
await render(`${OUT}/icon-192.png`, 192);
await render(`${OUT}/icon-512.png`, 512);
await render(`${OUT}/icon-maskable-512.png`, 512, { maskable: true });
await render(`${OUT}/apple-touch-icon.png`, 180, { rounded: false });   // iOS tự bo góc
await render(`${RES}/icon-1024.png`, 1024, { maskable: true });
await browser.close();
console.log('Đã tạo biểu tượng.');
