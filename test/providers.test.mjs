import test from 'node:test';
import assert from 'node:assert/strict';
import {jobLink,parseJobkoreaList,parseJobkoreaDetail,parseWork24List,parseWork24Detail,kstDeadline,listRequest,manualPortalJob,affiliatedWork24Url,parseJobkoreaAffiliateDetail} from '../lib/providers.mjs';
import {mergeJobs} from '../lib/jobs.mjs';
import {selectJobs} from '../public/filters.js';
const now=new Date('2026-10-14T03:00:00Z');
test('사이트별 번호가 같아도 공고·관심공고·위치 ID가 충돌하지 않는다',()=>{
  const a=jobLink('https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=123456');
  const b=jobLink('https://www.jobkorea.co.kr/Recruit/GI_Read/123456?rPageCode=AM');
  assert.notEqual(a.id,b.id);assert.equal(mergeJobs([{...a,regions:['홍성군']},{...b,regions:['홍성군']}]).length,2);
});
test('고용24 원문 링크의 공고 번호와 정보 유형을 유지한다',()=>{
  const job=jobLink('https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=K172222610130036&infoTypeCd=VALIDATION&infoTypeGroup=tb_workinfoworknet');
  assert.equal(job.portal,'work24');assert.equal(new URL(job.url).searchParams.get('wantedAuthNo'),'K172222610130036');
  for(const url of ['https://jobkorea.co.kr.evil.test/Recruit/GI_Read/123456','https://user:pw@www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=K123456','https://www.work24.go.kr/cm/main.do','https://www.jobkorea.co.kr/company/123456'])assert.throws(()=>jobLink(url));
});
test('잡코리아의 등록일이 오늘이어도 실제 마감일을 사용하고 타 지역 행은 제외한다',()=>{
  const row=(id,location)=>`<tr class="devloopArea"><td class="tplCo"><a>검증 기업</a></td><td class="tplTit"><strong><a href="/Recruit/GI_Read/${id}" title="제조팀 모집">제조팀 모집</a></strong><p class="etc"><span class="cell">신입·경력</span><span class="cell">학력무관</span><span class="cell">${location}</span><span class="cell">정규직</span></p><button data-brazeinfo="제조팀 모집|${id}|999|2026-10-14|2026-11-13|검증 기업|123"></button></td><td><span class="date">~11/13</span></td></tr>`;
  const data=parseJobkoreaList(`<div class="tplList"><table>${row(123456,'충남 홍성군')}${row(123457,'충남 예산군')}</table></div>`,'홍성군',now);
  assert.equal(data.jobs.length,1);assert.equal(data.pageItems,2);assert.equal(data.jobs[0].expiresAt,'2026-11-13T14:59:59.000Z');assert.equal(data.jobs[0].portal,'jobkorea');
});
test('잡코리아 공개 Next 데이터에서 실제 근무지를 추출하고 회사 본사 좌표는 사용하지 않는다',()=>{
  const record=['$',null,null,{state:{queries:[{state:{data:{title:'공고',statusType:'POSTING',deleted:false,post:{postingEndAt:'2026-11-13T23:59:59+09:00'},workCondition:{workplace:{locationAttributes:[{fullAddress:'충남 홍성군 홍북읍 애향2길 19',latitude:36.6576,longitude:126.6847}]}},info:{address:{address:'서울 강남구 본사로 12',latitude:37.5,longitude:127}}}}}]}}];
  const embedded=JSON.stringify([1,'16:'+JSON.stringify(record)+'\n']);
  const data=parseJobkoreaDetail(`<script>self.__next_f.push(${embedded})</script>`,['홍성군']);
  assert.equal(data.sites.length,1);assert.equal(data.sites[0].lat,36.6576);assert.equal(data.closed,false);
  assert.equal(parseJobkoreaDetail(`<script>self.__next_f.push(${embedded})</script>`,['예산군']).sites.length,0);
});
test('고용24 행의 회사·원문 제목·실제 마감일과 채용시 마감 조건을 읽는다',()=>{
  const row=(id,location,wantedYn)=>`<tr><td><input id="chkboxWantedAuthNo0" value="${id}|VALIDATION|테스트 센터|사무원 모집 전체 제목"><a class="cp_name">테스트 센터</a><a href="/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${id}&amp;infoTypeCd=VALIDATION">사무원...</a></td><td><ul class="emp_info_dtl"><li class="member"><span class="item">경력무관</span><span class="item">학력무관</span></li><li class="site">${location}</li></ul></td><td><script>var date='2026-11-10';var wantedYn='${wantedYn}';</script><p>등록일 : 2026-10-14</p></td></tr>`;
  const parsed=parseWork24List(`<script>totalRecordCount:123</script><table>${row('K123456','충청남도 홍성군 홍성읍','N')}${row('K123457','충청남도 홍성군 홍성읍','Y')}${row('K123458','서울 종로구','N')}</table>`,'홍성군',now);
  assert.equal(parsed.jobs.length,2);assert.equal(parsed.jobs[0].title,'사무원 모집 전체 제목');assert.equal(parsed.jobs[0].expiresAt,'2026-11-10T14:59:59.000Z');assert.equal(parsed.jobs[1].expiresAt,null);assert.equal(parsed.total,123);
});
test('고용24 근무예정지 버튼만 사용하며 본사·가려진 주소·잘못된 좌표는 제외한다',()=>{
  const button=(address,x,y,fn='f_showWorkLocationMap')=>`<button data-addr="${address}" data-map-coor-x="${x}" data-map-coor-y="${y}" onclick="${fn}(this.dataset.addr)"></button>`;
  const html=button('충청남도 홍성군 홍성읍 도청대로 136',126.6648,36.6168)+button('충청남도 홍성군 홍북읍 청사로 146',126.679,36.657,'companyHeadquarterMap')+button('충청남도 예산군 삽교읍 산단2길 ***',126.7,36.7)+button('충청남도 홍성군 충서로 19',0,0);
  const parsed=parseWork24Detail(html,['홍성군']);assert.equal(parsed.sites.length,1);assert.equal(parsed.sites[0].lat,36.6168);
});
test('채용사이트·지역·위치·관심공고 필터가 동시에 적용되고 다른 사이트 공고는 숨긴다',()=>{
  const jobs=[{id:'saramin:1',portal:'saramin',regions:['홍성군'],company:'센터',title:'사무원',sites:[],experience:'경력무관'},{id:'work24:1',portal:'work24',regions:['홍성군'],company:'센터',title:'사무원',sites:[{address:'홍성군 도청대로 136'}],experience:'경력무관'},{id:'work24:2',portal:'work24',regions:['예산군'],company:'센터',title:'사무원',sites:[],experience:'신입'}];
  const filter={portal:'work24',region:'홍성군',query:'사무원',experience:'all',locatedOnly:true,savedOnly:true,sort:'default'};
  assert.deepEqual(selectJobs(jobs,filter,new Set(['work24:1'])).map(job=>job.id),['work24:1']);assert.equal(selectJobs(jobs,filter,new Set(['saramin:1'])).length,0);
});
test('직접 등록에서 출처를 URL로 식별하고 검색 요청은 확인한 군별 코드로 구성한다',()=>{
  assert.equal(manualPortalJob({url:'https://www.jobkorea.co.kr/Recruit/GI_Read/123456',company:'테스트',title:'공고',region:'홍성군'}).portal,'jobkorea');
  assert.equal(new URL(listRequest('jobkorea','홍성군',1).url).searchParams.get('local'),'O150');
  const nextPage=listRequest('jobkorea','홍성군',2);
  assert.equal(nextPage.method,'POST');assert.equal(nextPage.headers['X-Requested-With'],'XMLHttpRequest');
  assert.equal(new URLSearchParams(nextPage.body).get('condition[local]'),'O150');assert.equal(new URLSearchParams(nextPage.body).get('page'),'2');
  assert.equal(new URLSearchParams(listRequest('work24','예산군',2).body).get('region'),'44810');assert.equal(new URLSearchParams(listRequest('work24','예산군',2).body).get('pageIndex'),'2');
  assert.equal(kstDeadline('2026-11-13T23:59'),'2026-11-13T14:59:00.000Z');
});

test('잡코리아 목록의 고용24·알바몬 제휴 공고도 읽고 원문 링크와 별도 ID를 유지한다',()=>{
  const row=(href,title)=>`<tr class="devloopArea"><td class="tplCo"><a>검증 기업</a></td><td class="tplTit"><strong><a href="${href}">${title}</a></strong><p class="etc"><span class="cell">학력무관</span><span class="cell">충남 홍성군</span><span class="cell">정규직</span></p></td><td class="date">상시모집</td></tr>`;
  const parsed=parseJobkoreaList(`<div class="tplList"><table>${row('/Recruit/GI_Read/5676044/Ext?siteCode=WN','제휴 현장직')}${row('https://www.albamon.com/jobs/detail/119713066?sc=612','제휴 매장직')}</table></div>`,'홍성군',now);
  assert.equal(parsed.jobs.length,2);assert.equal(parsed.jobs[0].affiliate,'고용24');assert.equal(parsed.jobs[0].id,'jobkorea:WN:5676044');assert.equal(parsed.jobs[1].affiliate,'알바몬');assert.equal(parsed.jobs[1].url,'https://www.albamon.com/jobs/detail/119713066');assert.equal(parsed.jobs[1].experience,'');
  assert.notEqual(parsed.jobs[0].id,jobLink('https://www.jobkorea.co.kr/Recruit/GI_Read/5676044').id);
});

test('고용24 50개 페이지와 복수 근무지 축약을 처리하며 관련 없는 단일 지역은 제외한다',()=>{
  const row=(id,location)=>`<tr><td><input id="chkboxWantedAuthNo${id}" value="${id}|CSI|검증 기업|공무 모집"><a class="cp_name">검증 기업</a><a href="/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${id}&amp;infoTypeCd=CSI">공무 모집</a></td><td><ul class="emp_info_dtl"><li class="site">${location}</li></ul></td></tr>`;
  const parsed=parseWork24List(`<input id="resultCnt" value="50"><script>totalRecordCount:216</script><table>${row('55273708','충남 당진시 등')}${row('55273709','서울 종로구')}</table>`,'홍성군',now);
  assert.equal(parsed.pageSize,50);assert.equal(parsed.pageItems,2);assert.equal(parsed.jobs.length,1);assert.deepEqual(parsed.jobs[0].regions,['홍성군']);assert.equal(new URLSearchParams(listRequest('work24','홍성군',2).body).get('resultCnt'),'50');
});

test('제휴공고는 고용24 상세 링크와 알바몬의 실제 근무지 좌표만 사용한다',()=>{
  const linked=affiliatedWork24Url('<iframe src="https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=K172222610130012&amp;infoTypeGroup=tb_workinfoworknet"></iframe>');
  assert.equal(linked.id,'work24:VALIDATION:K172222610130012');assert.equal(affiliatedWork24Url('<iframe src="https://evil.test/empDetailAuthView.do?wantedAuthNo=K172222610130012"></iframe>'),null);
  const data={props:{pageProps:{data:{viewData:{workingAddress:'충남 홍성군 도청대로 50',latitude:36.609081,longitude:126.663948,companyAddress:'서울 강서구 염창동',allTime:true,deleted:false,closeStat:false,postStatus:{key:'OPEN'}}}}}};
  const parsed=parseJobkoreaAffiliateDetail(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`,['홍성군'],'알바몬');assert.equal(parsed.sites.length,1);assert.equal(parsed.sites[0].address,'충남 홍성군 도청대로 50');assert.equal(parsed.expiresAt,null);assert.equal(parsed.closed,false);
});
