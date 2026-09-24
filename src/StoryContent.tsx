import { formatProgressBlocks } from './progress-display';
import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
const purifier=DOMPurify(window);
purifier.addHook('uponSanitizeAttribute',(_node,attribute)=>{
  // Remove remote resource attributes before importing the fragment into this
  // document. Detached image elements can start loads before iframe CSP applies.
  if(attribute.attrName==='srcset' || (['src','poster','background'].includes(attribute.attrName) && !/^(?:data:image\/(?:png|jpeg|gif|webp);base64,|blob:)/i.test(attribute.attrValue)))attribute.keepAttr=false;
});

export function hasDisplayHtml(text:string) {
  return /<\/?(?:current_event|progress|style|script|div|span|details|summary|section|article|main|p|br|h[1-6]|table|ul|ol|li|blockquote|pre|b|strong|em|i|img)(?:\s[^<>]*|\s*\/?)>/i.test(text);
}

function displayDocument(text:string,fontSize:number,dark:boolean) {
  const source=text.trim().replace(/^```(?:html)?\s*\n([\s\S]*?)\n```$/i,'$1');
  const fragment=purifier.sanitize(formatProgressBlocks(source),{
    RETURN_DOM_FRAGMENT:true,FORCE_BODY:true,USE_PROFILES:{html:true},ADD_TAGS:['style'],
    FORBID_TAGS:['script','iframe','object','embed','link','meta','base','form','noscript'],
    FORBID_ATTR:['srcdoc','action','formaction','href','target','autofocus'],
  });
  // Template formatting whitespace should not turn into dozens of blank lines.
  // Meaningful text (and pre/code whitespace) keeps its original line breaks.
  const walker=document.createTreeWalker(fragment,NodeFilter.SHOW_TEXT),remove:Node[]=[];
  let node:Node|null;
  while((node=walker.nextNode())) if(!node.textContent?.trim() && /[\r\n]/.test(node.textContent||'') && !(node.parentElement?.closest('pre,code,style,textarea'))) remove.push(node);
  remove.forEach(n=>n.parentNode?.removeChild(n));
  const wrapper=document.createElement('div');wrapper.append(fragment);
  const size=Math.min(32,Math.max(12,fontSize));
  // The iframe is same-origin for sizing ONLY: scripts remain disabled by both
  // its sandbox (no allow-scripts) and CSP. Styles cannot reach the app or keys.
  const policy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;padding:0;background:transparent;min-height:0}body{color:${dark?'#d7dfce':'#344238'};font:${size}px/2.1 Georgia,"Noto Serif SC","Microsoft YaHei",serif;overflow-x:hidden}#story-display-root{display:flow-root;white-space:pre-wrap;overflow-wrap:anywhere;padding:4px 2px}*{box-sizing:border-box}img{max-width:100%;height:auto}summary{cursor:pointer}pre{white-space:pre-wrap}p{margin:0 0 1em}.sm-progress-card{margin:1em 0;padding:16px 20px;border:1px solid currentColor;border-radius:10px;background:rgba(128,145,116,.08);font:14px/1.8 "Microsoft YaHei",sans-serif;white-space:normal}.sm-progress-card summary{font-weight:700;font-size:16px}.sm-progress-card dl{margin:14px 0 0}.sm-progress-card dl>div{display:grid;grid-template-columns:minmax(70px,100px) minmax(0,1fr);gap:12px;padding:9px 0;border-top:1px solid rgba(128,145,116,.2)}.sm-progress-card dt{font-weight:600;opacity:.8}.sm-progress-card dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:480px){.sm-progress-card{padding:12px}.sm-progress-card dl>div{grid-template-columns:1fr;gap:3px}}</style></head><body><main id="story-display-root">${wrapper.innerHTML}</main><style>#story-display-root :where(div,section,article,details,pre,table){max-width:100%;min-width:0}#story-display-root{max-width:100%}</style></body></html>`;
}

function HtmlDisplay({text,fontSize,title}:{text:string;fontSize:number;title:string}) {
  const frame=useRef<HTMLIFrameElement>(null),cleanup=useRef<()=>void>(()=>{});
  const [height,setHeight]=useState(180),[dark,setDark]=useState(document.documentElement.dataset.theme==='dark');
  useEffect(()=>{const observer=new MutationObserver(()=>setDark(document.documentElement.dataset.theme==='dark'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
  useEffect(()=>()=>cleanup.current(),[]);
  const srcDoc=useMemo(()=>displayDocument(text,fontSize,dark),[text,fontSize,dark]);
  const loaded=()=>{
    cleanup.current();
    const doc=frame.current?.contentDocument,root=doc?.getElementById('story-display-root');if(!doc || !root)return;
    let disposed=false;
    const resize=()=>{if(!disposed && frame.current?.contentDocument===doc)setHeight(Math.max(40,Math.min(50000,Math.ceil(root.getBoundingClientRect().height)+8)));};
    const observer=new ResizeObserver(resize);observer.observe(root);doc.addEventListener('toggle',resize,true);
    void doc.fonts.ready.then(resize);resize();
    cleanup.current=()=>{disposed=true;observer.disconnect();doc.removeEventListener('toggle',resize,true);};
  };
  return <div className="story-html-display"><iframe ref={frame} title={title} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={srcDoc} onLoad={loaded} style={{height}}/>
    <details className="story-html-source"><summary>查看显示源码</summary><pre>{text}</pre></details>
  </div>;
}

export function StoryContent({text,fontSize=19,title='正文样式',paragraphs=true}:{text:string;fontSize?:number;title?:string;paragraphs?:boolean}) {
  return hasDisplayHtml(text)?<HtmlDisplay text={text} fontSize={fontSize} title={title}/>:paragraphs?<>{text.split(/\n+/).filter(Boolean).map((p,i)=><p key={i}>{p}</p>)}</>:<>{text}</>;
}
