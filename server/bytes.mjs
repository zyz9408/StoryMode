export const fromBase64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function concatBytes(parts) {
  const result = new Uint8Array(parts.reduce((n,p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part,offset); offset += part.length; }
  return result;
}
