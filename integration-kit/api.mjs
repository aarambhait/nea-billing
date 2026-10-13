import {SOURCE,branches,upstream,lookup,validate} from './adapter.mjs';
import {importBills} from './statement.mjs';
import {apiSpecification} from './openapi.mjs';
import {API_DOCS_HTML} from './documentation.mjs';

const API_PREFIX='/api/v1/';
const MAX_BODY_BYTES=4096;
const PUBLIC_CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Expose-Headers':'Retry-After, X-Request-ID','Access-Control-Max-Age':'86400'};
class InputError extends Error {constructor(message,status=400,code='INVALID_REQUEST'){super(message);this.status=status;this.code=code;}}
async function requestJson(request){
 if(Number(request.headers.get('content-length'))>MAX_BODY_BYTES)throw new InputError('Request too large.',413,'REQUEST_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)throw new InputError('A JSON request body is required.');
 const chunks=[];let size=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();throw new InputError('Request too large.',413,'REQUEST_TOO_LARGE');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new InputError('Provide valid JSON.');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new InputError('Provide a JSON object with consumerId, scNo, branch, from and to.');
 try{return validate(body);}catch(error){throw new InputError(error.message);}
}
export async function api(request,env={}){
 const path=new URL(request.url).pathname;
 const isPublic=path.startsWith(API_PREFIX)||path==='/api/v1';
 const requestId=isPublic?crypto.randomUUID():null;
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(isPublic?{...PUBLIC_CORS,'X-Request-ID':requestId}:{})};
 const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...extra}});
 const fail=(message,status,code,extra={})=>json({error:message,...(isPublic?{code,requestId}:{})},status,extra);
 const routes={'/api/v1/branches':'GET','/api/v1/readings':'POST','/api/v1/health':'GET','/api/v1/openapi.json':'GET'};
 if(path==='/api/docs'){
  if(request.method!=='GET')return fail('Method not allowed.',405,'METHOD_NOT_ALLOWED',{Allow:'GET'});
  return new Response(API_DOCS_HTML,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
 }
 if(isPublic){
  if(!routes[path])return fail('Unknown API endpoint.',404,'NOT_FOUND');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,Allow:routes[path]+', OPTIONS'}});
  if(request.method!==routes[path])return fail('Method not allowed.',405,'METHOD_NOT_ALLOWED',{Allow:routes[path]+', OPTIONS'});
  if(path==='/api/v1/openapi.json')return json(apiSpecification());
  if(path==='/api/v1/health')return json({status:'ok',apiVersion:'1',requestId,upstream:'NEA is checked only when a lookup is requested.'});
 }
 const branchRoute=path==='/api/branches'||path==='/api/v1/branches';
 const importRoute=path==='/api/import-bills';
 const readingRoute=importRoute||path==='/api/readings'||path==='/api/v1/readings';
 if(!(branchRoute&&request.method==='GET')&&!(readingRoute&&request.method==='POST'))return fail('Unknown endpoint or unsupported method.',404,'NOT_FOUND');
 if(!env.NEA_ADAPTER_TOKEN?.trim())return fail('Adapter authentication is not configured.',503,'AUTH_NOT_CONFIGURED');
 if(request.headers.get('Authorization')!==`Bearer ${env.NEA_ADAPTER_TOKEN}`)return fail('Authentication required.',401,'UNAUTHORIZED');
 if(!isPublic&&readingRoute){const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return fail('Cross-origin requests are not allowed.',403,'FORBIDDEN');}
 if(isPublic&&readingRoute&&request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return fail('Use Content-Type: application/json.',415,'UNSUPPORTED_MEDIA_TYPE');
 try {
  // Cloudflare supplies this header; callers cannot choose a trusted identity key.
  if(env.API_RATE_LIMITER){
   let allowed;try{allowed=await env.API_RATE_LIMITER.limit({key:'nea-billing:client:'+(request.headers.get('CF-Connecting-IP')||'unknown')});}
   catch{return fail('Request limiting is temporarily unavailable.',503,'RATE_LIMITER_UNAVAILABLE');}
   if(!allowed.success)return fail('Too many NEA requests. Retry in 60 seconds.',429,'RATE_LIMITED',{'Retry-After':'60'});
  }else if(env.REQUIRE_API_RATE_LIMIT==='true')return fail('Request limiting is not configured.',503,'RATE_LIMITER_UNAVAILABLE');
  if(branchRoute){const data={branches:branches(await upstream(SOURCE)),source:SOURCE};return json({...data,...(isPublic?{apiVersion:'1',requestId}:{})});}
  const input=await requestJson(request);
  const data=await lookup(input);
  return json(importRoute?importBills(data):{...data,...(isPublic?{apiVersion:'1',requestId}:{})});
 }catch(error){
  if(error instanceof InputError)return fail(error.message,error.status,error.code);
  return fail(error.name==='TimeoutError'?'NEA is taking too long to respond. Please try again.':error.message,502,'NEA_LOOKUP_FAILED');
 }
}
