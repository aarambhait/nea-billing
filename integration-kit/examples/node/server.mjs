import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {api} from '../../api.mjs';

const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const port=Number(process.env.PORT||3000);
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://'+(req.headers.host||'localhost:'+port));
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];let size=0;
      for await(const chunk of req) {
        size+=chunk.length;
        if(size>4096) {
          res.writeHead(413,{'Content-Type':'application/json','Cache-Control':'no-store'});
          res.end(JSON.stringify({error:'Request too large.'}));return;
        }
        chunks.push(chunk);
      }
      const request=new Request(url,{method:req.method,headers:req.headers,
        ...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)})});
      const response=await api(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(await response.text());return;
    }
    if(url.pathname!=='/' || !['GET','HEAD'].includes(req.method)) {
      res.writeHead(404);res.end('Not found');return;
    }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?'':html);
  } catch {
    res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'Unexpected server error.'}));
  }
});
server.listen(port,'127.0.0.1',()=>console.log('NEA demo: http://localhost:'+port));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
