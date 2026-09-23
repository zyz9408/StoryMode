// Behaviour reference: SillyTavern 8172dcd, scripts/extensions/regex/engine.js.
// Shared by the server and Pages; no eval or extension JavaScript execution.
export const regexPlacement = { USER_INPUT:1, AI_OUTPUT:2, SLASH_COMMAND:3, WORLD_INFO:5, REASONING:6 };

export function regexFromString(input) {
  try {
    const match = input.match(/(\/?)(.+)\1([a-z]*)/i);
    if (match[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3])) return new RegExp(input);
    return new RegExp(match[2], match[3]);
  } catch { return null; }
}

export function escapeRegexMacro(value) {
  return String(value).replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/g, c => ({'\n':'\\n','\r':'\\r','\t':'\\t','\v':'\\v','\f':'\\f','\0':'\\0'}[c] ?? '\\'+c));
}

export function runRegex(script, text, substitute = value => value) {
  if (script.groupDisabled || script.disabled || !script.findRegex || !text) return text;
  const pattern = Number(script.substituteRegex) === 1 ? substitute(script.findRegex)
    : Number(script.substituteRegex) === 2 ? substitute(script.findRegex, escapeRegexMacro) : script.findRegex;
  const regex = regexFromString(pattern);
  if (!regex) return text;
  return text.replace(regex, (...args) => {
    const replacement = script.replaceString.replace(/{{match}}/gi, '$0').replace(/\$(\d+)|\$<([^>]+)>/g, (_, index, name) => {
      const groups = args.at(-1);
      let capture = index ? args[Number(index)] : typeof groups === 'object' ? groups[name] : '';
      if (!capture) return '';
      for (const trim of script.trimStrings || []) capture = String(capture).replaceAll(substitute(trim), '');
      return capture;
    });
    return substitute(replacement);
  });
}

export function applyRegex(text, scripts = [], placement, { isMarkdown = false, isPrompt = false, isEdit = false, depth, substitute } = {}) {
  if (typeof text !== 'string') return '';
  for (const script of scripts) {
    const eligible = (script.markdownOnly && isMarkdown) || (script.promptOnly && isPrompt)
      || (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt);
    if (!eligible || (isEdit && !script.runOnEdit) || !script.placement?.includes(placement)) continue;
    if (typeof depth === 'number') {
      if (!isNaN(script.minDepth) && script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) continue;
      if (!isNaN(script.maxDepth) && script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) continue;
    }
    text = runRegex(script, text, substitute);
  }
  return text;
}
