import fs from 'node:fs';
let s = fs.readFileSync('app/test-ui/desktop-check.mjs', 'utf8');
const a = "console.log(`--- không thấy \"${label}\":\n` + (await text(page)).slice(0, 600));";
if (!s.includes(a)) throw new Error('no');
s = s.replace(a, () => "console.log(`--- không thấy \"${label}\":\n` + (await page.evaluate(() => document.querySelector('.content')?.innerHTML.slice(0, 2500))));");
fs.writeFileSync('app/test-ui/desktop-check.mjs', s);
