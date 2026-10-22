import test from 'node:test';
import assert from 'node:assert/strict';
import {parseList,parseDetail,parseDeadline,isOpen,mergeJobs,saraminUrl,manualJob,detailedAddress} from '../lib/jobs.mjs';
import {mapQuery,naverLink} from '../public/links.js';
const now=new Date('2026-10-13T05:00:00Z');
test('네이버 지도 링크에서 우편번호·건물명·층호수를 제거하고 도로명 또는 지번을 전달한다',()=>{
  assert.equal(mapQuery('(32256) 충남 홍성군 홍북읍 청사로 146 센텀시티 412호'),'충남 홍성군 홍북읍 청사로 146');
  assert.equal(mapQuery('(32244) 충남 홍성군 홍성읍 대학1길 19 혜전대학교'),'충남 홍성군 홍성읍 대학1길 19');
  assert.equal(mapQuery('충남 예산군 고덕면 오추리 855'),'충남 예산군 고덕면 오추리 855');
  assert.equal(decodeURIComponent(naverLink({regions:['홍성군'],company:'테스트 기업',sites:[{address:'충남 홍성군 홍북읍 청사로 146 412호'}]})),'https://map.naver.com/p/search/충남 홍성군 홍북읍 청사로 146');
});
const row=(id,location,deadline='~11.20(금)')=>`<div class="list_item"><div class="company_nm"><a class="str_tit">테스트 기업</a></div><div class="job_tit"><a href="/zf_user/jobs/relay/view?rec_idx=${id}&amp;view_type=list" title="품질 &amp; 생산 채용">제목</a></div><p class="work_place">${location}</p><p class="career">신입 · 경력 · 정규직</p><p class="education">학력무관</p><div class="support_detail"><span class="date">${deadline}</span><span class="deadlines">오늘 등록</span></div></div>`;
test('공개 목록에서 해당 군만 선택하고 마감 공고를 제외하며 경력·고용형태를 분리한다',()=>{
  const html=`<span class="recruit_count">1,234건</span>${row(1001,'충남 홍성군')}${row(1002,'충남 예산군')}${row(1003,'충남 홍성군','~10.12(월)')}`;
  const result=parseList(html,'홍성군',now);
  assert.equal(result.jobs.length,1);assert.equal(result.total,1234);
  assert.equal(result.jobs[0].title,'품질 & 생산 채용');assert.equal(result.jobs[0].experience,'신입/경력');assert.equal(result.jobs[0].employment,'정규직');
  assert.equal(result.jobs[0].url,'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1001');
});
test('구조가 달라진 페이지에서 0건으로 성공 처리하지 않는다',()=>assert.throws(()=>parseList('<html>접속 확인</html>','홍성군',now)));
test('두 번째 페이지에 전체 수가 없을 때 페이지 공고 수를 전체 수로 오인하지 않는다',()=>{
  const result=parseList(row(2001,'충남 홍성군'),'홍성군',now);
  assert.equal(result.total,null);assert.equal(result.pageItems,1);assert.equal(result.jobs.length,1);
});
test('복수 지역 공고를 중복 없이 합친다',()=>{
  const hong=parseList(row(1001,'충남 홍성군 외'),'홍성군',now).jobs;
  const yesan=parseList(row(1001,'충남 예산군 외'),'예산군',now).jobs;
  const result=mergeJobs([...hong,...yesan]);assert.equal(result.length,1);assert.deepEqual(result[0].regions,['홍성군','예산군']);
});
test('근무지 요소의 좌표만 추출하고 다른 군·페이지 하단 주소·마스킹 주소는 제외한다',()=>{
  const html=`<div class="address">사람인 서울 본사</div><div data-address="(32256) 충남 홍성군 홍북읍 청사로 146" data-latitude="36.6570432945004" data-longitude="126.679366777464"></div><div data-address="충남 예산군 예산읍 창말로 21" data-latitude="36.677" data-longitude="126.847"></div><div data-address="(32415) 충남 홍성군 산단2길 ***" data-latitude="36.64" data-longitude="126.63"></div><div data-address="충남 홍성군 충서로 00" data-latitude="36.65" data-longitude="126.64"></div>`;
  const result=parseDetail(html,['홍성군']);assert.equal(result.sites.length,1);assert.equal(result.sites[0].lat,36.6570432945004);
  assert.equal(parseDetail(html,['예산군']).sites.length,1);
});
test('좌표가 없거나 지역명이 없는 주소에 회사 위치를 추정하지 않는다',()=>{
  assert.equal(parseDetail('<div data-address="충남 홍성군" data-latitude="0" data-longitude="0"></div>',['홍성군']).sites.length,0);
  assert.equal(detailedAddress('(32256) 충남 홍성군 홍북읍'),false);
  assert.equal(detailedAddress('충남 홍성군 홍북읍 청사로 146'),true);
});
test('한국 시간 마감일과 연말의 다음 해 날짜를 처리한다',()=>{
  assert.equal(parseDeadline('~11.20(금)',now),'2026-11-20T14:59:59.000Z');
  assert.equal(parseDeadline('~01.10(일)',new Date('2026-12-20T05:00:00Z')),'2027-01-10T14:59:59.000Z');
  assert.equal(parseDeadline('채용시',now),null);assert.equal(isOpen({closed:true}),false);
});
test('외부 링크·공고 외 URL·인증정보가 포함된 링크 등록을 거부한다',()=>{
  for(const url of ['https://evil.test/?rec_idx=1001','javascript:alert(1)','https://saramin.co.kr.evil.test/zf_user/jobs/view?rec_idx=1001','https://user:secret@www.saramin.co.kr/zf_user/jobs/view?rec_idx=1001','https://www.saramin.co.kr/zf_user/company-info/view?rec_idx=1001'])assert.throws(()=>saraminUrl(url));
  assert.throws(()=>manualJob({url:'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1001',company:'테스트',title:'테스트',region:'서울'}));
});
