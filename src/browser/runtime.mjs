import { z } from 'zod';
import { BrowserStore } from './store.mjs';
import { Engine } from '../../server/engine.mjs';
import { Provider } from '../../server/provider.mjs';
import { IllustrationQueue } from '../../server/illustration-queue.mjs';
import { registerRoutes } from '../../server/routes.mjs';

let ready;
export function runtime() { return ready ||= initialize(); }
async function initialize() {
  if (!navigator.locks) throw new Error('请使用支持网站存储锁的新版 Chrome、Edge、Firefox 或 Safari。');
  // One writer per application. Refresh releases the old page's lock automatically.
  await new Promise((resolve,reject)=>{
    navigator.locks.request('storymode:'+location.pathname,{ifAvailable:true},lock=>{
      if(!lock){reject(new Error('故事模拟器已在另一个标签页打开，请关闭该标签页后刷新。'));return;}
      resolve();return new Promise(()=>{});
    }).catch(reject);
  });
  const store=await BrowserStore.open(), engine=new Engine(store);
  const directFetch=async(url,options)=>{
    try{return await fetch(url,options);}catch(e){if(options?.signal?.aborted)throw e;throw new Error('浏览器无法连接模型：请使用 HTTPS 接口并允许本页面跨域访问（CORS）。');}
  };
  const provider=new Provider(directFetch);engine.provider=provider;
  const imagery=new IllustrationQueue(store,provider,'',(id,event)=>engine.emit(id,event),{read:image=>store.readImage(image),write:(id,target,result)=>store.writeImage(id,target,result)});
  engine.on('chapterCommitted',({id,number})=>{if(store.story(id)?.autoImages!==false)imagery.enqueue(id,String(number));});
  engine.on('setupReady',id=>{if(Object.values(store.story(id)?.protagonist||{}).some(Boolean))imagery.enqueue(id,'portrait');});
  store.onError=()=>{void engine.shutdown();void imagery.shutdown();};
  const routes=[],storyLocks=new Set();
  const router=Object.fromEntries(['get','post'].map(method=>[method,(path,...args)=>{
    const keys=[];const pattern=path.replace(/:([a-zA-Z]+)/g,(_,key)=>{keys.push(key);return '([^/]+)';});
    routes.push({method:method.toUpperCase(),regex:new RegExp('^'+pattern+'$'),keys,handler:args.at(-1)});
  }]));
  registerRoutes(router,{store,engine,provider,imagery,storyLocks});
  window.addEventListener('beforeunload',event=>{if(engine.jobs.size||imagery.active||store.pending.size){event.preventDefault();event.returnValue='';}});
  return {
    engine,store,
    async request(path,body) {
      const method=body===undefined?'GET':'POST',url='/api'+path;
      const route=routes.find(r=>r.method===method&&r.regex.test(url));if(!route)throw new Error('操作不存在');
      const match=url.match(route.regex),params=Object.fromEntries(route.keys.map((k,i)=>[k,decodeURIComponent(match[i+1])]));
      if(method==='POST'&&storyLocks.has(params.id))throw new Error('模拟正在处理，请稍后再试');
      if(method==='POST'&&store.error)throw store.error;
      let sent;const headers={};const reply={type(type){headers['Content-Type']=type;return this;},header(k,v){headers[k]=v;return this;},send(value){sent=value;return value;}};
      try{
        const result=await route.handler({params,body},reply);
        if(method==='POST')await store.flush();
        return {data:store.publicImages(sent??result),headers};
      }catch(e){if(e instanceof z.ZodError)throw new Error(e.issues.map(i=>i.path.join('.')+': '+i.message).join('；'));throw e;}
    }
  };
}
