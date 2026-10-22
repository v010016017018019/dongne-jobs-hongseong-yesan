import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserApi,STORAGE_KEY,manualJob} from '../public/browser-store.js';
import {publicJob,publicSnapshot} from '../lib/publication.mjs';
const at=Date.parse('2026-10-22T03:00:00Z');
const base=(id='saramin:999123456',extra={})=>({id,canonicalId:id,portal:'saramin',url:'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=999123456',company:'공개 회사',title:'고졸 생산직',education:'고졸↑',regions:['홍성군'],sites:[],expiresAt:null,firstSeenAt:'2026-10-22T02:00:00Z',...extra});
function fixture(){
  let clock=at;const requests=[],memory=new Map(),storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
  let jobs={jobs:[base()],providers:[],historyCount:0},history={initializedAt:'2026-10-22T02:00:00Z',events:[],archived:[]};
  const manifest={schema:1,jobs:'/data/jobs-1111111111111111.json',history:'/data/history-2222222222222222.json',publication:{updatesEnabled:false}};
  const fetcher=async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>structuredClone(path.endsWith('manifest.json')?manifest:path.includes('jobs-')?jobs:history)};};
  return {storage,memory,requests,make:()=>createBrowserApi({storage,fetcher,now:()=>clock}),setJobs:value=>{jobs={...jobs,jobs:value};manifest.jobs='/data/jobs-3333333333333333.json';},setHistory:value=>history=value,setClock:value=>clock=value};
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
test('공개 배포는 개인 기록·원치 않는 필드·직접 지정 위치를 내보내지 않는다',()=>{
  const raw=base(undefined,{note:'비공개',personal:{note:'비공개'},sites:[{address:'주소',lat:36.6,lng:126.7,source:'직접 확인한 근무지'},{address:'원문 주소',lat:36.6,lng:126.7,source:'사람인 근무지',secret:'비공개'}]});
  const out=publicJob(raw);assert.equal(out.note,undefined);assert.equal(out.personal,undefined);assert.equal(out.sites.length,1);assert.equal(out.sites[0].secret,undefined);
  const snapshot=publicSnapshot({store:{jobs:[raw,base('saramin:2',{manual:true})],providers:{}},details:{},discovery:{firstSeenById:{},firstSeenByCanonical:{}},history:null,config:{},now:at});assert.equal(snapshot.jobs.jobs.length,1);assert.equal(snapshot.jobs.personal,undefined);assert.ok(!JSON.stringify(snapshot).includes('비공개'));
});
