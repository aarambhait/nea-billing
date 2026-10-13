import {readFile,mkdir,writeFile} from 'node:fs/promises';
const statement=await readFile('statement.mjs','utf8');
const adapter=(await readFile('adapter.mjs','utf8')).replace(/^import[^\n]+\n/,'');
const api=(await readFile('api.mjs','utf8')).replace(/^import[^\n]+\n/,'').replace('export async function api','async function api');
const html=await readFile('index.html','utf8');
await mkdir('dist/server',{recursive:true});
const entry=statement+'\n'+adapter+'\n'+api+'\nconst HTML='+JSON.stringify(html)+';\nexport default {async fetch(request) {const path=new URL(request.url).pathname;if(path.startsWith("/api/"))return api(request);if(path!=="/")return new Response("Not found",{status:404});return new Response(HTML,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}};\n';
await writeFile('dist/server/index.js',entry);console.log('Built Worker: dist/server/index.js');
