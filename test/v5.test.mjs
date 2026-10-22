import test from 'node:test';
import assert from 'node:assert/strict';
import {payInfo,payMatches,employmentKinds,employmentText,conditionTags,featureMatches,locationReason,sanitizeSearch} from '../public/features.js';
import {emptyPersonal,updatePersonal,canonicalizePersonal} from '../lib/personal.mjs';
import {historyRows,emptyHistory,reconcileHistory,archivedJobs} from '../lib/history.mjs';
import {publicFacts} from '../lib/facts.mjs';
import {filterJobs} from '../public/model.js';
const at='2026-10-20T03:00:00Z',later='2026-10-20T05:00:00Z';
const base=(id='work24:1',extra={})=>({id,canonicalId:id,portal:'work24',title:'생산직',company:'검증 회사',regions:['홍성군'],sites:[],url:'https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=KTEST&infoTypeCd=VALIDATION',expiresAt:null,...extra});
test('급여 범위의 하한과 단위를 보존하고 월급·연봉·시급을 환산하지 않는다',()=>{
  assert.deepEqual([payInfo('연봉 3,300~4,300만원(면접 후 협의)').min,payInfo('연봉 3,300~4,300만원').max],[33000000,43000000]);
  assert.equal(payInfo('월급 2,160,000원 이상').min,2160000);assert.equal(payInfo('월급 250.5만원').min,2505000);
  assert.equal(payMatches('월급 250~350만원',{payPeriod:'month',payMin:3000000}),false);
  assert.equal(payMatches('연봉 3600만원',{payPeriod:'month',payMin:2000000}),false);
  assert.equal(payInfo('급여 협의').min,null);assert.equal(payMatches('급여 협의',{payPeriod:'negotiable'}),true);assert.equal(payMatches('',{payPeriod:'missing'}),true);
  assert.equal(payInfo('월급 250').min,null);assert.equal(payInfo('월급 350~250만원').min,null);
  assert.equal(payInfo('월급 300만원 이하').min,null);assert.equal(payMatches('월급 300만원 이하',{payPeriod:'month',payMin:2500000}),false);
});
test('상근을 정규직으로 오인하지 않고 기간 제한 계약과 시간제를 구분한다',()=>{
  assert.deepEqual(employmentKinds('FULL_TIME'),[]);assert.equal(employmentText('FULL_TIME'),'상근');
  assert.ok(employmentKinds('기간의 정함이 없는 근로계약').includes('regular'));
  assert.deepEqual(employmentKinds('기간의 정함이 있는 근로계약 (시간제)'),['contract','part']);
});
test('근무조건은 원문 근거를 보존하고 미제공·없음 안내를 긍정 조건으로 표시하지 않는다',()=>{
  assert.deepEqual(conditionTags('주간고정 / 기숙사 제공 / 통근버스 운행').map(tag=>tag.id),['day','dorm','bus']);
  assert.equal(conditionTags('기숙사 미제공 / 통근버스 없음').length,0);
  assert.equal(conditionTags('기숙사 제공, 통근버스 없음').some(tag=>tag.id==='dorm'),true);
  assert.ok(conditionTags('야간근무')[0].evidence.includes('야간근무'));
});
test('상세정보의 급여·고용형태만 추출하며 퇴직급여·사이트 메뉴를 급여로 사용하지 않는다',()=>{
  const html='<nav>기숙사 제공 통근버스 운행</nav><table><tr><th>임금 조건</th><td>월급 216만원 이상</td></tr><tr><th>퇴직급여</th><td>퇴직금</td></tr><tr><th>고용형태</th><td>기간의 정함이 없는 근로계약</td></tr><tr><th>근무시간</th><td>주간근무</td></tr></table>';
  const facts=publicFacts(base(),html);assert.equal(facts.salary,'월급 216만원 이상');assert.match(facts.employment,/없는/);assert.deepEqual(facts.conditions.map(tag=>tag.id),['day']);assert.equal(publicFacts(base(),'<nav>급여 9999만원</nav>').salary,undefined);
  const linked=publicFacts(base(),'<script type="application/ld+json">{"@type":"JobPosting","employmentType":"FULL_TIME","baseSalary":{"currency":"KRW","value":{"unitText":"YEAR","minValue":30000000,"maxValue":40000000}}}</script>');assert.equal(linked.salary,'연봉 30000000~40000000원');assert.equal(linked.employment,'FULL_TIME');
});
test('같은 제휴 묶음에서도 급여와 고용형태 조건은 같은 원문에서 함께 충족해야 한다',()=>{
  const a=base('work24:1',{salary:'월급 300만원',employment:'계약직'}),b=base('jobkorea:2',{canonicalId:a.id,portal:'jobkorea',salary:'월급 200만원',employment:'정규직'});
  const filter={portal:'all',region:'all',experience:'all',payPeriod:'month',payMin:2500000,employment:'regular'};
  assert.equal(filterJobs([a,b],filter).length,0);assert.equal(filterJobs([a,b],{...filter,payMin:2000000}).length,1);
});
test('방문 비교 기준은 새로고침에 흔들리지 않으며 첫 방문과 읽음 필터를 구분한다',()=>{
  let personal=emptyPersonal();personal=updatePersonal(personal,{action:'visit'},null,at);assert.equal(personal.visit.previousAt,null);
  personal=updatePersonal(personal,{action:'visit'},null,'2026-10-20T03:05:00Z');assert.equal(personal.visit.currentAt,at);
  personal=updatePersonal(personal,{action:'visit'},null,later);assert.equal(personal.visit.previousAt,at);
  const job=base(undefined,{firstSeenAt:'2026-10-20T04:00:00Z'});assert.equal(featureMatches(job,{sinceVisit:true},personal),true);
  personal=updatePersonal(personal,{action:'read'},job,later);assert.equal(featureMatches(job,{unreadOnly:true},personal),false);
  personal=updatePersonal(personal,{action:'read',read:false},job,later);assert.equal(featureMatches(job,{unreadOnly:true},personal),true);
});
test('검색 조건은 허용 필드만 보관하고 민감한 메모나 전체 공고를 함께 저장하지 않는다',()=>{
  const filters=sanitizeSearch({query:'생산',region:'홍성군',payPeriod:'month',payMin:2500000,radius:'all',reference:{lat:36.6,lng:126.6},data:{secret:'메모'},selected:'abc',sort:'distance'});
  assert.equal(filters.data,undefined);assert.equal(filters.selected,undefined);assert.equal(filters.radius,'all');assert.equal(filters.reference.lat,36.6);assert.equal(sanitizeSearch({sort:'distance'}).sort,'default');
  let personal=updatePersonal(emptyPersonal(),{action:'save-search',name:'홍성 생산직',filters},null,at);assert.equal(personal.searches.length,1);const id=personal.activeSearchId;
  personal=updatePersonal(personal,{action:'save-search',name:'홍성 생산직',filters:{query:'검사'}},null,later);assert.equal(personal.searches.length,1);assert.equal(personal.activeSearchId,id);
  personal=updatePersonal(personal,{action:'delete-search',id},null,later);assert.equal(personal.activeSearchId,null);
});
test('지원 메모와 상태는 같은 원문 키에 저장하고 미지정 필터·입력 제한을 적용한다',()=>{
  const job=base('jobkorea:2',{canonicalId:'work24:1'});let personal=updatePersonal(emptyPersonal(),{action:'application',stage:'interview',note:'금요일 면접\n급여 확인'},job,at);
  assert.equal(personal.applications['work24:1'].note,'금요일 면접\n급여 확인');assert.equal(featureMatches(job,{applicationStage:'interview'},personal),true);assert.equal(featureMatches(job,{applicationStage:''},personal),false);
  assert.throws(()=>updatePersonal(personal,{action:'application',stage:'invalid'},job),/상태/);assert.throws(()=>updatePersonal(personal,{action:'application',stage:'applied',note:'x'.repeat(4001)},job),/4,000/);
  personal=updatePersonal(personal,{action:'application',stage:'',note:''},job);assert.equal(Object.keys(personal.applications).length,0);
});
test('위치 확인 대기열은 주소 부족·좌표 부족·충돌·지역 밖을 구분한다',()=>{
  assert.equal(locationReason(base()),'address');assert.equal(locationReason(base(undefined,{exactAddress:true})),'coordinates');assert.equal(locationReason(base(undefined,{coordinateConflict:true})),'conflict');assert.equal(locationReason(base(undefined,{locationStatus:'outside'})),'outside');assert.equal(locationReason(base(undefined,{sites:[{}]})),'verified');
  assert.equal(featureMatches(base(undefined,{exactAddress:true}),{locationReason:'coordinates'}),true);assert.equal(featureMatches(base(undefined,{sites:[{}]}),{locationReason:'needed'}),false);
});
test('변경 이력은 날짜·근무지·급여 변경을 남기고 단순 조회 시간 변경은 기록하지 않는다',()=>{
  const raw=[base(undefined,{salary:'월급 250만원',address:'충남 홍성군 홍성읍 대학1길 19'})],rows=historyRows(raw,{},{}),history=emptyHistory(rows,at);
  assert.equal(reconcileHistory(history,rows,later).addedEvents.length,0);
  const next=historyRows([{...raw[0],salary:'월급 280만원',address:'충남 홍성군 홍성읍 대학1길 20'}],{},{});const result=reconcileHistory(history,next,later);
  assert.deepEqual(result.addedEvents[0].changes.map(change=>change.field),['address','salary']);assert.equal(history.events.length,0);
  const blank=emptyHistory(historyRows([base()]),at);assert.equal(reconcileHistory(blank,historyRows([base(undefined,{salary:'월급 250만원'})]),later).addedEvents[0].type,'confirmed');
  assert.equal(reconcileHistory(history,historyRows([{...raw[0],salary:'월급 280만원',factsVersion:5}]),later).addedEvents[0].type,'confirmed');
});
test('목록에서 사라짐과 원문 마감을 구분하고 사라진 공고도 관리용 원문을 보존한다',()=>{
  const raw=[base()],history=emptyHistory(historyRows(raw),at),missing=reconcileHistory(history,[],later).history;
  assert.equal(missing.events[0].type,'missing');assert.match(archivedJobs(missing,[])[0].archiveReason,/마감 여부 미확인/);
  const closed=reconcileHistory(history,historyRows(raw,{[raw[0].id]:{closed:true}}),later).history;
  assert.equal(closed.events[0].type,'changed');assert.equal(archivedJobs(closed,[])[0].archiveReason,'원문 마감 확인');
  assert.equal(reconcileHistory(missing,historyRows(raw),later).addedEvents[0].type,'reappeared');
});
test('마감일 경과는 독립적으로 기록하며 90일이 지나도 지원 중인 공고 원문은 보관한다',()=>{
  const raw=[base(undefined,{expiresAt:'2026-10-20T04:00:00Z'})],history=emptyHistory(historyRows(raw,{}, {},Date.parse(at)),at);
  const result=reconcileHistory(history,historyRows(raw,{}, {},Date.parse(later)),later);assert.equal(result.addedEvents[0].changes[0].after,'deadline');
  const missing=reconcileHistory(history,[],later).history,after='2027-02-01T00:00:00Z';assert.ok(reconcileHistory(missing,[],after,['work24:1']).history.snapshots['work24:1']);assert.equal(reconcileHistory(missing,[],after).history.snapshots['work24:1'],undefined);
  assert.equal(archivedJobs(missing,[])[0].archiveReason,'마감일 경과');
  const removedBeforeDeadline=reconcileHistory(history,[],at).history;assert.equal(reconcileHistory(removedBeforeDeadline,[],later).addedEvents[0].changes[0].after,'deadline');
});
test('나중에 같은 원문임이 확인돼도 관심·읽음·지원 메모를 잃지 않고 한 키로 연결한다',()=>{
  const personal={...emptyPersonal(),savedIds:['a','b'],reads:{a:at,b:later},applications:{a:{stage:'planned',note:'이전 확인 내용',updatedAt:at},b:{stage:'applied',note:'지원 완료 메모',updatedAt:later}}};
  const result=canonicalizePersonal(personal,[{id:'a',canonicalId:'a'},{id:'b',canonicalId:'a'}]);assert.deepEqual(result.savedIds,['a']);assert.equal(result.reads.a,later);assert.equal(result.applications.a.stage,'applied');assert.equal(result.applications.a.note,'지원 완료 메모');assert.equal(result.applications.a.previousNotes[0].note,'이전 확인 내용');assert.equal(personal.savedIds.length,2);
});
