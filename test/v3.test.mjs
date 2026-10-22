import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedJobs,qualitySummary} from '../lib/quality.mjs';
import {exactAddressKey,groupJobs,filterJobs,kmBetween,distanceFrom,civilDaysUntil,jobsCsv} from '../public/model.js';
import {affiliatedSaraminUrl} from '../lib/providers.mjs';
const base=(id,portal='work24',extra={})=>({id,portal,company:'검증 회사',title:'사무원 모집',regions:['홍성군'],experience:'경력무관',sites:[],url:`https://example.test/${id}`,expiresAt:null,...extra});
const site={address:'충청남도 홍성군 홍성읍 대학1길 19, 대학본부 총무팀',lat:36.579786,lng:126.659169};
test('도로명 자체의 숫자·층수·우편번호를 건물번호로 오인하지 않는다',()=>{
  for(const address of ['(32244) 충남 홍성군 홍성읍','충남 홍성군 산단2길','충남 홍성군 산단2길 3층','충남 홍성군 청사로 00','충남 홍성군 대학1길 19 인근','충남 홍성군 청사로 ***'])assert.equal(exactAddressKey(address),'',address);
  assert.equal(exactAddressKey('(32244) 충남 홍성군 홍성읍 대학1길 19 혜전대학교'),exactAddressKey(site.address));
  assert.notEqual(exactAddressKey(site.address),exactAddressKey('충남 홍성군 홍성읍 대학1길 190'));
});
test('원문 링크로 연결된 제휴만 묶고 모든 사이트 링크를 보존한다',()=>{
  const jobs=verifiedJobs([base('saramin:123','saramin',{sites:[site]}),base('work24:CSI:123','work24',{originId:'saramin:123'}),base('jobkorea:WN:1','jobkorea',{originId:'work24:CSI:123'}),base('saramin:456','saramin')]);
  const groups=groupJobs(jobs);assert.equal(groups.length,2);assert.equal(groups[0].members.length,3);assert.equal(groups[0].members.map(j=>j.url).length,3);assert.equal(groups[0].sites.length,1);
  assert.equal(groupJobs(jobs,false).length,4);assert.equal(filterJobs(jobs,{portal:'jobkorea',region:'all',experience:'all'}).length,1);
  assert.equal(jobs[2].canonicalId,'saramin:123');assert.equal(groups[1].title,groups[0].title);
});
test('정확히 같은 근무지 주소의 좌표만 보완하고 근거 링크를 남긴다',()=>{
  const jobs=verifiedJobs([base('work24:1','work24',{sites:[site]}),base('saramin:2','saramin',{address:'(32244) 충남 홍성군 홍성읍 대학1길 19 혜전대학교'}),base('saramin:3','saramin',{address:'충남 홍성군 홍성읍 대학1길 190'})]);
  assert.equal(jobs[1].sites.length,1);assert.equal(jobs[1].sites[0].verification,'address-match');assert.equal(jobs[1].sites[0].referenceJobId,'work24:1');assert.equal(jobs[2].sites.length,0);assert.equal(qualitySummary(jobs).addressMatched,1);
});
test('같은 주소의 좌표가 150m 넘게 다르면 보완하지 않는다',()=>{
  const jobs=verifiedJobs([base('a','work24',{sites:[site]}),base('b','saramin',{sites:[{...site,lat:36.59}]}),base('c','jobkorea',{address:site.address})]);
  assert.equal(jobs[2].sites.length,0);assert.equal(jobs[2].coordinateConflict,true);
});
test('직접 지정한 근무지는 같은 원문 묶음에 적용하고 다른 공고의 공개 좌표로 재사용하지 않는다',()=>{
  const override={address:'충남 홍성군 홍성읍 대학1길 20',lat:36.58,lng:126.66,source:'직접 확인한 근무지',confirmedAt:'2026-10-14T03:00:00Z'};
  const jobs=verifiedJobs([base('a','saramin',{sites:[site]}),base('b','work24',{originId:'a'}),base('c','jobkorea',{address:override.address})],{}, {b:override});
  assert.equal(jobs[0].sites[0].address,override.address);assert.equal(jobs[1].sites[0].address,override.address);assert.equal(groupJobs(jobs)[0].sites.length,1);assert.equal(jobs[2].sites.length,0);assert.equal(qualitySummary(jobs).manualLocated,2);assert.equal(qualitySummary(jobs).directLocated,0);
});
test('중복 묶기와 관심공고·지도 범위·기준점 거리 조건을 함께 적용한다',()=>{
  const jobs=verifiedJobs([base('a','work24',{sites:[site]}),base('b','jobkorea',{originId:'a'}),base('c','work24',{sites:[{...site,lat:36.9}]}),base('d')]);
  const filter={portal:'all',region:'홍성군',experience:'all',reference:{lat:36.5798,lng:126.6592},radius:5,sort:'distance',savedOnly:true,visibleOnly:true,bounds:{south:36.57,north:36.6,west:126.6,east:126.7}};
  const result=filterJobs(jobs,filter,new Set(['a']));assert.equal(result.length,1);assert.equal(result[0].members.length,2);assert.ok(distanceFrom(result[0],filter.reference)<.1);assert.ok(kmBetween(site,{...site,lat:36.9})>30);
});
test('마감 D-day는 대한민국 날짜 기준으로 계산한다',()=>{
  assert.equal(civilDaysUntil('2026-10-14T14:59:59Z',Date.parse('2026-10-13T17:00:00Z')),0);
  assert.equal(civilDaysUntil('2026-10-15T14:59:59Z',Date.parse('2026-10-13T17:00:00Z')),1);
});
test('고용24 제휴 iframe의 실제 사람인 공고 번호를 사용한다',()=>{
  const link=affiliatedSaraminUrl('<iframe src="https://www.saramin.co.kr/api/jobs/job/content?rec_idx=55273708"></iframe>');assert.equal(link.id,'saramin:55273708');assert.equal(affiliatedSaraminUrl('<iframe src="https://evil.test/api/jobs/job/content?rec_idx=55273708"></iframe>'),null);
});
test('CSV는 원문 링크·한글·따옴표를 보존하고 수식 실행 문자열을 중화한다',()=>{
  const csv=jobsCsv(groupJobs([base('a','work24',{company:'=1+1',title:'"주간" 사무원',sites:[site]})]));assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('""주간""'));assert.ok(csv.includes('https://example.test/a'));
});
