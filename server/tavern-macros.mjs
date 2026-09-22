const string = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);

// One environment per generation, shared by ordered prompts and regex scripts.
// Unknown extension macros survive verbatim and are reported by the preview.
export function createMacroEnvironment(context = {}, settings = {}) {
  const state = context.macroState || { local:{}, global:{} };
  state.local ||= {}; state.global ||= {};
  const unknown = new Set();
  const history = context.chatHistory || [];
  const user = context.player || context.name || '玩家';
  const char = context.protagonist?.name || (context.setup?.kind === '历史改写' ? context.setup.identity : user) || '主角';
  const last = role => history.findLast(m => m.role === role)?.content || '';
  const builtins = {
    user, char, charifnotgroup:char, group:char, groupnotmuted:char, notchar:user,
    description:context.charDescription ?? [context.protagonist?.appearance, context.protagonist?.background].filter(Boolean).join('\n'),
    personality:context.charPersonality ?? context.protagonist?.personality ?? '',
    scenario:context.scenario ?? string(context.setup || context.event), persona:context.personaDescription || '',
    mesexamples:context.dialogueExamples || '', mesexamplesraw:context.dialogueExamples || '',
    lastmessage:history.at(-1)?.content || context.event || '',
    lastusermessage:last('user') || context.decisions?.at(-1)?.choice || context.event || '',
    lastcharmessage:last('assistant') || context.recentProse || '',
    lastmessageid:Math.max(-1,history.length-1), firstincludedmessageid:history.length ? 0 : '',
    lastgenerationtype:context.generationType || 'normal', input:context.input || '',
    maxcontext:settings.openai_max_context ?? '', maxcontexttokens:settings.openai_max_context ?? '',
    maxresponse:settings.openai_max_tokens ?? '', maxresponsetokens:settings.openai_max_tokens ?? '',
    maxprompt:settings.openai_max_context == null ? '' : settings.openai_max_context - (settings.openai_max_tokens || 0),
    original:context.originalPrompt || '', ...context.macros,
  };
  builtins.maxprompttokens = builtins.maxprompt;
  const put = (obj, key, value) => Object.defineProperty(obj, key, { value, writable:true, enumerable:true, configurable:true });
  const get = (obj, key) => Object.hasOwn(obj, key) ? obj[key] : '';
  const add = (obj, key, value) => {
    const current = get(obj,key) || 0;
    let next;
    try { const parsed = JSON.parse(current); if (Array.isArray(parsed)) next = JSON.stringify([...parsed,value]); } catch { /* scalar */ }
    next ??= isNaN(Number(current)) || isNaN(Number(value)) ? String(current || '') + value : Number(current) + Number(value);
    put(obj,key,next); return next;
  };
  function evaluate(expression, original, transform) {
    const [rawName,...parts] = expression.split('::');
    const name = rawName.trim().toLowerCase(), key = parts[0]?.trim();
    if (name.startsWith('//') || name === 'comment' || name === 'noop') return '';
    if (Object.hasOwn(builtins,name)) return transform(string(builtins[name]));
    if (name === 'newline' || name === 'space') return (name === 'newline' ? '\n' : ' ').repeat(Math.min(10000,Math.max(0,Number(parts[0] ?? 1) || 0)));
    if (name === 'trim') return parts.join('::').trim();
    const variable = name.match(/^(set|add|inc|dec|get|has|delete|flush)(global)?var$/);
    if (variable && key) {
      const [,operation,global] = variable, obj = global ? state.global : state.local;
      if (operation === 'set') { put(obj,key,parts.slice(1).join('::')); return ''; }
      if (operation === 'get') return transform(string(get(obj,key)));
      if (operation === 'has') return String(Object.hasOwn(obj,key));
      if (operation === 'delete' || operation === 'flush') { delete obj[key]; return ''; }
      const value = add(obj,key,operation === 'inc' ? 1 : operation === 'dec' ? -1 : parts.slice(1).join('::'));
      return operation === 'add' ? '' : transform(string(value));
    }
    if (name === 'outlet') return transform(string(context.outlets?.[key]));
    if (name === 'reverse' || name.startsWith('reverse:')) return transform(Array.from(parts.length ? parts.join('::') : expression.slice(8)).reverse().join(''));
    if (name === 'random') {
      const choices = parts.length > 1 ? parts : (parts[0] || '').split(',').map(s=>s.trim());
      return transform(choices[Math.floor(Math.random()*choices.length)] || '');
    }
    if (name === 'isodate') return new Date().toLocaleDateString('sv-SE');
    if (name === 'isotime') return new Date().toTimeString().slice(0,5);
    if (name === 'date') return new Date().toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
    if (name === 'time') return new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    if (name === 'weekday') return new Date().toLocaleDateString(undefined,{weekday:'long'});
    const roll=expression.match(/^roll(?:::|\s+)(\d*)d(\d+)(?:([+-])(\d+))?$/i);
    if (roll) {
      const count=Number(roll[1] || 1), faces=Number(roll[2]);
      if(count<=10000 && faces>0) return String(Array.from({length:count},()=>Math.floor(Math.random()*faces)+1).reduce((a,b)=>a+b,0)+(roll[3]==='-' ? -1 : 1)*Number(roll[4] || 0));
    }
    unknown.add(expression.slice(0,200)); return original;
  }
  function substitute(text, transform = value => value) {
    text = String(text ?? '').replace(/(?:\r?\n)*{{trim}}(?:\r?\n)*/gi,'');
    text = text.replace(/<(USER|BOT|CHAR|CHARIFNOTGROUP|GROUP)>/gi, (_,name)=>transform(name.toLowerCase()==='user' ? user : char));
    // Parse nesting from the inside without recursively executing macro-looking
    // text returned by an expansion (e.g. a character's description).
    function parse(value) {
      let output = '', cursor = 0;
      while (cursor < value.length) {
        const start = value.indexOf('{{',cursor);
        if (start < 0) return output + value.slice(cursor);
        output += value.slice(cursor,start);
        let depth = 1, end = start+2;
        while (end < value.length && depth) {
          if (value.startsWith('{{',end)) { depth++; end+=2; }
          else if (value.startsWith('}}',end)) { depth--; end+=2; }
          else end++;
        }
        if (depth) return output + value.slice(start);
        const original = value.slice(start,end), inner = original.slice(2,-2);
        output += inner.trim().startsWith('//') ? '' : evaluate(parse(inner),original,transform);
        cursor = end;
      }
      return output;
    }
    return parse(text);
  }
  return { substitute, unknown, state, builtins };
}
