// Optional example: npm install express before running this file.
import express from 'express';
import {SOURCE,branches,upstream,validate,lookup} from '../../adapter.mjs';
const app=express();
app.use(express.json({limit:'4kb'}));
// Add your project's authentication/authorization middleware before these routes.
app.get('/api/branches',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try { res.json({branches:branches(await upstream(SOURCE)),source:SOURCE}); }
  catch(error) { res.status(502).json({error:error.message}); }
});
app.post('/api/readings',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  let input;
  try {input=validate(req.body);}
  catch(error) {return res.status(400).json({error:error.message});}
  try {res.json(await lookup(input));}
  catch(error) {res.status(502).json({error:error.message});}
});
app.use((error,req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(error.type==='entity.too.large')return res.status(413).json({error:'Request too large.'});
  if(error.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON.'});
  res.status(500).json({error:'Unexpected server error.'});
});
app.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('NEA Express example running on localhost'));
