import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// Publish only the browser build to a separate branch, never local data/ or keys.
const git=(args,cwd=process.cwd())=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const remote=git(['remote','get-url','origin']);
if(!/^(https:\/\/github\.com\/|git@github\.com:)/.test(remote))throw new Error('origin 必须指向 GitHub 仓库');
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['run','build:pages'],{stdio:'inherit',shell:process.platform==='win32'});
const directory=mkdtempSync(resolve(tmpdir(),'storymode-pages-'));
git(['init','--initial-branch=gh-pages'],directory);
git(['remote','add','origin',remote],directory);
const previous=git(['ls-remote','--heads','origin','gh-pages'],directory);
if(previous){git(['fetch','origin','gh-pages'],directory);git(['reset','origin/gh-pages'],directory);}
cpSync(resolve('dist-pages'),directory,{recursive:true});
writeFileSync(resolve(directory,'.nojekyll'),'');
git(['add','--all'],directory);
if(!git(['diff','--cached','--name-only'],directory)){console.log('Pages 构建没有变化');process.exit(0);}
git(['commit','-m','Deploy browser build '+git(['rev-parse','--short','HEAD'])],directory);
execFileSync('git',['push','origin','HEAD:gh-pages'],{cwd:directory,stdio:'inherit'});
console.log('已发布 gh-pages。GitHub Pages 来源请选择 gh-pages / (root)。');
