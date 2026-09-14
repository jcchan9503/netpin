/** DEVELOPMENT ONLY. Isolated synthetic database. Never serves real user data or probes. */
import http from 'node:http';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Store} from '../app/core/store.mjs';
import {Service} from '../app/core/service.mjs';
import {seedDemo} from '../app/core/demo.mjs';
const dir=mkdtempSync(path.join(tmpdir(),'netpin-preview-')), store=new Store(path.join(dir,'demo.sqlite'));
seedDemo(store);
const secrets=new Map();
const service=new Service(store,{demo:true,secrets:{async seal(c){const ref=randomBytes(16).toString('hex');secrets.set(ref,c);return {storage:'session',ref};},async open(e){if(!secrets.has(e.ref))throw Error('No session credential');return secrets.get(e.ref);}}});
const root=fileURLToPath(new URL('../app/renderer/',import.meta.url)),token=randomBytes(32).toString('hex');
const port=Number(process.env.PORT||4173);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid preview port');
const origin=`http://127.0.0.1:${port}`;
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/states.css':'states.css'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  try{
    if(req.headers.host!==`127.0.0.1:${port}`)throw Error('Invalid Host');
    const pathname=new URL(req.url,origin).pathname;
    if(req.method==='GET'&&pathname==='/bridge.js'){
      res.setHeader('Content-Type','text/javascript;charset=utf-8');
      return res.end(`window.netpin={async invoke(method,payload={}){const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json','X-NetPin-Token':'${token}'},body:JSON.stringify({method,payload})});const v=await r.json();if(v.error)throw Error(v.error);return v.result;}};`);
    }
    if(req.method==='GET'&&files[pathname]){
      const file=files[pathname];res.setHeader('Content-Type',file.endsWith('html')?'text/html;charset=utf-8':file.endsWith('css')?'text/css;charset=utf-8':'text/javascript;charset=utf-8');return res.end(readFileSync(path.join(root,file)));
    }
    if(req.method!=='POST'||pathname!=='/api'){res.writeHead(404);return res.end('Not found');}
    if(req.headers['x-netpin-token']!==token||req.headers.origin!==origin)throw Error('Invalid preview origin/token');
    let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>256000)throw Error('Request too large');chunks.push(chunk);}
    const {method,payload}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(method==='switchMode')throw Error('浏览器预览只有隔离示例空间；真实采集请启动 Electron 程序');
    const result=await service.invoke(method,payload);res.setHeader('Content-Type','application/json;charset=utf-8');res.end(JSON.stringify({result}));
  }catch(e){if(!res.headersSent){res.statusCode=400;res.setHeader('Content-Type','application/json;charset=utf-8');}res.end(JSON.stringify({error:e.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`NetPin synthetic preview: ${origin}`));
let closing=false;async function close(){if(closing)return;closing=true;server.close();await service.close();rmSync(dir,{recursive:true,force:true});process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
