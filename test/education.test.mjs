import test from 'node:test';
import assert from 'node:assert/strict';
import {educationInfo,educationAssessment,highSchoolEducation,sanitizeEducation,latestEducation} from '../public/education.js';
import {sanitizeSearch} from '../public/features.js';
import {filterJobs,groupJobs,jobsCsv} from '../public/model.js';
import {publicFacts} from '../lib/facts.mjs';
import {historyRows,emptyHistory,reconcileHistory} from '../lib/history.mjs';
import {verifiedJobs} from '../lib/quality.mjs';

const job=(id,education,extra={})=>({id,canonicalId:id,education,portal:'saramin',company:'학력 검증 기업',title:'생산직',regions:['홍성군'],sites:[],url:'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=999123456',expiresAt:null,...extra});
const filter=education=>({portal:'all',region:'all',experience:'all',education});
test('세 사이트의 실제 학력 표기와 대학 수업 연한을 구분한다',()=>{
  const cases={any:['학력무관','학력 무관','학력 제한 없음'],belowHigh:['중졸↑','중졸 ~ 고졸','초졸 이상'],high:['고졸','고졸↑','고졸 이상','고졸 ~ 대졸(4년)','고졸 ~ 대졸(2~3년)'],college:['초대졸↑','대학(2,3년)↑','대졸(2~3년)','대졸(2~3년) ~ 대졸(4년)','대졸(2~3년) ~ 석사','대졸(2~3년) ~ 박사','전문대졸'],bachelor:['대졸↑','대학교(4년)↑','대졸(4년)','대졸(4년) ~ 박사'],master:['석사↑','석사 ~ 박사','석·박사'],doctor:['박사']};
  for(const [kind,values]of Object.entries(cases))for(const value of values)assert.equal(educationInfo(value).kind,kind,value);
});
test('빈 학력을 학력무관으로 바꾸거나 우대·추가 조건을 필수 학력으로 오인하지 않는다',()=>{
  for(const value of ['',null,'미기재','대학원졸','대졸 우대','고졸 이하','대졸 이상 (고졸은 경력 3년 이상)','고졸 이상, 대졸 필수','학력무관 (대졸 필수)'])assert.equal(educationInfo(value).kind,'unknown',value);
  assert.equal(educationInfo('고졸 이상 (대졸 우대)').kind,'high');
  assert.equal(educationInfo('고졸 이상, 대졸 우대').kind,'high');
  assert.equal(educationInfo('학력무관 (대졸 우대)').kind,'any');
  assert.equal(educationInfo('고졸 또는 초대졸').kind,'high');
});
test('학력 복수 선택은 OR이며 고졸 기준은 초대졸·대졸 이상의 최소 조건을 제외한다',()=>{
  const rows=[job('a','학력무관'),job('b','고졸↑'),job('c','고졸 ~ 대졸(4년)'),job('d','초대졸↑'),job('e','대졸↑'),job('f','중졸↑'),job('g','')];
  assert.deepEqual(filterJobs(rows,filter(highSchoolEducation)).map(row=>row.id),['a','b','c','f']);
  assert.deepEqual(filterJobs(rows,filter(['high','college'])).map(row=>row.id),['b','c','d']);
  assert.deepEqual(filterJobs(rows,filter(['unknown'])).map(row=>row.id),['g']);
  assert.equal(filterJobs(rows,filter([])).length,rows.length);
});
test('급여·고용형태와 학력은 같은 원문에서 함께 충족하고 원문별 불일치는 확인 대상으로 분리한다',()=>{
  const a=job('a','고졸',{salary:'월급 200만원'}),b=job('b','',{canonicalId:'a',salary:'월급 300만원'});
  assert.equal(filterJobs([a,b],{...filter(['high']),payPeriod:'month',payMin:2500000}).length,0);
  assert.equal(filterJobs([a,b],{...filter(['high']),payPeriod:'month',payMin:2000000}).length,1);
  b.education='대졸↑';assert.equal(educationAssessment(groupJobs([a,b])[0]).conflict,true);
  assert.equal(filterJobs([a,b],filter(highSchoolEducation)).length,0);
  assert.equal(filterJobs([a,b],filter(['unknown'])).length,1);
});
test('사이트·지역 필터와 학력 복수 선택을 함께 적용한다',()=>{
  const rows=[job('a','고졸'),job('b','고졸',{portal:'jobkorea'}),job('c','학력무관',{regions:['예산군']})];
  assert.deepEqual(filterJobs(rows,{...filter(highSchoolEducation),portal:'saramin',region:'홍성군'}).map(row=>row.id),['a']);
});
test('검색 저장은 학력 선택을 중복 없이 보존하고 알 수 없는 값은 버린다',()=>{
  assert.deepEqual(sanitizeEducation(['high','any','high','made-up']),['any','high']);
  assert.deepEqual(sanitizeSearch({education:['college','high','high']}).education,['high','college']);
  assert.deepEqual(sanitizeSearch({}).education,[]);
  assert.deepEqual(sanitizeSearch({education:'high'}).education,[]);
});
test('새 목록의 학력 변경을 오래된 상세 캐시로 덮지 않고 화면과 이력에 동일한 최신 조건을 쓴다',()=>{
  const source=job('a','대졸↑',{fetchedAt:'2026-10-21T03:00:00Z'}),old={education:'고졸↑',checkedAt:'2026-10-20T23:00:00Z'};
  assert.equal(latestEducation(source,old),'대졸↑');
  assert.equal(verifiedJobs([source],{a:old})[0].education,'대졸↑');
  assert.equal(historyRows([source],{a:old})[0].education,'대졸↑');
  assert.equal(latestEducation(source,{education:'고졸↑',checkedAt:'2026-10-21T04:00:00Z'}),'고졸↑');
  assert.equal(latestEducation(job('a',''),old),'고졸↑');
});
test('공개 상세의 지정 학력 항목만 읽고 메뉴·제목·우대 문구로 학력을 추정하지 않는다',()=>{
  const source=job('a','');
  assert.equal(publicFacts(source,'<nav>학력 대졸</nav><h1>고졸 우대</h1>').education,undefined);
  assert.equal(publicFacts(source,'<dl><dt>학력</dt><dd>고졸 이상</dd></dl>').education,'고졸 이상');
  assert.equal(publicFacts(source,'<table><tr><th>학력 조건</th><td>초대졸↑</td></tr></table>').education,'초대졸↑');
  assert.equal(publicFacts(source,'<script type="application/ld+json">{"@type":"JobPosting","educationRequirements":{"@type":"EducationalOccupationalCredential","name":"대졸(4년)"}}</script>').education,'대졸(4년)');
});
test('CSV에도 각 원문의 학력을 보존하며 처음 기록하는 학력은 실제 변경으로 꾸미지 않는다',()=>{
  const source=job('a','고졸 ~ 대졸(4년)'),csv=jobsCsv(groupJobs([source]));
  assert.ok(csv.includes('"학력(원문)"'));assert.ok(csv.includes('"고졸 ~ 대졸(4년)"'));
  const at='2026-10-21T00:00:00Z',later='2026-10-21T01:00:00Z',history=emptyHistory(historyRows([job('a','')]),at);
  const first=reconcileHistory(history,historyRows([source]),later);
  assert.equal(first.addedEvents[0].type,'confirmed');assert.equal(first.addedEvents[0].changes[0].field,'education');
  const changed=reconcileHistory(first.history,historyRows([job('a','대졸↑')]),later);
  assert.equal(changed.addedEvents[0].type,'changed');
});
