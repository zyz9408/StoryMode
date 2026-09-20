import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { IllustrationQueue } from './illustration-queue.mjs';
export { characterPrompt, illustrationPrompt } from './image-prompts.mjs';
export class Illustrations extends IllustrationQueue {
  async readImage(image) {
    if (this.imageStorage) return this.imageStorage.read(image);
    const file = basename(image);
    return { bytes:readFileSync(resolve(this.directory, file)), mimeType:file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.webp') ? 'image/webp' : 'image/png' };
  }
  async writeImage(id, target, result) {
    if (this.imageStorage) return this.imageStorage.write(id, target, result);
    const file = `${id}-${target}-${randomUUID()}.${result.ext}`;
    writeFileSync(resolve(this.directory, file), result.bytes);
    return `/media/${file}`;
  }
}
