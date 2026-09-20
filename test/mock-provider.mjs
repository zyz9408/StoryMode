import { createServer } from 'node:http';

export const setup = { title:'江陵未尽', kind:'穿越', era:'建安二十四年', location:'江陵城外', identity:'携带饮料的旅人', goal:'在有限物资下生存并观察历史变化', resources:'100箱，每箱24瓶，每瓶500毫升，共2400瓶；需要车辆运输，保质期12个月。', assumptions:'饮料不能再生；不会因赠送饮料自动获得官职；玩家只掌握普通历史知识。' };
export const world = { time:'建安二十四年秋', elapsedDays:0, characters:[{name:'旅人',location:'江陵',knowledge:'仅知当地传闻',motivation:'生存',appearance:'粗布短衣'}], relationships:['与商贩初识'], factions:['当地军政有既有秩序'], resources:[{id:'drink',name:'佳得乐',quantity:2400,unit:'瓶',note:'以车运输，保质期12个月'}], conflicts:['如何立足'] };
const dimensionNames = ['目标达成','关键决策','资源运用','现实可行性','长期影响','推演不确定性'];
export const endingEvidence = {
  protagonistDeath:'建安三十年，旅人年老病逝，临终将剩余财产交予家人。',
  keyPeopleFates:'当年同行的车夫先他而去，商贩则由女儿接手铺面，晚年安居乡里。',
  organizationFates:'商队在下一代经营失败后解散，货栈卖给乡人，原有成员各自谋生。',
  eraClosure:'又过数十年，割据政权结束，新朝接管郡县，这场乱世终于落幕。',
  posterity:'乡人记得他的援手，也怨他逐利；后世在这条推演历史中只留下地方商人的复杂评价。',
};
export function fixture(task, ctx, options = {}) {
  const ending = options.ending || 15;
  if(task.startsWith('生成模拟主题')) return {topics:Array.from({length:4},(_,i)=>({title:`有限资源的选择${i+1}`,event:`假如带着${i+1}箱现代工具回到古代，需要在有限物资下找到谋生方式。`,angle:'运输、信息与信任都有成本，不能凭物资获得无限权力。'}))};
  if(task.startsWith('解析玩家事件')) return {...setup,...(ctx.event?.includes('关羽')?{kind:'历史改写',identity:'以关羽等历史人物为主，玩家仅署名'}:{})};
  if(task.startsWith('根据已确认设定')) return { plannedChapters:options.initialPlanned||ending, outline:Array.from({length:options.initialPlanned||ending},(_,i)=>({number:i+1,title:`江陵记事${i+1}`,purpose:'产生新的行动与后果'})), decisionChapters:options.noDecisions?[]:[3,7,11], world:options.objectWorld?{...structuredClone(world),relationships:[{from:'旅人',to:'商贩',description:'初识'}],factions:[{name:'当地势力',status:'维持秩序'}]}:structuredClone(world) };
  if(task.startsWith('策划当前章')) return { title:`江陵记事${ctx.number}`, scenes:options.objectDescriptions?[{title:'抵达市集',actions:['清点货物','询价'],obstacle:{description:'车费不足'}},'遭遇阻碍',{description:'承担代价',cost:'交付一瓶饮料'}]:['抵达市集','遭遇阻碍','承担代价'], researchQuestion:ctx.number===2?'核实当时物资运输条件':'' };
  if(task.startsWith('审核重写章节')) return {passed:!options.failRewrite,issues:options.failRewrite?['重写改变了既有事实']:[],ending:ctx.original?.finished?endingEvidence:null};
  if(task.startsWith('严格审核')) {
    const n=ctx.number, next=structuredClone(ctx.world); if(options.objectWorld){next.relationships=[{from:'旅人',to:'商贩',description:'逐步互信'}];next.factions=[{name:'当地势力',status:'维持秩序'}];} next.elapsedDays++; next.time=`开局后第${next.elapsedDays}天`; next.resources[0].quantity--; next.conflicts=n===ending?[]:['如何立足'];
    if(options.omitWorldLists&&n!==ending)for(const key of ['conflicts','relationships','factions'])delete next[key];
    return {passed:!options.failReview, issues:options.failReview?(options.objectDescriptions?[{issue:'测试：因果不一致',suggestion:'补足因果过程'}]:['测试：因果不一致']):[], summary:`第${n}章交付一瓶饮料换取当地情报，接受有限帮助。`, meaningfulChange:'消耗一瓶饮料，获得有限情报。', world:next, resourceChanges:[{id:'drink',delta:-1,reason:'换取当地情报'}], finished:n===ending, ending:options.incompleteEnding?null:n===ending?endingEvidence:null, endingReason:n===ending?'旅人落脚，主要冲突收束':'', remaining:n===ending?[]:Array.from({length:ending-n},(_,i)=>({number:n+i+1,title:`江陵记事${n+i+1}`,purpose:'推进冲突与后果'})), decision:(ctx.isDecision||options.everyDecision)?{major:!options.minorDecisions,stakes:options.minorDecisions?'':'决定是否冒险庇护遭到追捕的重要人物，直接改变与当地势力的关系',question:'是否冒险庇护遭到追捕的重要人物？',options:options.objectDescriptions?[{label:'打听消息',action:'向当地商贩打听消息'},{label:'整理物资',action:'留在客舍整理物资'}]:['冒险庇护来客，承担与当地势力决裂的代价','拒绝庇护，保全商队及其成员']}:null };
  }
  if(task.startsWith('根据实际完成章节')) return { conclusion:'测试结局：在有限资源下落脚，未改变整体历史格局。', dimensions:dimensionNames.map(name=>({name,assessment:'基于第一章有限物资交换行为评价，结局属于推演。',chapters:[options.badCitation?31:1]})), uncertainties:'模拟测试数据；不构成历史考据或文学质量示例。' };
  // Deliberately mechanical text for control-flow tests, never shipped as a story.
  return (options.metaAlways || (options.metaFirstDraft && task.startsWith('写完整一章')) ? '【上一章累计消耗：1瓶。】\n' : '') + Array.from({length:64},(_,i)=>`这是自动测试段落${i}。旅人清点瓶数，向车夫询问道路与价格。他无法越过守门人的盘问，只能先付出一瓶饮料换取消息，再决定下一步行动。`).join('\n\n') + (ctx.number===ending || ctx.original?.finished ? '\n\n'+Object.values(endingEvidence).join('\n\n') : '');
}
export const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ioAAAAASUVORK5CYII=';
export async function startMock(options = {}) {
  const calls=[];
  let disconnected=false;
  const server=createServer(async(req,res)=>{
    if(options.cors){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,X-Management-Key');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}}
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):{};calls.push({path:req.url,body,authorization:req.headers.authorization,managementKey:req.headers['x-management-key']});
    if(options.status){res.writeHead(options.status,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'secret-should-never-appear'}));return;}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v0/management/api-keys'){
      if(req.headers['x-management-key']!=='management-test'){res.writeHead(401);res.end(JSON.stringify({error:'invalid management key'}));return;}
      res.end(JSON.stringify({'api-keys':['business-test']}));return;
    }
    if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'mock-text'},{id:'mock-image'},...(options.extraModels?[{id:'gemini-search'},{id:'gemini-image'}]:[])]}));return;}
    if(req.url?.startsWith('/v1beta/models/')){
      const parts=body.generationConfig?.responseModalities?.includes('IMAGE')?[{inlineData:{mimeType:'image/png',data:pixel}}]:[{text:'核实背景事实，物资运输受到道路限制。'}];
      res.end(JSON.stringify({candidates:[{content:{parts},groundingMetadata:{webSearchQueries:['古代运输'],groundingChunks:[{web:{uri:'https://example.com/source',title:'测试史料'}}],groundingSupports:[{segment:{text:'物资运输受到道路限制。'},groundingChunkIndices:[0]}]}}]}));return;
    }
    if(req.url==='/v1/images/generations'){res.end(JSON.stringify({data:[{b64_json:pixel}]}));return;}
    if(req.url==='/v1/responses'){
      res.end(JSON.stringify({output:[...(options.noSearch?[]:[{type:'web_search_call',status:'completed'}]),{type:'message',content:[{type:'output_text',text:'测试考据：历史背景有约束，反事实结果不确定。',annotations:options.noSearch?[]:[{type:'url_citation',url:'https://example.com/history',title:'测试来源'}]}]}]}));return;
    }
    if(body.web_search_options){res.end(JSON.stringify({choices:[{message:{content:'测试考据事实与争议。',annotations:[{type:'url_citation',url_citation:{url:'https://example.com/history',title:'测试来源'}}]},finish_reason:'stop'}]}));return;}
    const input=JSON.parse(body.messages.at(-1).content);
    if(options.delay)await new Promise(r=>setTimeout(r,options.delay));
    let value=input.task.startsWith('连接测试')?'连接成功':fixture(input.task,input.context,options);
    if(typeof value==='string'&&input.task.startsWith('写本章第'))value=value.slice(0,Math.ceil(value.length/3));
    const content=typeof value==='string'?value:JSON.stringify(value);
    if(body.stream){
      res.setHeader('Content-Type','text/event-stream');
      if(options.disconnectSceneOnce&&!disconnected&&input.task.startsWith('写完整一章')){
        disconnected=true;res.end(`data: ${JSON.stringify({choices:[{delta:{content:'连接中断前的临时草稿，不应进入正式章节。'}}]})}\n\n`);return;
      }
      for(let i=0;i<content.length;i+=700)res.write(`data: ${JSON.stringify({choices:[{delta:{content:content.slice(i,i+700)}}]})}\n\n`);
      res.end(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
    }else res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
  });
  await new Promise(r=>server.listen(options.port||0,'127.0.0.1',r));
  return {baseUrl:`http://127.0.0.1:${server.address().port}/v1`,calls,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
