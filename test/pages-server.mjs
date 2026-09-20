import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { startMock } from './mock-provider.mjs';
await startMock({port:3213,delay:15,cors:true,extraModels:true});
const root=resolve('dist-pages');
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const path=url.pathname.replace(/^\/StoryMode\//,'/');
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(root+ '/'.replace('/',process.platform==='win32'?'\\':'/'))){res.writeHead(404);res.end();return;}
  try { const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(data); }
  catch {res.writeHead(404);res.end();}
}).listen(3214,'127.0.0.1');
