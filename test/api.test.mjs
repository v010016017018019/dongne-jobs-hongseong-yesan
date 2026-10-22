import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {request} from 'node:http';
const root=resolve(import.meta.dirname,'..');
test('실제 서버는 중단 기록·검증 결과·지도 자산·직접 등록을 처리하고 비공개 파일과 외부 요청을 차단한다',async()=>{
  const scratch=resolve(root,'../../work/api-test');await mkdir(scratch,{recursive:true});const dataDir=await mkdtemp(resolve(scratch,'run-'));
  await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[],providers:{saramin:{collectionComplete:false,lastStartedAt:'2026-10-13T00:00:00Z',pages:{홍성군:2}}}}));
  await writeFile(resolve(dataDir,'settings-v7.json'),JSON.stringify({autoRefresh:false}));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4321',JOB_MAP_DATA_DIR:dataDir},windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',chunk=>errors+=chunk);
  try{
    await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(new Error('test server startup timeout '+errors)),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('localhost:4321')){clearTimeout(timer);done();}});child.on('error',fail);child.on('exit',code=>{if(code)fail(new Error('test server exited '+errors));});});
    const url='http://127.0.0.1:4321',get=path=>fetch(url+path),post=(path,value)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    let payload=await(await get('/api/jobs')).json();assert.equal(payload.version,'7.0.0');assert.equal(payload.providers.find(p=>p.id==='saramin').interrupted,true);assert.ok(payload.providers.find(p=>p.id==='saramin').error.includes('중단'));assert.equal(payload.quality.unchecked,0);
    for(const path of ['/server.mjs','/data/jobs-v7.json','/../package.json'])assert.equal((await get(path)).status,404);
    for(const path of ['/app.js','/model.js','/education.js','/vendor/markercluster.js','/vendor/MarkerCluster.css'])assert.equal((await get(path)).status,200);
    const invalidHostStatus=await new Promise((done,fail)=>{const req=request(url+'/api/jobs',{headers:{Host:'evil.test'}},res=>{res.resume();done(res.statusCode);});req.on('error',fail);req.end();});assert.equal(invalidHostStatus,403);
    assert.equal((await fetch(url+'/api/jobs',{headers:{Origin:'https://evil.test'}})).status,403);
    let response=await post('/api/manual',{url:'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=999123456',company:'API 검증 회사',title:'검증 공고',region:'홍성군'});assert.equal(response.status,201);payload=await response.json();assert.equal(payload.jobs.length,1);
    response=await post('/api/location',{id:'saramin:999123456',address:'홍성군 산단2길 3층',lat:36.58,lng:126.65});assert.equal(response.status,400);
    response=await post('/api/location',{id:'saramin:999123456',address:'충남 홍성군 홍성읍 대학1길 19',lat:36.579786,lng:126.659169});assert.equal(response.status,200);payload=await response.json();assert.equal(payload.jobs[0].sites.length,1);
    assert.equal((await post('/api/manual',{url:'https://evil.test/123',company:'X',title:'Y',region:'홍성군'})).status,400);
  }finally{child.kill();await new Promise(done=>child.exitCode!==null?done():child.once('exit',done));}
});
