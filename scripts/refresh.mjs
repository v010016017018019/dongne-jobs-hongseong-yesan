import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dataDir=resolve(process.env.JOB_MAP_DATA_DIR||resolve(root,'data'));
const store=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));
const requested=process.argv.find(value=>value.startsWith('--sources='))?.slice(10).split(',');
if(requested?.some(portal=>!['saramin','jobkorea','work24'].includes(portal)))throw new Error('지원하지 않는 사이트');
const sources=requested||['saramin','jobkorea','work24'].filter(portal=>!store.providers[portal]?.pausedForAccess);
if(!sources.length){console.error('모든 사이트가 접속 확인 대기 중입니다. 기존 자료를 유지합니다.');process.exitCode=1;}
else {
  const child=spawn(process.execPath,['server.mjs','--collect-only',`--sources=${sources.join(',')}`],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
}
