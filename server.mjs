import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {api} from './api.mjs';
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://'+(req.headers.host||'localhost:3000'));
  if(url.pathname.startsWith('/api/')) {
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4096){res.writeHead(413);res.end('Request too large');return;}chunks.push(c);}
   const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)})});
   const response=await api(request,{NEA_ADAPTER_TOKEN:process.env.NEA_ADAPTER_TOKEN});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  if(url.pathname!=='/'){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(html);
 } catch {res.writeHead(500);res.end('Unexpected server error');}
});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('NEA Readings running on http://localhost:'+(process.env.PORT||3000)));
