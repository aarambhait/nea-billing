// Emits real ES modules for Wrangler to bundle, so module scopes and imports stay intact.
import {readFile,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
const modules=['adapter.mjs','statement.mjs','api.mjs','openapi.mjs','documentation.mjs'];
await rm('dist/server',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
for(const file of modules)await copyFile(file,'dist/server/'+file);
await writeFile('dist/server/html.mjs','export const HTML='+JSON.stringify(await readFile('index.html','utf8'))+';\n');
await writeFile('dist/server/index.js',`import {api} from './api.mjs';
import {HTML} from './html.mjs';
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path.startsWith('/api/'))return api(request,env);
 if(path!=='/')return new Response('Not found',{status:404});
 return new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}};
`);
console.log('Built Worker: dist/server/index.js');
