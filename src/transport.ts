export const browserMode = import.meta.env.VITE_RUNTIME === 'browser';
const getRuntime = async () => (await import('./browser/runtime.mjs')).runtime();
export async function api<T = unknown>(path:string,body?:unknown):Promise<T> {
  if(browserMode)return (await (await getRuntime()).request(path,body)).data as T;
  const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-StoryMode':'1'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.error||'请求失败'),{details:value.details});return value;
}
type Source = {onopen:(()=>void)|null;onerror:(()=>void)|null;onmessage:((event:{data:string})=>void)|null;close:()=>void};
export function storyEvents(id:string):Source {
  if(!browserMode)return new EventSource(`/api/stories/${id}/events`) as unknown as Source;
  let closed=false,unsubscribe=()=>{};
  const source:Source={onopen:null,onerror:null,onmessage:null,close(){closed=true;unsubscribe();}};
  void getRuntime().then(({engine})=>{
    if(closed)return;const send=(event:unknown)=>source.onmessage?.({data:JSON.stringify(event)});
    engine.on(id,send);unsubscribe=()=>engine.off(id,send);source.onopen?.();send({type:'state'});
  }).catch(()=>{if(!closed)source.onerror?.();});return source;
}
export async function exportFile(path:string) {
  if(!browserMode){location.href='/api'+path;return;}
  const {data,headers}=await(await getRuntime()).request(path);
  const blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type:headers['Content-Type']||'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;
  link.download=headers['Content-Disposition']?.match(/filename="([^"]+)"/)?.[1]||'storymode-export.json';
  link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
