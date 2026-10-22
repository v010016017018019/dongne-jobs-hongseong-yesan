import test from 'node:test';
import assert from 'node:assert/strict';
import {REFRESH_INTERVAL_MS,NEW_WINDOW_MS,nextCheckAt,duePortals,createAutoRefresh,emptyDiscovery,recordDiscovery,applyDiscovery} from '../lib/freshness.mjs';
import {groupJobs,filterJobs} from '../public/model.js';
const now=Date.parse('2026-10-14T10:00:00Z'),ago=hours=>new Date(now-hours*3600000).toISOString();
const job=(id,extra={})=>({id,portal:id.split(':')[0],company:'테스트',title:'공고',regions:['홍성군'],experience:'경력무관',sites:[],...extra});

test('6시간 경계와 사이트별 마지막 조회 시도로 자동 갱신 대상을 정한다',()=>{
  const providers={saramin:{fetchedAt:ago(6)},jobkorea:{fetchedAt:ago(8),lastStartedAt:ago(2)},work24:{}};
  assert.deepEqual(duePortals(providers,now),['saramin','work24']);
  assert.deepEqual(duePortals(providers,now-1),['work24']);
  assert.equal(nextCheckAt(providers.jobkorea),now+4*3600000);
  assert.equal(nextCheckAt({fetchedAt:'잘못된 날짜'}),0);
});
test('실행 중인 조회와 자동 꺼짐은 건너뛰고 6시간 후 실제 수집 함수를 다시 호출한다',async()=>{
  let time=now,running=false,enabled=true;const providers={saramin:{fetchedAt:ago(7)}},calls=[];
  const tick=createAutoRefresh({providers:()=>providers,running:()=>running,enabled:()=>enabled,now:()=>time,collect:async ids=>{calls.push(ids);providers.saramin.lastStartedAt=new Date(time).toISOString();}});
  running=true;assert.equal(await tick(),false);running=false;enabled=false;assert.equal(await tick(),false);
  enabled=true;assert.equal(await tick(),true);assert.equal(await tick(),false);
  time+=REFRESH_INTERVAL_MS;assert.equal(await tick(),true);assert.equal(calls.length,2);
});
test('동시에 발생한 자동 확인은 한 번만 수집하고 실패 후에도 잠금이 풀린다',async()=>{
  let release,calls=0;const wait=new Promise(r=>release=r);
  const tick=createAutoRefresh({providers:()=>({work24:{}}),running:()=>false,enabled:()=>true,collect:async()=>{calls++;await wait;}});
  const pending=tick();assert.equal(await tick(),false);release();await pending;assert.equal(calls,1);
  const failing=createAutoRefresh({providers:()=>({work24:{}}),running:()=>false,enabled:()=>true,collect:async()=>{throw new Error('오류');}});
  await assert.rejects(failing(),/오류/);await assert.rejects(failing(),/오류/);
});
test('기존 배포 공고는 신규가 아니며 처음 발견한 공고만 7일 동안 표시한다',()=>{
  const old=job('saramin:old'),fresh=job('work24:new'),history=emptyDiscovery();
  recordDiscovery(history,[old],{},ago(0),true);recordDiscovery(history,[old,fresh],{},ago(0));
  let result=applyDiscovery([old,fresh],history,now);assert.equal(result[0].isNew,false);assert.equal(result[1].isNew,true);
  assert.equal(result[1].firstSeenAt,ago(0));assert.equal(applyDiscovery([fresh],history,now+NEW_WINDOW_MS)[0].isNew,false);
  recordDiscovery(history,[fresh],{},ago(-1));assert.equal(history.firstSeenById[fresh.id],ago(0));
});
test('나중에 추가된 같은 원문의 제휴 링크는 기존 공고를 신규로 만들지 않는다',()=>{
  const old=job('saramin:old'),affiliate=job('work24:new'),history=emptyDiscovery();
  recordDiscovery(history,[old],{},ago(0),true);
  recordDiscovery(history,[old,affiliate],{[affiliate.id]:{originId:old.id}},ago(0));
  const result=applyDiscovery([{...old,canonicalId:old.id},{...affiliate,canonicalId:old.id}],history,now);
  assert.equal(result.some(job=>job.isNew),false);assert.equal(groupJobs(result).length,1);
});
test('여러 사이트에서 발견한 새 원문은 한 신규 카드로 묶고 필터와 새로 발견한 순을 함께 적용한다',()=>{
  const raw=[job('saramin:a'),job('work24:b'),job('saramin:c')],details={'work24:b':{originId:'saramin:a'}},history=emptyDiscovery();
  recordDiscovery(history,raw.slice(0,2),details,ago(1));recordDiscovery(history,raw,details,ago(0));
  const result=applyDiscovery(raw.map(j=>({...j,canonicalId:details[j.id]?.originId||j.id})),history,now);
  const filtered=filterJobs(result,{portal:'all',region:'all',experience:'all',newOnly:true,sort:'newest'});
  assert.equal(filtered.length,2);assert.equal(filtered[0].id,'saramin:c');assert.equal(filtered[1].members.length,2);
  assert.equal(filterJobs(result,{portal:'work24',region:'all',experience:'all',newOnly:true}).length,1);
});
test('사라졌다가 다시 나타난 공고는 최초 발견 날짜를 유지한다',()=>{
  const raw=[job('work24:old')],history=emptyDiscovery();recordDiscovery(history,raw,{},ago(240));
  recordDiscovery(history,[],{},ago(0));recordDiscovery(history,raw,{},ago(0));
  assert.equal(applyDiscovery(raw,history,now)[0].isNew,false);assert.equal(history.firstSeenById[raw[0].id],ago(240));
});
