import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dataDir=resolve(process.env.JOB_MAP_DATA_DIR||resolve(root,'data'));
const store=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));
const requested=process.argv.find(value=>value.startsWith('--sources='))?.slice(10).split(',');
if(requested?.some(portal=>!['saramin','jobkorea','work24'].includes(portal)))throw new Error('지원하지 않는 사이트');
const all=['saramin','jobkorea','work24'];
const paused=requested?[]:all.filter(portal=>store.providers[portal]?.pausedForAccess);
const sources=requested||all.filter(portal=>!store.providers[portal]?.pausedForAccess);
if(!sources.length){console.error('모든 사이트가 접속 확인 대기 중입니다. 기존 자료를 유지합니다.');process.exitCode=1;}
else {
  if(paused.length)console.error(`접속 확인 대기 중인 사이트가 있어 전체 수집을 완료하지 못했습니다: ${paused.join(', ')}. 기존 자료를 유지합니다.`);
  const child=spawn(process.execPath,['server.mjs','--collect-only',`--sources=${sources.join(',')}`],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=(code??1)||(paused.length?1:0);});
}
