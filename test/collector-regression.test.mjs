import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {jobLink,parsePortalList} from '../lib/providers.mjs';

const root=resolve(import.meta.dirname,'..');
const old={...jobLink('https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=KTESTOLD'),company:'기존 회사',title:'기존 공고',regions:['홍성군'],sites:[],expiresAt:null};
const pageDetails=()=>Object.fromEntries(Array.from({length:51},(_,i)=>[`work24:VALIDATION:KPAGE${String(i+1).padStart(3,'0')}`,{factsVersion:5,checkedAt:new Date().toISOString()}]));
const run=(args,dataDir)=>new Promise((done,fail)=>{
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,JOB_MAP_DATA_DIR:dataDir,NODE_OPTIONS:'--import ./test/fixtures/collector-regression-fetch.mjs'},windowsHide:true});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',fail);child.on('close',code=>done({code,stdout,stderr}));
});
test('일반 reCAPTCHA 스크립트가 포함된 목록과 상세 페이지는 정상 수집한다',async()=>{
  const dataDir=await mkdtemp(resolve(root,'test-run-'));
  try{
    await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[old],providers:{work24:{collectionComplete:true}}}));
    await writeFile(resolve(dataDir,'fixture-mode.txt'),'recaptcha-script');
    const result=await run(['server.mjs','--collect-only','--sources=work24'],dataDir);
    assert.equal(result.code,0,`${result.stdout} ${result.stderr}`);
    const stored=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));
    assert.notEqual(stored.jobs[0].id,old.id);assert.equal(stored.providers.work24.collectionComplete,true);assert.equal(stored.providers.work24.pausedForAccess,false);
  }finally{await rm(dataDir,{recursive:true,force:true});}
});
test('실제 접속 확인 메시지나 차단 URL은 조회를 멈추고 기존 목록을 유지한다',async()=>{
  for(const mode of ['challenge-korean','challenge-captcha','challenge-recaptcha','challenge-frame','challenge-url']){
    const dataDir=await mkdtemp(resolve(root,'test-run-'));
    try{
      await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[old],providers:{work24:{collectionComplete:true}}}));
      await writeFile(resolve(dataDir,'fixture-mode.txt'),mode);
      const result=await run(['server.mjs','--collect-only','--sources=work24'],dataDir);
      assert.notEqual(result.code,0,mode);
      const stored=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));
      assert.equal(stored.providers.work24.pausedForAccess,true,mode);assert.deepEqual(stored.jobs.map(job=>job.id),[old.id],mode);
    }finally{await rm(dataDir,{recursive:true,force:true});}
  }
});
for(const mode of ['pages-short-first','pages-short-middle','pages-short-last'])test(`총건수보다 짧은 목록은 기존 공고를 유지한다 (${mode})`,async()=>{
    const dataDir=await mkdtemp(resolve(root,'test-run-'));
    try{
      await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[old],providers:{work24:{collectionComplete:true}}}));
      await writeFile(resolve(dataDir,'fixture-mode.txt'),mode);
      await writeFile(resolve(dataDir,'details-v7.json'),JSON.stringify(pageDetails()));
      const result=await run(['server.mjs','--collect-only','--sources=work24'],dataDir);
      assert.notEqual(result.code,0,`${mode}: ${result.stdout}`);
      const stored=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));
      assert.deepEqual(stored.jobs.map(job=>job.id),[old.id],mode);assert.equal(stored.providers.work24.collectionComplete,false,mode);
      assert.match(stored.providers.work24.error,/끝까지|목록/,mode);
    }finally{await rm(dataDir,{recursive:true,force:true});}
});
test('총건수의 마지막 페이지가 짧으면 확인한 목록으로 정상 갱신한다',async()=>{
  const dataDir=await mkdtemp(resolve(root,'test-run-'));
  try{
    await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[old],providers:{work24:{collectionComplete:true}}}));
    await writeFile(resolve(dataDir,'fixture-mode.txt'),'pages-last');
    await writeFile(resolve(dataDir,'details-v7.json'),JSON.stringify(pageDetails()));
    const result=await run(['server.mjs','--collect-only','--sources=work24'],dataDir);
    assert.equal(result.code,0,`${result.stdout} ${result.stderr}`);
    const stored=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));
    assert.equal(stored.jobs.length,51);assert.equal(stored.providers.work24.pages.홍성군,2);assert.equal(stored.providers.work24.collectionComplete,true);
  }finally{await rm(dataDir,{recursive:true,force:true});}
});
test('목록에 읽을 수 없는 공고 링크가 섞이면 수집 실패를 알리고 기존 공고를 유지한다',async()=>{
  const dataDir=await mkdtemp(resolve(root,'test-run-'));
  try{
    await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[old],providers:{work24:{collectionComplete:true}}}));
    await writeFile(resolve(dataDir,'fixture-mode.txt'),'bad-link');
    const result=await run(['server.mjs','--collect-only','--sources=work24'],dataDir);
    assert.notEqual(result.code,0,`수집이 성공으로 종료됨: ${result.stdout}`);
    const output=JSON.parse(result.stdout.trim());assert.ok(output.status.error);
    const stored=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));
    assert.deepEqual(stored.jobs.map(job=>job.id),[old.id]);assert.equal(stored.providers.work24.collectionComplete,false);
  }finally{await rm(dataDir,{recursive:true,force:true});}
});
test('상세 확인에 실패하면 새 공고와 이전 목록에서 빠진 공고를 함께 보존한다',async()=>{
  const dataDir=await mkdtemp(resolve(root,'test-run-'));
  try{
    await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[old],providers:{work24:{collectionComplete:true}}}));
    await writeFile(resolve(dataDir,'fixture-mode.txt'),'detail-error');
    const result=await run(['server.mjs','--collect-only','--sources=work24'],dataDir);
    assert.notEqual(result.code,0);const stored=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));
    assert.ok(stored.jobs.some(job=>job.id===old.id));assert.ok(stored.jobs.some(job=>job.id!=='old'&&job.id!==old.id));assert.equal(stored.providers.work24.collectionComplete,false);
  }finally{await rm(dataDir,{recursive:true,force:true});}
});
test('상세 확인 도중 프로세스가 중단돼도 이전 공고를 디스크에 보존한다',async()=>{
  const dataDir=await mkdtemp(resolve(root,'test-run-'));let child;
  try{
    await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[old],providers:{work24:{collectionComplete:true}}}));await writeFile(resolve(dataDir,'fixture-mode.txt'),'detail-wait');
    child=spawn(process.execPath,['server.mjs','--collect-only','--sources=work24'],{cwd:root,env:{...process.env,JOB_MAP_DATA_DIR:dataDir,NODE_OPTIONS:'--import ./test/fixtures/collector-regression-fetch.mjs'},windowsHide:true,stdio:'ignore'});
    const deadline=Date.now()+12000;let found=false;
    while(Date.now()<deadline){const requests=await readFile(resolve(dataDir,'fixture-requests.txt'),'utf8').catch(()=>'');if(requests.includes('empDetailAuthView')){found=true;break;}await new Promise(done=>setTimeout(done,100));}
    assert.ok(found,'상세 확인이 시작되지 않았습니다');child.kill();await new Promise(done=>child.exitCode!==null||child.signalCode!==null?done():child.once('exit',done));
    const stored=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));assert.ok(stored.jobs.some(job=>job.id===old.id));assert.equal(stored.providers.work24.collectionComplete,false);
  }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await new Promise(done=>child.once('exit',done));}await rm(dataDir,{recursive:true,force:true});}
});
test('접속 확인 대기 사이트가 남은 정기 수집은 다른 사이트가 성공해도 실패로 보고한다',async()=>{
  const dataDir=await mkdtemp(resolve(root,'test-run-'));
  try{
    await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[old],providers:{saramin:{pausedForAccess:true,error:'접속 확인'},jobkorea:{pausedForAccess:true,error:'접속 확인'},work24:{collectionComplete:true}}}));
    await writeFile(resolve(dataDir,'fixture-mode.txt'),'success');
    const result=await run(['scripts/refresh.mjs'],dataDir);
    assert.notEqual(result.code,0,`수집이 성공으로 종료됨: ${result.stdout}`);
    assert.match(result.stderr,/접속 확인/);
    const stored=JSON.parse(await readFile(resolve(dataDir,'jobs-v7.json'),'utf8'));
    assert.equal(stored.providers.saramin.pausedForAccess,true);assert.equal(stored.providers.work24.collectionComplete,true);
    assert.notEqual(stored.jobs[0].id,old.id);
    const requests=await readFile(resolve(dataDir,'fixture-requests.txt'),'utf8');assert.doesNotMatch(requests,/saramin|jobkorea/);
  }finally{await rm(dataDir,{recursive:true,force:true});}
});
test('자동 조회 상태도 접속 확인으로 제외된 사이트가 있으면 전체 완료로 표시하지 않는다',async()=>{
  const dataDir=await mkdtemp(resolve(root,'test-run-'));
  let child;
  try{
    const fresh=new Date().toISOString(),stale=new Date(Date.now()-7*3600000).toISOString();
    await writeFile(resolve(dataDir,'jobs-v7.json'),JSON.stringify({jobs:[old],providers:{saramin:{pausedForAccess:true,error:'접속 확인',fetchedAt:fresh},jobkorea:{fetchedAt:fresh,collectionComplete:true},work24:{fetchedAt:stale,collectionComplete:true}}}));
    await writeFile(resolve(dataDir,'fixture-mode.txt'),'success');
    child=spawn(process.execPath,['--import','./test/fixtures/collector-regression-fetch.mjs','server.mjs'],{cwd:root,env:{...process.env,PORT:'4328',JOB_MAP_DATA_DIR:dataDir},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',chunk=>errors+=chunk);
    await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(new Error('서버 시작 시간 초과 '+errors)),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('localhost:4328')){clearTimeout(timer);done();}});child.on('error',fail);});
    let data;const deadline=Date.now()+15000;
    while(Date.now()<deadline){data=await (await fetch('http://127.0.0.1:4328/api/jobs')).json();if(data.status.lastStartedAt&&!data.status.running)break;await new Promise(done=>setTimeout(done,100));}
    assert.ok(data.status.lastStartedAt&&!data.status.running,'자동 조회 시간 초과');
    assert.match(data.status.error,/접속 확인/);assert.equal(data.providers.find(p=>p.id==='work24').collectionComplete,true);
    assert.equal(data.providers.find(p=>p.id==='saramin').pausedForAccess,true);
    assert.doesNotMatch(await readFile(resolve(dataDir,'fixture-requests.txt'),'utf8'),/saramin/);
  }finally{if(child){child.kill();await new Promise(done=>child.exitCode!==null||child.signalCode!==null?done():child.once('exit',done));}await rm(dataDir,{recursive:true,force:true});}
});
test('각 사이트의 대상 지역 미마감 공고는 링크나 필수 정보가 없으면 실패로 보고한다',()=>{
  const now=new Date('2026-10-14T03:00:00Z');
  const cases={
    saramin:(link,company='회사',location='홍성군',date='채용시')=>`<div class="list_item"><div class="company_nm"><a class="str_tit">${company}</a></div><div class="job_tit">${link}</div><p class="work_place">${location}</p><div class="support_detail"><span class="date">${date}</span></div></div>`,
    jobkorea:(link,company='회사',location='홍성군',date='채용시')=>`<div class="tplList"><table><tr class="devloopArea"><td class="tplCo"><a>${company}</a></td><td class="tplTit"><strong>${link}</strong><div class="etc"><span class="cell">${location}</span></div></td><td class="date">${date}</td></tr></table></div>`,
    work24:(link,company='회사',location='홍성군',date='2099-12-31')=>`<table><tr><td><input id="chkboxWantedAuthNo1" value="K123456|VALIDATION|${company}|공고"><a class="cp_name">${company}</a>${link}</td><td><ul class="emp_info_dtl"><li class="site">${location}</li></ul></td><td><script>var date='${date}';</script></td></tr></table>`,
  };
  const valid={saramin:'<a href="/zf_user/jobs/view?rec_idx=123456">공고</a>',jobkorea:'<a href="/Recruit/GI_Read/123456">공고</a>',work24:'<a href="/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=K123456">공고</a>'};
  for(const [portal,row] of Object.entries(cases)){
    for(const html of [row('<a href="/changed">공고</a>'),row(''),row(valid[portal],''),row(valid[portal].replace('>공고</a>','></a>')).replace('|공고"','|"')]){
      assert.throws(()=>parsePortalList(portal,html,'홍성군',now),undefined,`${portal} 필수 정보 누락`);
    }
    for(const location of ['서울 강남구','충남 예산군','부산 해운대구','경기 성남시']){
      assert.equal(parsePortalList(portal,row('<a href="/changed">공고</a>','회사',location),'홍성군',now).jobs.length,0,`${portal} 타 지역 ${location}`);
    }
    assert.equal(parsePortalList(portal,row('<a href="/changed">공고</a>','','홍성군',portal==='work24'?'2026-10-01':'~10.01'),'홍성군',now).jobs.length,0,`${portal} 마감`);
    assert.equal(parsePortalList(portal,'<p>검색 결과가 없습니다</p>','홍성군',now).jobs.length,0,`${portal} 빈 목록`);
    assert.throws(()=>parsePortalList(portal,row(valid[portal],'회사',''),'홍성군',now),undefined,`${portal} 근무지역 누락`);
  }
  assert.throws(()=>parsePortalList('jobkorea',cases.jobkorea(valid.jobkorea,'회사','신입'),'홍성군',now),undefined,'잡코리아 근무지역만 누락');
  const workRow=cases.work24('<a href="/changed">공고</a>').replace(/<input[^>]+>/,'');
  assert.throws(()=>parsePortalList('work24',cases.work24(valid.work24)+workRow,'홍성군',now),undefined,'고용24 공고 행의 링크와 식별 입력 누락');
});
