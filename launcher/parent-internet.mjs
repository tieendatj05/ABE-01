// Mở app iPhone khi KSK đang chạy, dùng lại cổng phụ huynh nếu đã sẵn sàng.
import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ready=async()=>{try{return(await fetch('http://127.0.0.1:8096/api/public/ping',{signal:AbortSignal.timeout(2000)})).ok}catch{return false}};
if(!await ready()){
  const gateway=spawn(process.execPath,[resolve(root,'launcher/parent-public.mjs')],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});gateway.unref();
  for(let i=0;i<20&&!await ready();i++) await new Promise(r=>setTimeout(r,250));
}
if(!await ready()){console.error('Không mở được cổng phụ huynh. Hãy mở KSK rồi thử lại.');process.exit(1)}
const tunnel=spawn(process.execPath,[resolve(root,'launcher/public-tunnel.mjs')],{cwd:root,windowsHide:true,stdio:'inherit'});
tunnel.on('exit',code=>process.exit(code??1));
