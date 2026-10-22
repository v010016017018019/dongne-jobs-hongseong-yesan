import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {jobLink} from '../lib/providers.mjs';
const root=resolve(import.meta.dirname,'..'),json=async(path,value)=>writeFile(path,JSON.stringify(value));
test('실제 서버에서 검색·읽음·관심·메모가 재실행 뒤 유지되고 사라진 공고의 원문과 지원 정보도 남는다',async()=>{
  const scratch=resolve(root,'../../work/v5-personal-api');await mkdir(scratch,{recursive:true});const dataDir=await mkdtemp(resolve(scratch,'run-'));
  const source={...jobLink('https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=999123456'),title:'생산직',company:'검증 기업',regions:['홍성군'],sites:[],expiresAt:null};
  const affiliate={...source,...jobLink('https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=KTESTPERSONAL&infoTypeCd=VALIDATION')};
  await json(resolve(dataDir,'jobs-v7.json'),{jobs:[source,affiliate],providers:{}});await json(resolve(dataDir,'details-v7.json'),{[affiliate.id]:{originId:source.id}});await json(resolve(dataDir,'settings-v7.json'),{autoRefresh:false});
  let child;const stop=async()=>{if(child){child.kill();await new Promise(done=>child.exitCode!==null?done():child.once('exit',done));child=null;}};
  const start=async()=>{child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4324',JOB_MAP_DATA_DIR:dataDir},windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',chunk=>errors+=chunk);await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(new Error('Startup timeout '+errors)),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('localhost:4324')){clearTimeout(timer);done();}});child.on('error',fail);});};
  const get=async path=>(await fetch('http://127.0.0.1:4324'+path)).json(),post=async input=>fetch('http://127.0.0.1:4324/api/personal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  try{
    await start();let response=await post({action:'visit'});assert.equal(response.status,200);
    for(const input of [{action:'favorite',id:affiliate.id,saved:true},{action:'read',id:affiliate.id},{action:'application',id:affiliate.id,stage:'interview',note:'급여와 근무지 확인\n<script>unsafe()</script>'},{action:'save-search',name:'홍성 월급',filters:{region:'홍성군',payPeriod:'month',payMin:2500000,education:['any','high','high','invalid'],query:'생산',data:{notStored:true}}}])assert.equal((await post(input)).status,200);
    let data=await get('/api/jobs');assert.deepEqual(data.personal.savedIds,[source.id]);assert.ok(data.personal.reads[source.id]);assert.equal(data.personal.applications[source.id].stage,'interview');assert.equal(data.personal.searches[0].filters.data,undefined);assert.equal(data.personal.searches[0].filters.payMin,2500000);assert.deepEqual(data.personal.searches[0].filters.education,['any','high']);
    assert.equal((await post({action:'application',id:source.id,stage:'applied',note:'x'.repeat(4001)})).status,400);assert.equal((await post({action:'favorite',id:'not-a-job',saved:true})).status,400);
    const originalNote=data.personal.applications[source.id].note;await stop();await start();data=await get('/api/jobs');assert.equal(data.personal.applications[source.id].note,originalNote);assert.equal(data.personal.searches[0].name,'홍성 월급');assert.deepEqual(data.personal.searches[0].filters.education,['any','high']);assert.equal(data.personal.savedIds[0],source.id);
    await stop();const store=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));store.jobs=[];await json(resolve(dataDir,'jobs-v7.json'),store);await start();
    data=await get('/api/jobs');assert.equal(data.jobs.length,0);assert.equal(data.personal.applications[source.id].note,originalNote);const history=await get('/api/history');assert.equal(history.archived.length,1);assert.equal(history.archived[0].members.length,2);assert.match(history.archived[0].archiveReason,/마감 여부 미확인/);assert.equal(history.events.filter(event=>event.type==='missing').length,2);
    assert.equal((await post({action:'application',id:source.id,stage:'result',note:'결과 대기'})).status,200);assert.equal((await get('/api/jobs')).personal.applications[source.id].stage,'result');
    assert.equal((await post({action:'favorite',id:source.id,saved:false})).status,200);assert.equal((await get('/api/jobs')).personal.savedIds.length,0);
    assert.equal((await fetch('http://127.0.0.1:4324/data/personal-v7.json')).status,404);assert.equal((await fetch('http://127.0.0.1:4324/api/personal',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'})).status,403);
  }finally{await stop();}
});
