import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserApi,STORAGE_KEY,manualJob} from '../public/browser-store.js';
import {publicJob,publicSnapshot} from '../lib/publication.mjs';
import {groupJobs} from '../public/model.js';
import {locationReason} from '../public/features.js';
const at=Date.parse('2026-10-22T03:00:00Z');
const base=(id='saramin:999123456',extra={})=>({id,canonicalId:id,portal:'saramin',url:'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=999123456',company:'공개 회사',title:'고졸 생산직',education:'고졸↑',regions:['홍성군'],sites:[],expiresAt:null,firstSeenAt:'2026-10-22T02:00:00Z',...extra});
function fixture(){
  let clock=at;const requests=[],memory=new Map(),storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
  let jobs={jobs:[base()],providers:[],historyCount:0},history={initializedAt:'2026-10-22T02:00:00Z',events:[],archived:[]};
  const manifest={schema:1,jobs:'/data/jobs-1111111111111111.json',history:'/data/history-2222222222222222.json',publication:{updatesEnabled:false}};
  const fetcher=async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>structuredClone(path.endsWith('manifest.json')?manifest:path.includes('jobs-')?jobs:history)};};
  let version=3;return {storage,memory,requests,make:()=>createBrowserApi({storage,fetcher,now:()=>clock}),setJobs:value=>{jobs={...jobs,jobs:value};manifest.jobs=`/data/jobs-${String(version++).padStart(16,'0')}.json`;},setHistory:value=>history=value,setClock:value=>clock=value};
}
test('관심·메모·학력 검색은 브라우저에만 저장되며 다시 열어도 유지되고 네트워크로 전송되지 않는다',async()=>{
  const f=fixture(),api=f.make();await api('/api/jobs');
  for(const data of [{action:'visit'},{action:'favorite',id:base().id,saved:true},{action:'application',id:base().id,stage:'planned',note:'나만 보는 메모 <script>unsafe()</script>'},{action:'save-search',name:'고졸 기준',filters:{education:['any','high','high']}}])await api('/api/personal',data);
  const reopened=f.make(),data=await reopened('/api/jobs');assert.equal(data.personal.applications[base().id].note,'나만 보는 메모 <script>unsafe()</script>');assert.deepEqual(data.personal.searches[0].filters.education,['any','high']);assert.deepEqual(data.personal.savedIds,[base().id]);
  assert.ok(f.requests.every(request=>request.options.body===undefined&&request.options.method===undefined));assert.ok(f.requests.every(request=>request.path.startsWith('/data/')));
});
test('원문이 사라져도 관심공고의 공개 정보와 내 메모를 이 브라우저에서 관리한다',async()=>{
  const f=fixture(),api=f.make();await api('/api/jobs');await api('/api/personal',{action:'favorite',id:base().id,saved:true});await api('/api/personal',{action:'application',id:base().id,stage:'interview',note:'면접 일정'});
  f.setJobs([]);await api('/api/refresh',{});const history=await api('/api/history');assert.equal(history.archived.length,1);assert.match(history.archived[0].archiveReason,/마감 여부 미확인/);
  await api('/api/personal',{action:'application',id:base().id,stage:'result',note:'결과 대기'});assert.equal((await api('/api/jobs')).personal.applications[base().id].note,'결과 대기');
});
test('게시 뒤 마감 시간이 지나면 화면에서 제외하고 관리 목록에서는 마감일 경과로 구분한다',async()=>{
  const f=fixture();f.setJobs([base(undefined,{expiresAt:'2026-10-22T04:00:00Z'})]);const api=f.make();await api('/api/jobs');await api('/api/personal',{action:'favorite',id:base().id,saved:true});f.setClock(Date.parse('2026-10-22T05:00:00Z'));
  assert.equal((await api('/api/jobs')).jobs.length,0);assert.equal((await api('/api/history')).archived[0].archiveReason,'마감일 경과');
});
test('개인 공고 등록과 근무지 지정은 브라우저 안에만 적용하고 잘못된 주소·링크를 거부한다',async()=>{
  const f=fixture(),api=f.make();await api('/api/jobs');let data=await api('/api/manual',{url:'https://www.jobkorea.co.kr/Recruit/GI_Read/999000',company:'직접 확인',title:'등록 공고',region:'홍성군'});assert.equal(data.jobs.length,2);
  data=await api('/api/location',{id:'jobkorea:999000',address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});assert.equal(data.jobs.find(job=>job.id==='jobkorea:999000').sites.length,1);
  await assert.rejects(api('/api/location',{id:'jobkorea:999000',address:'홍성군 산단2길 3층',lat:36.58,lng:126.66}),/정확한/);
  assert.throws(()=>manualJob({url:'https://evil.test/123'}),/공고 상세/);assert.throws(()=>manualJob({url:'javascript:alert(1)'}),/HTTPS/);
});
test('다른 브라우저의 메모는 독립적이며 저장 실패·손상 기록을 성공으로 처리하거나 덮지 않는다',async()=>{
  const f=fixture(),api=f.make();await api('/api/jobs');await api('/api/personal',{action:'favorite',id:base().id,saved:true});assert.equal((await fixture().make()('/api/jobs')).personal.savedIds.length,0);
  const original=f.storage.getItem(STORAGE_KEY);f.storage.setItem=()=>{throw new Error('quota');};await assert.rejects(api('/api/personal',{action:'application',id:base().id,stage:'planned',note:'저장 실패'}),/저장하지 못/);assert.equal(f.storage.getItem(STORAGE_KEY),original);
  f.memory.set(STORAGE_KEY,'bad-json');await assert.rejects(api('/api/jobs'),/덮어쓰지/);assert.equal(f.memory.get(STORAGE_KEY),'bad-json');
});
test('새 사이트 자료를 불러와도 같은 제휴 공고의 관심과 메모가 원문 키로 연결된다',async()=>{
  const f=fixture(),api=f.make();await api('/api/jobs');await api('/api/personal',{action:'favorite',id:base().id,saved:true});
  f.setJobs([base(undefined,{canonicalId:'work24:VALIDATION:KTEST'})]);await api('/api/refresh',{});await api('/api/personal',{action:'read',id:base().id});assert.deepEqual((await api('/api/jobs')).personal.savedIds,['work24:VALIDATION:KTEST']);
});
test('대표 원문이 바뀌어도 새로고침 직후 관심과 지원 메모를 보여 준다',async()=>{
  const f=fixture(),api=f.make(),old=base().id,next='work24:VALIDATION:KTEST';
  await api('/api/jobs');await api('/api/personal',{action:'favorite',id:old,saved:true});await api('/api/personal',{action:'application',id:old,stage:'planned',note:'연락할 곳'});
  f.setJobs([base(old,{canonicalId:next})]);const data=await api('/api/refresh',{});
  assert.deepEqual(data.personal.savedIds,[next]);assert.equal(data.personal.applications[next].note,'연락할 곳');
  const reopened=await f.make()('/api/jobs');assert.deepEqual(reopened.personal.savedIds,[next]);assert.equal(reopened.personal.applications[next].note,'연락할 곳');
});
test('대표 원문이 바뀌어도 직접 지정한 근무지와 수정한 위치가 유지된다',async()=>{
  const f=fixture(),api=f.make(),old=base().id,next='work24:VALIDATION:KTEST';await api('/api/jobs');
  await api('/api/location',{id:old,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});
  f.setJobs([base(old,{canonicalId:next})]);let data=await api('/api/refresh',{});assert.equal(data.jobs[0].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 19');
  await api('/api/location',{id:old,address:'충남 홍성군 홍성읍 대학1길 21',lat:36.59,lng:126.67});data=await f.make()('/api/jobs');assert.equal(data.jobs[0].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 21');
});
test('이전 대표 원문이 사라져도 공통 공고가 있으면 관심·메모·위치를 연결한다',async()=>{
  const f=fixture(),api=f.make(),id=base().id,old='work24:VALIDATION:OLD',next='work24:VALIDATION:NEW';
  f.setJobs([base(id,{canonicalId:old})]);await api('/api/jobs');await api('/api/personal',{action:'favorite',id,saved:true});
  await api('/api/personal',{action:'application',id,stage:'interview',note:'면접 일정'});
  await api('/api/location',{id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});
  f.setJobs([base(id,{canonicalId:next})]);
  const data=await f.make()('/api/jobs');assert.deepEqual(data.personal.savedIds,[next]);assert.equal(data.personal.applications[next].note,'면접 일정');assert.equal(data.jobs[0].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 19');
});
test('분리된 원문의 과거 관심과 메모는 관리 기록에서 보존한다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11',{canonicalId:'old'}),b=base('saramin:22',{canonicalId:'old'});
  f.setJobs([a,b]);await api('/api/jobs');await api('/api/personal',{action:'favorite',id:a.id,saved:true});await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'분리 전 메모'});
  f.setJobs([{...a,canonicalId:'new-a'},{...b,canonicalId:'new-b'}]);const data=await api('/api/refresh',{}),history=await api('/api/history');
  const key=data.personal.savedIds[0];assert.equal(data.personal.applications[key].note,'분리 전 메모');assert.ok(history.archived.some(job=>job.canonicalId===key));
});
test('대표 원문이 다시 돌아와도 마지막에 고친 근무지를 사용한다',async()=>{
  const f=fixture(),api=f.make(),id=base().id,next='work24:VALIDATION:KTEST';await api('/api/jobs');
  await api('/api/location',{id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});
  f.setJobs([base(id,{canonicalId:next})]);await api('/api/refresh',{});await api('/api/location',{id,address:'충남 홍성군 홍성읍 대학1길 21',lat:36.59,lng:126.67});
  f.setJobs([base(id)]);assert.equal((await api('/api/refresh',{})).jobs[0].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 21');
});
test('직접 등록한 원문이 공개 목록에 포함되어도 관심과 위치가 유지된다',async()=>{
  const f=fixture(),api=f.make(),id='jobkorea:999000',next='work24:VALIDATION:KTEST';await api('/api/jobs');
  await api('/api/manual',{url:'https://www.jobkorea.co.kr/Recruit/GI_Read/999000',company:'직접 확인',title:'등록 공고',region:'홍성군'});
  await api('/api/personal',{action:'favorite',id,saved:true});await api('/api/location',{id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});
  f.setJobs([base(id,{canonicalId:next,portal:'jobkorea'})]);const data=await api('/api/refresh',{});assert.deepEqual(data.personal.savedIds,[next]);assert.equal(data.jobs[0].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 19');
});
test('서로 다른 위치의 원문이 합쳐지면 위치를 섞지 않고 충돌로 표시한다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22'),next='work24:VALIDATION:KTEST';f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});await api('/api/location',{id:b.id,address:'충남 홍성군 홍성읍 대학1길 21',lat:36.59,lng:126.67});
  f.setJobs([{...a,canonicalId:next},{...b,canonicalId:next}]);const data=await api('/api/refresh',{});assert.equal(data.jobs[0].sites[0].address,'충남 홍성군 홍성읍 대학1길 19');assert.equal(data.jobs[1].sites[0].address,'충남 홍성군 홍성읍 대학1길 21');assert.ok(data.jobs.every(job=>job.coordinateConflict));assert.equal(locationReason(groupJobs(data.jobs)[0]),'conflict');
});
test('분리된 원문 하나가 마감돼도 이전 관심·메모를 관리할 수 있다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11',{canonicalId:'old'}),b=base('saramin:22',{canonicalId:'old'});f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/personal',{action:'favorite',id:a.id,saved:true});await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'기록 유지'});
  f.setJobs([{...a,canonicalId:'new-a'},{...b,canonicalId:'new-b',closed:true}]);const data=await api('/api/refresh',{}),history=await api('/api/history');assert.ok(history.archived.some(job=>job.canonicalId===data.personal.savedIds[0]));
});
test('충돌 중 위치를 수정해도 다른 원문의 기존 위치를 보존한다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22'),next='work24:VALIDATION:KTEST';f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});await api('/api/location',{id:b.id,address:'충남 홍성군 홍성읍 대학1길 21',lat:36.59,lng:126.67});
  f.setJobs([{...a,canonicalId:next},{...b,canonicalId:next}]);await api('/api/refresh',{});await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});
  f.setJobs([a,b]);const data=await api('/api/refresh',{});assert.equal(data.jobs[1].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 21');
});
test('이전 대표 키로 저장한 서로 다른 위치도 병합 후 각각 볼 수 있다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11',{canonicalId:'old-a'}),b=base('saramin:22',{canonicalId:'old-b'}),next='work24:VALIDATION:KTEST';f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});await api('/api/location',{id:b.id,address:'충남 홍성군 홍성읍 대학1길 21',lat:36.59,lng:126.67});
  f.setJobs([{...a,canonicalId:next},{...b,canonicalId:next}]);const data=await api('/api/refresh',{});assert.equal(data.jobs[0].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 19');assert.equal(data.jobs[1].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 21');
});
test('충돌 중 한 원문의 위치를 수정하거나 읽어도 다른 위치를 보존한다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22');f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});await api('/api/location',{id:b.id,address:'충남 홍성군 홍성읍 대학1길 21',lat:36.59,lng:126.67});
  f.setJobs([a,{...b,canonicalId:a.id}]);await api('/api/refresh',{});await api('/api/personal',{action:'read',id:a.id});
  let data=await api('/api/jobs');assert.equal(data.jobs[1].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 21');
  await api('/api/location',{id:b.id,address:'충남 홍성군 홍성읍 대학1길 23',lat:36.6,lng:126.68});f.setJobs([a,b]);data=await api('/api/refresh',{});
  assert.equal(data.jobs[0].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 19');assert.equal(data.jobs[1].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 23');
});
test('위치만 지정한 공고가 분리되면 이전 위치를 확인 대상으로 보관한다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11',{canonicalId:'old'}),b=base('saramin:22',{canonicalId:'old'});f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});
  f.setJobs([{...a,canonicalId:'new-a'},{...b,canonicalId:'new-b'}]);const data=await api('/api/refresh',{}),history=await api('/api/history');
  const key=data.unlinkedLocationIds[0];assert.ok(key);assert.equal(history.archived.find(job=>job.canonicalId===key)?.sites[0]?.address,'충남 홍성군 홍성읍 대학1길 19');
});
test('병합한 공고의 현재 메모를 지워도 과거 원문의 메모는 보존한다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22'),next='work24:VALIDATION:KTEST';f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'이전 공고 메모'});f.setClock(at+1000);await api('/api/personal',{action:'application',id:b.id,stage:'interview',note:'현재 공고 메모'});
  f.setJobs([{...a,canonicalId:next},{...b,canonicalId:next}]);await api('/api/refresh',{});
  await api('/api/personal',{action:'application',id:a.id,stage:'',note:''});const data=await api('/api/jobs');
  const entry=data.personal.applications[next];assert.ok(entry?.note==='이전 공고 메모'||entry?.previousNotes?.some(item=>item.note==='이전 공고 메모'));
});
test('묶인 공고에서 보이는 메모를 수정해도 다른 원문의 메모를 덮지 않는다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22');f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'A 원본'});f.setClock(at+1000);await api('/api/personal',{action:'application',id:b.id,stage:'interview',note:'B 원본'});
  f.setJobs([a,{...b,canonicalId:a.id}]);const merged=await api('/api/refresh',{});assert.equal(merged.personal.applications[a.id].note,'B 원본');f.setClock(at+2000);
  await api('/api/personal',{action:'application',id:a.id,stage:'interview',note:'B 수정'});f.setJobs([a,b]);const data=await api('/api/refresh',{});
  assert.equal(data.personal.applications[a.id].note,'A 원본');assert.equal(data.personal.applications[b.id].note,'B 수정');
});
test('수정 창을 연 뒤 원본 메모가 바뀌면 다른 원문을 덮어쓰지 않는다',async()=>{
  const f=fixture(),api=f.make(),other=f.make(),a=base('saramin:11'),b=base('saramin:22');f.setJobs([a,b]);await api('/api/jobs');await other('/api/jobs');
  await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'A 원본'});f.setClock(at+1000);await api('/api/personal',{action:'application',id:b.id,stage:'interview',note:'B 원본'});
  f.setJobs([a,{...b,canonicalId:a.id}]);const shown=await api('/api/refresh',{}),sourceId=shown.personal.applications[a.id].sourceId;assert.equal(sourceId,b.id);
  f.setClock(at+2000);await other('/api/personal',{action:'application',id:a.id,stage:'planned',note:'다른 창의 A 수정'});f.setClock(at+3000);
  await assert.rejects(api('/api/personal',{action:'application',id:a.id,sourceId,stage:'interview',note:'B 수정'}),/다시/);
});
test('다른 창에서 같은 메모가 바뀌면 이전 내용으로 덮어쓰지 않는다',async()=>{
  const f=fixture(),api=f.make(),other=f.make(),id=base().id;await api('/api/jobs');await other('/api/jobs');await api('/api/personal',{action:'application',id,stage:'planned',note:'처음'});
  const shown=(await api('/api/jobs')).personal.applications[id];f.setClock(at+1000);await other('/api/personal',{action:'application',id,stage:'interview',note:'다른 창 수정'});f.setClock(at+2000);
  await assert.rejects(api('/api/personal',{action:'application',id,sourceId:shown.sourceId,sourceUpdatedAt:shown.sourceUpdatedAt,stage:'planned',note:'이전 창 수정'}),/다시/);
});
test('같은 시각에 다른 창이 메모를 수정해도 이전 내용으로 덮어쓰지 않는다',async()=>{
  const f=fixture(),api=f.make(),other=f.make(),id=base().id;await api('/api/jobs');await other('/api/jobs');await api('/api/personal',{action:'application',id,stage:'planned',note:'처음'});
  const shown=(await api('/api/jobs')).personal.applications[id];await other('/api/personal',{action:'application',id,stage:'interview',note:'다른 창 수정'});
  await assert.rejects(api('/api/personal',{action:'application',id,sourceId:shown.sourceId,sourceUpdatedAt:shown.sourceUpdatedAt,sourceVersion:shown.sourceVersion,stage:'planned',note:'이전 창 수정'}),/다시/);
});
test('대표 원문이 실제 공고인 묶음이 분리돼도 기존 기록을 임의로 연결하지 않는다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22',{canonicalId:a.id});f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/personal',{action:'favorite',id:a.id,saved:true});await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'분리 전 메모'});
  await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});
  f.setJobs([a,{...b,canonicalId:b.id}]);let data=await api('/api/refresh',{});const detached=data.personal.savedIds[0];
  assert.notEqual(detached,a.id);assert.equal(data.jobs[0].sites.length,0);assert.equal(data.personal.applications[detached].note,'분리 전 메모');
  let history=await api('/api/history');assert.equal(history.archived.find(job=>job.canonicalId===detached)?.sites[0]?.address,'충남 홍성군 홍성읍 대학1길 19');
  await api('/api/personal',{action:'read',id:b.id});data=await api('/api/jobs');history=await api('/api/history');assert.ok(data.personal.savedIds.includes(detached));assert.ok(history.archived.some(job=>job.canonicalId===detached));
  f.setJobs([a,b]);data=await api('/api/refresh',{});history=await api('/api/history');assert.ok(data.personal.savedIds.includes(detached));assert.equal(data.personal.applications[detached].note,'분리 전 메모');assert.equal(history.archived.find(job=>job.canonicalId===detached)?.sites[0]?.address,'충남 홍성군 홍성읍 대학1길 19');
});
test('분리 후 마감된 공고의 메모는 다른 활성 공고로 옮겨지지 않는다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22',{canonicalId:a.id});f.setJobs([a,b]);await api('/api/jobs');await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'그룹 메모'});
  f.setJobs([a,{...b,canonicalId:b.id,closed:true}]);await api('/api/refresh',{});await api('/api/personal',{action:'application',id:b.id,stage:'interview',note:'마감 공고 메모'});await api('/api/personal',{action:'visit'});
  const data=await api('/api/jobs');assert.equal(data.personal.applications[b.id]?.note,'마감 공고 메모');assert.notEqual(data.personal.applications[a.id]?.note,'마감 공고 메모');
});
test('분리된 공고가 모두 사라져도 보관한 위치를 다시 확인할 수 있다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22',{canonicalId:a.id});f.setJobs([a,b]);await api('/api/jobs');await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});
  f.setJobs([a,{...b,canonicalId:b.id}]);await api('/api/refresh',{});await api('/api/personal',{action:'visit'});f.setJobs([]);const data=await api('/api/refresh',{}),history=await api('/api/history');
  assert.ok(data.unlinkedLocationIds.some(key=>history.archived.some(job=>job.canonicalId===key&&job.sites.some(site=>site.address==='충남 홍성군 홍성읍 대학1길 19'))));
});
test('같은 메모여도 합쳐진 공고의 다른 지원 상태를 보관한다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22');f.setJobs([a,b]);await api('/api/jobs');await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'연락'});f.setClock(at+1000);await api('/api/personal',{action:'application',id:b.id,stage:'interview',note:'연락'});
  f.setJobs([a,{...b,canonicalId:a.id}]);await api('/api/refresh',{});await api('/api/personal',{action:'visit'});const data=await api('/api/jobs');assert.ok(data.personal.applications[a.id].previousNotes.some(entry=>entry.stage==='planned'));
});
test('구성원이 아닌 대표의 분리 기록과 이후 개별 기록을 재결합해도 섞지 않는다',async()=>{
  const f=fixture(),api=f.make(),old='work24:VALIDATION:OLD',a=base('saramin:11',{canonicalId:old}),b=base('saramin:22',{canonicalId:old});f.setJobs([a,b]);await api('/api/jobs');await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'그룹 기록'});
  f.setJobs([{...a,canonicalId:a.id},{...b,canonicalId:b.id}]);await api('/api/refresh',{});await api('/api/personal',{action:'application',id:a.id,stage:'interview',note:'개별 기록'});
  f.setJobs([a,b]);const data=await api('/api/refresh',{});assert.ok(Object.values(data.personal.applications).some(entry=>entry.note==='그룹 기록'));assert.ok(Object.values(data.personal.applications).some(entry=>entry.note==='개별 기록'));
});
test('목록에서 사라진 개별 공고의 메모를 과거 묶음의 다른 원문에 옮기지 않는다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22');f.setJobs([a,b]);await api('/api/jobs');await api('/api/location',{id:b.id,address:'충남 홍성군 홍성읍 대학1길 21',lat:36.59,lng:126.67});
  f.setJobs([a,{...b,canonicalId:a.id}]);await api('/api/refresh',{});await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'그룹 메모'});
  f.setJobs([a,b]);await api('/api/refresh',{});await api('/api/personal',{action:'application',id:b.id,stage:'interview',note:'개별 메모'});
  f.setJobs([a]);await api('/api/refresh',{});await api('/api/personal',{action:'visit'});const data=await api('/api/jobs');assert.equal(data.personal.applications[b.id]?.note,'개별 메모');assert.notEqual(data.personal.applications[a.id]?.note,'개별 메모');
});
test('분리 상태를 조회한 뒤 별도 저장 없이 재결합해도 보관 기록을 유지한다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22',{canonicalId:a.id});f.setJobs([a,b]);await api('/api/jobs');await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'분리 전 기록'});
  f.setJobs([a,{...b,canonicalId:b.id}]);const split=await api('/api/refresh',{}),key=Object.keys(split.personal.applications)[0];assert.notEqual(key,a.id);
  f.setJobs([a,b]);const data=await api('/api/refresh',{});assert.equal(data.personal.applications[key]?.note,'분리 전 기록');assert.equal(data.personal.applications[a.id],undefined);
});
for(const action of [null,'visit','read'])test(`목록 병합을 확인한 뒤 ${action||'추가 저장 없이'} 분리해도 원래 기록을 보존한다`,async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22');f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'A 메모'});f.setClock(at+1000);await api('/api/personal',{action:'application',id:b.id,stage:'interview',note:'B 메모'});
  await api('/api/location',{id:b.id,address:'충남 홍성군 홍성읍 대학1길 21',lat:36.59,lng:126.67});f.setJobs([a,{...b,canonicalId:a.id}]);await api('/api/refresh',{});if(action)await api('/api/personal',{action,id:a.id});
  f.setJobs([a,b]);const data=await api('/api/refresh',{});assert.equal(data.personal.applications[a.id]?.note,'A 메모');assert.equal(data.personal.applications[b.id]?.note,'B 메모');assert.equal(data.jobs[0].sites.length,0);assert.equal(data.jobs[1].sites[0]?.address,'충남 홍성군 홍성읍 대학1길 21');
});
test('분리된 묶음의 일부 원문만 남으면 이전 기록을 임의로 다시 연결하지 않는다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22',{canonicalId:a.id});f.setJobs([a,b]);await api('/api/jobs');await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'기존 묶음'});
  f.setJobs([a,{...b,canonicalId:b.id}]);await api('/api/refresh',{});await api('/api/personal',{action:'read',id:b.id});
  f.setJobs([a]);const data=await api('/api/refresh',{});assert.equal(data.personal.applications[a.id],undefined);assert.ok(Object.values(data.personal.applications).some(entry=>entry.note==='기존 묶음'));
});
test('분리와 다른 원문의 병합이 동시에 일어나도 메모가 서로 섞이지 않는다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22',{canonicalId:a.id}),c=base('saramin:33');f.setJobs([a,b,c]);await api('/api/jobs');
  await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'기존 묶음 메모'});await api('/api/personal',{action:'application',id:c.id,stage:'interview',note:'다른 공고 메모'});
  f.setJobs([a,{...b,canonicalId:b.id},{...c,canonicalId:a.id}]);const data=await api('/api/refresh',{});
  assert.equal(data.personal.applications[a.id]?.note,'다른 공고 메모');assert.ok(Object.entries(data.personal.applications).some(([key,entry])=>key!==a.id&&entry.note==='기존 묶음 메모'));
});
test('같은 대표의 서로 다른 묶음이 반복 분리돼도 이전 위치와 메모를 모두 보존한다',async()=>{
  const f=fixture(),api=f.make(),a=base('saramin:11'),b=base('saramin:22',{canonicalId:a.id}),c=base('saramin:33',{canonicalId:a.id});f.setJobs([a,b]);await api('/api/jobs');
  await api('/api/personal',{action:'application',id:a.id,stage:'planned',note:'첫 번째 묶음'});await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 19',lat:36.58,lng:126.66});
  f.setJobs([a,{...b,canonicalId:b.id}]);await api('/api/refresh',{});await api('/api/personal',{action:'read',id:b.id});
  f.setJobs([a,c]);await api('/api/refresh',{});await api('/api/personal',{action:'application',id:a.id,stage:'interview',note:'두 번째 묶음'});await api('/api/location',{id:a.id,address:'충남 홍성군 홍성읍 대학1길 21',lat:36.59,lng:126.67});
  f.setJobs([a,{...c,canonicalId:c.id}]);await api('/api/refresh',{});await api('/api/personal',{action:'read',id:c.id});const data=await api('/api/jobs'),history=await api('/api/history');
  assert.ok(Object.values(data.personal.applications).some(entry=>entry.note==='첫 번째 묶음'));assert.ok(Object.values(data.personal.applications).some(entry=>entry.note==='두 번째 묶음'));
  const addresses=history.archived.flatMap(job=>job.sites.map(site=>site.address));assert.ok(addresses.includes('충남 홍성군 홍성읍 대학1길 19'));assert.ok(addresses.includes('충남 홍성군 홍성읍 대학1길 21'));
});
test('공개 배포는 개인 기록·원치 않는 필드·직접 지정 위치를 내보내지 않는다',()=>{
  const raw=base(undefined,{note:'비공개',personal:{note:'비공개'},sites:[{address:'주소',lat:36.6,lng:126.7,source:'직접 확인한 근무지'},{address:'원문 주소',lat:36.6,lng:126.7,source:'사람인 근무지',secret:'비공개'}]});
  const out=publicJob(raw);assert.equal(out.note,undefined);assert.equal(out.personal,undefined);assert.equal(out.sites.length,1);assert.equal(out.sites[0].secret,undefined);
  const snapshot=publicSnapshot({store:{jobs:[raw,base('saramin:2',{manual:true})],providers:{}},details:{},discovery:{firstSeenById:{},firstSeenByCanonical:{}},history:null,config:{},now:at});assert.equal(snapshot.jobs.jobs.length,1);assert.equal(snapshot.jobs.personal,undefined);assert.ok(!JSON.stringify(snapshot).includes('비공개'));
});
