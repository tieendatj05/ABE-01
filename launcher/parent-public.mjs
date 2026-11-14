// Cổng phụ huynh độc lập cho bản KSK đóng gói chưa mở cổng 8096.
// Chỉ chuyển tiếp ba GET công khai; không chuyển tiếp API nhân viên hoặc yêu cầu ghi.
import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist=resolve(root,'app/parent/dist');
if(!existsSync(resolve(dist,'index.html'))) throw new Error('Chưa build app phụ huynh');
const app=express();
app.disable('x-powered-by');
app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');next();});
for(const name of ['ping','parent-records','parent-version']) {
  app.get('/api/public/'+name,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    let suffix='';
    if(name!=='ping') {
      if(typeof req.query.parentIdx!=='string'||!/^[0-9a-f]{32}$/.test(req.query.parentIdx)) return void res.status(400).json({error:'parentIdx sai'});
      suffix='?parentIdx='+req.query.parentIdx;
    }
    try {
      const upstream=await fetch('http://127.0.0.1:8095/api/public/'+(name==='ping'?'parent-version?parentIdx=00000000000000000000000000000000':name+suffix),{redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!upstream.headers.get('content-type')?.includes('application/json')) throw new Error('Sai phản hồi máy chủ');
      if(name==='ping') return void res.status(upstream.ok?200:503).json({ok:upstream.ok,name:'KSK'});
      res.status(upstream.status).type('application/json').send(await upstream.text());
    } catch {res.status(503).json({error:'Máy chủ chưa sẵn sàng. Hãy mở KSK trên máy chủ.'});}
  });
}
app.use((req,res,next)=>{
  if(req.method!=='GET'||/^\/(api|byt)(\/|$)/i.test(req.path)) return void res.status(404).json({error:'not found'});
  next();
});
app.use(express.static(dist,{dotfiles:'deny',setHeaders:(res,file)=>{if(/(sw\.js|index\.html|manifest\.webmanifest)$/.test(file))res.setHeader('Cache-Control','no-cache');}}));
app.use((_req,res)=>res.status(404).json({error:'not found'}));
const server=app.listen(8096,'127.0.0.1',()=>console.log('Cổng phụ huynh: http://127.0.0.1:8096'));
server.on('error',(err)=>{console.error(err.message);process.exit(1);});

