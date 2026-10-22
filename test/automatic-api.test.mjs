import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {jobLink} from '../lib/providers.mjs';
const root=resolve(import.meta.dirname,'..'),json=async(path,value)=>writeFile(path,JSON.stringify(value));
test('실제 서버 자동 시작 조회는 신규·제거·상세 위치를 반영하고 실패·페이지 반복 때 기존 자료와 설정을 보존한다',async()=>{
  const scratch=resolve(root,'../../work/v4-api-test');await mkdir(scratch,{recursive:true});const dataDir=await mkdtemp(resolve(scratch,'run-'));
  const old={...jobLink('https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=KTESTOLD&infoTypeCd=VALIDATION'),company:'기존 회사',title:'기존 공고',regions:['홍성군'],sites:[],expiresAt:null};
  const fresh=new Date().toISOString(),stale=new Date(Date.now()-7*3600000).toISOString();
  await json(resolve(dataDir,'jobs-v7.json'),{jobs:[old],providers:{saramin:{fetchedAt:fresh,collectionComplete:true},jobkorea:{fetchedAt:fresh,collectionComplete:true},work24:{fetchedAt:stale,collectionComplete:true}}});
  await writeFile(resolve(dataDir,'fixture-mode.txt'),'success');
  let child;
  const stop=async()=>{if(child){child.kill();await new Promise(done=>child.exitCode!==null?done():child.once('exit',done));child=null;}};
  const start=async()=>{child=spawn(process.execPath,['--import','./test/fixtures/collector-fetch.mjs','server.mjs'],{cwd:root,env:{...process.env,PORT:'4322',JOB_MAP_DATA_DIR:dataDir},windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',chunk=>errors+=chunk);await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(new Error('Startup timeout '+errors)),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('localhost:4322')){clearTimeout(timer);done();}});child.on('error',fail);});};
  const get=async()=>{const response=await fetch('http://127.0.0.1:4322/api/jobs');assert.equal(response.status,200);return response.json();};
  const finish=async()=>{const deadline=Date.now()+20000;while(Date.now()<deadline){const data=await get();if(!data.status.running&&data.status.lastStartedAt)return data;await new Promise(r=>setTimeout(r,150));}throw new Error('Collection timeout');};
  const staleWork24=async()=>{const path=resolve(dataDir,'jobs-v7.json'),store=JSON.parse(await readFile(path,'utf8'));store.providers.work24.fetchedAt=stale;store.providers.work24.lastStartedAt=stale;await json(path,store);};
  try{
    await start();let data=await finish();assert.equal(data.status.trigger,'automatic');assert.equal(data.newCount,1);assert.equal(data.jobs.length,1);assert.notEqual(data.jobs[0].id,old.id);assert.equal(data.jobs[0].isNew,true);assert.equal(data.jobs[0].sites.length,1);
    const firstSeen=data.jobs[0].firstSeenAt,successfulAt=data.providers.find(p=>p.id==='work24').fetchedAt;assert.deepEqual(data.providers.find(p=>p.id==='work24').lastChanges.added,1);assert.equal(data.providers.find(p=>p.id==='work24').lastChanges.removed,1);assert.equal(data.providers.find(p=>p.id==='work24').collectionComplete,true);
    await stop();await staleWork24();await writeFile(resolve(dataDir,'fixture-mode.txt'),'failure');await start();data=await finish();assert.equal(data.jobs.length,1);assert.equal(data.jobs[0].firstSeenAt,firstSeen);assert.equal(data.jobs[0].sites.length,1);assert.match(data.providers.find(p=>p.id==='work24').error,/503/);assert.equal(data.providers.find(p=>p.id==='work24').fetchedAt,stale);assert.notEqual(data.automatic.providers.find(p=>p.id==='work24').lastAttemptAt,stale);
    await stop();await staleWork24();await writeFile(resolve(dataDir,'fixture-mode.txt'),'repeat');await start();data=await finish();assert.equal(data.jobs.length,1);assert.equal(data.jobs[0].firstSeenAt,firstSeen);assert.match(data.providers.find(p=>p.id==='work24').error,/끝까지/);assert.deepEqual(data.providers.find(p=>p.id==='work24').lastAttemptTruncated,['홍성군']);
    await stop();await staleWork24();await writeFile(resolve(dataDir,'fixture-mode.txt'),'captcha');await start();data=await finish();assert.equal(data.jobs.length,1);assert.equal(data.jobs[0].firstSeenAt,firstSeen);assert.equal(data.providers.find(p=>p.id==='work24').pausedForAccess,true);assert.equal(data.automatic.providers.find(p=>p.id==='work24').nextCheckAt,null);assert.match(data.providers.find(p=>p.id==='work24').error,/접속 확인/);
    let response=await fetch('http://127.0.0.1:4322/api/auto-refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false})});assert.equal(response.status,200);assert.equal((await response.json()).automatic.enabled,false);
    response=await fetch('http://127.0.0.1:4322/api/auto-refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:'yes'})});assert.equal(response.status,400);
    await stop();await staleWork24();await start();await new Promise(r=>setTimeout(r,1800));data=await get();assert.equal(data.automatic.enabled,false);assert.equal(data.status.running,false);assert.equal(data.status.lastStartedAt,null);
    assert.ok(successfulAt);assert.equal(JSON.parse(await readFile(resolve(dataDir,'settings-v7.json'),'utf8')).autoRefresh,false);
  }finally{await stop();}
});
