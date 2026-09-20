import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildApp } from '../server/app.mjs';
import { startMock } from './mock-provider.mjs';
// Isolated browser test workspace. Never touches production data/.
const dir=mkdtempSync(resolve(tmpdir(),'storymode-ui-'));
const mock=await startMock({port:3213,delay:10,extraModels:true});
const app=await buildApp({dataDir:dir});
await app.listen({host:'127.0.0.1',port:3212});
async function close(){await app.close();await mock.close();rmSync(dir,{recursive:true,force:true});process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
