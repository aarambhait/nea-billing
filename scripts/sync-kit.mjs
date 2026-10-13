// Root modules are the source of truth. Copies them into integration-kit/, regenerates the
// README source appendix and a deterministic ZIP. With --check, fails instead of writing.
import {readFile,writeFile} from 'node:fs/promises';
import {crc32} from 'node:zlib';
const root=new URL('../',import.meta.url),kit=new URL('integration-kit/',root);
const check=process.argv.includes('--check');
const copies={'adapter.mjs':'adapter.mjs','statement.mjs':'statement.mjs','api.mjs':'api.mjs','openapi.mjs':'openapi.mjs','documentation.mjs':'documentation.mjs','tests.mjs':'tests.mjs','index.html':'examples/node/index.html'};
const appendix=['package.json','adapter.mjs','statement.mjs','api.mjs','openapi.mjs','documentation.mjs','worker.mjs','examples/frontend-client.mjs','examples/node/server.mjs','examples/node/index.html','examples/nextjs/app/api/readings/route.js','examples/nextjs/app/api/branches/route.js','examples/nextjs/app/api/v1/[...segments]/route.js','examples/nextjs/app/api/docs/route.js','examples/express/server.mjs','scripts/live-check.mjs','tests.mjs'];
const fence={json:'json',html:'html'};
const outputs=new Map();
for(const [from,to] of Object.entries(copies))outputs.set(to,await readFile(new URL(from,root)));
const kitFile=async path=>outputs.get(path)??await readFile(new URL(path,kit));

const readme=(await readFile(new URL('README.md',kit),'utf8')).split('\n## Source: ')[0];
let sources='';
for(const path of appendix)sources+=`\n## Source: ${path}\n\n\`\`\`${fence[path.split('.').pop()]??'javascript'}\n${String(await kitFile(path)).trimEnd()}\n\`\`\`\n`;
outputs.set('README.md',Buffer.from(readme+sources));

// Fixed timestamps and uncompressed ZIP entries keep bytes identical across Node/zlib versions.
// Deflate output is valid but can vary between runtimes, causing false sync failures in CI.
function zip(entries){
 const local=[],central=[];let offset=0;const time=0,date=(2026-1980)<<9|1<<5|1;
 for(const [name,data] of entries){
  const file=Buffer.from(name),packed=data,crc=crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0,8);header.writeUInt16LE(time,10);header.writeUInt16LE(date,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(file.length,26);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);header.copy(entry,8,6,28);entry.writeUInt32LE(0o100644<<16>>>0,38);entry.writeUInt32LE(offset,42);
  local.push(header,file,packed);central.push(entry,file);offset+=30+file.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}
const archived=['README.md',...appendix].sort();
const entries=[];for(const path of archived)entries.push(['nea-integration-kit/'+path,await kitFile(path)]);
const targets=[...[...outputs].map(([path,data])=>[new URL(path,kit),data]),[new URL('downloads/nea-integration-kit.zip',root),zip(entries)]];

const stale=[];
for(const [url,data] of targets){
 const current=await readFile(url).catch(()=>null);
 if(current&&current.equals(data))continue;
 stale.push(url.pathname.slice(root.pathname.length));
 if(!check)await writeFile(url,data);
}
if(check&&stale.length){console.error('Integration kit is out of sync. Run npm run sync.\n'+stale.map(s=>'  '+s).join('\n'));process.exit(1);}
console.log(stale.length?'Updated: '+stale.join(', '):'Integration kit is in sync.');
