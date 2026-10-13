// Optional local example: npm install express before running this file.
import express from 'express';
import {api} from '../../api.mjs';
const app=express();
app.use('/api',express.raw({type:()=>true,limit:'4kb'}),async(req,res)=>{
 try {
  const url=new URL(req.originalUrl,req.protocol+'://'+req.get('host'));
  const request=new Request(url,{method:req.method,headers:req.headers,
   ...(['GET','HEAD'].includes(req.method)?{}:{body:req.body})});
  const response=await api(request);
  res.status(response.status).set(Object.fromEntries(response.headers)).send(await response.text());
 }catch{res.status(500).json({error:'Unexpected server error.'});}
});
app.use((error,req,res,next)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.originalUrl.startsWith('/api/v1/'))res.setHeader('Access-Control-Allow-Origin','*');
 if(error.type==='entity.too.large')return res.status(413).json({error:'Request too large.'});
 res.status(500).json({error:'Unexpected server error.'});
});
app.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('NEA Express example running on localhost'));
