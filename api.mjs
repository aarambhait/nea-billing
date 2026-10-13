import {SOURCE,branches,upstream,lookup,validate} from './adapter.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function api(request) {
 const path=new URL(request.url).pathname;
 try {
  if(path==='/api/branches' && request.method==='GET') return json({branches:branches(await upstream(SOURCE)),source:SOURCE});
  if(path==='/api/readings' && request.method==='POST') {
   const origin=request.headers.get('Origin');
   if(origin && origin!==new URL(request.url).origin) return json({error:'Cross-origin requests are not allowed.'},403);
   if(Number(request.headers.get('content-length'))>4096) return json({error:'Request too large.'},413);
   const raw=await request.text();
   if(raw.length>4096) return json({error:'Request too large.'},413);
   let input;try { input=validate(JSON.parse(raw)); } catch(e) { return json({error:e.message},400); }
   return json(await lookup(input));
  }
  return json({error:'Unknown endpoint or unsupported method.'},404);
 } catch(e) {return json({error:e.name==='TimeoutError'?'NEA is taking too long to respond. Please try again.':e.message},502);}
}
