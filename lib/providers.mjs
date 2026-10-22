import {load} from 'cheerio';
import {text,parseList as saraminList,parseDetail as saraminDetail,parseDeadline,isOpen,validCoordinate,detailedAddress,saraminUrl} from './jobs.mjs';

export const PORTALS={saramin:'사람인',jobkorea:'잡코리아',work24:'고용24'};
export const AREA_CODES={
  saramin:{'홍성군':'115160','예산군':'115120'},
  jobkorea:{'홍성군':'O150','예산군':'O110'},
  work24:{'홍성군':'44800','예산군':'44810'},
};
export function jobLink(value) {
  let url;try{url=new URL(value);}catch{throw new Error('채용공고 상세페이지 링크를 입력해 주세요.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)throw new Error('지원하는 채용사이트의 공고 링크가 필요합니다.');
  if(['saramin.co.kr','www.saramin.co.kr'].includes(url.hostname)) {
    const normalized=saraminUrl(url.href),externalId=new URL(normalized).searchParams.get('rec_idx');
    return {portal:'saramin',externalId,id:`saramin:${externalId}`,url:normalized};
  }
  if(['jobkorea.co.kr','www.jobkorea.co.kr','m.jobkorea.co.kr'].includes(url.hostname)) {
    const match=url.pathname.match(/^\/Recruit\/GI_Read\/(\d+)\/?$/i);
    if(match)return {portal:'jobkorea',externalId:match[1],id:`jobkorea:${match[1]}`,url:`https://www.jobkorea.co.kr/Recruit/GI_Read/${match[1]}`};
    const affiliated=url.pathname.match(/^\/Recruit\/GI_Read\/(\d+)\/Ext\/?$/i);
    if(affiliated&&url.searchParams.get('siteCode')==='WN')return {portal:'jobkorea',externalId:affiliated[1],id:`jobkorea:WN:${affiliated[1]}`,affiliate:'고용24',url:`https://www.jobkorea.co.kr/Recruit/GI_Read/${affiliated[1]}/Ext?siteCode=WN`};
  }
  if(['work24.go.kr','www.work24.go.kr'].includes(url.hostname)&&url.pathname==='/wk/a/b/1500/empDetailAuthView.do') {
    const externalId=url.searchParams.get('wantedAuthNo'),infoTypeCd=url.searchParams.get('infoTypeCd')||'VALIDATION',infoTypeGroup=url.searchParams.get('infoTypeGroup')||'tb_workinfoworknet';
    if(/^[A-Za-z0-9_-]{5,50}$/.test(externalId||'')&&/^[A-Za-z0-9_]{1,60}$/.test(infoTypeCd)&&/^[A-Za-z0-9_]{1,60}$/.test(infoTypeGroup)) {
      const normalized=new URL('https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do');
      normalized.search=new URLSearchParams({wantedAuthNo:externalId,infoTypeCd,infoTypeGroup}).toString();
      return {portal:'work24',externalId,id:`work24:${infoTypeCd}:${externalId}`,url:normalized.href};
    }
  }
  throw new Error('사람인·잡코리아·고용24의 지원하는 공고 상세페이지 링크를 입력해 주세요.');
}
function jobkoreaListLink(value) {
  const url=new URL(value,'https://www.jobkorea.co.kr');
  const match=url.pathname.match(/^\/jobs\/detail\/(\d+)\/?$/);
  if(url.hostname==='www.albamon.com'&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&match)return {portal:'jobkorea',externalId:match[1],id:`jobkorea:ALBAMON:${match[1]}`,affiliate:'알바몬',url:`https://www.albamon.com/jobs/detail/${match[1]}`};
  return jobLink(url.href);
}
export function kstDeadline(value) {
  if(!value)return null;
  let date=String(value).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(date))date+='T23:59:59+09:00';
  else if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date))date+='+09:00';
  const time=Date.parse(date);return Number.isFinite(time)?new Date(time).toISOString():null;
}
function baseJob(link,company,title,region,now) {
  return {...link,company:text(company),title:text(title),regions:[region],location:`충남 ${region}`,experience:'',employment:'',education:'',category:'',salary:'',deadlineLabel:'마감일 원문 확인',expiresAt:null,registeredLabel:'',source:link.portal,fetchedAt:now.toISOString(),sites:[],locationNote:'',closed:false};
}
export function parseJobkoreaList(html,region,now=new Date()) {
  const $=load(html),jobs=[];
  const rows=$('.tplList tr.devloopArea');
  const mainRows=$('.tplList:not(.AgiList) tr.devloopArea');
  rows.each((_,element)=>{
    const row=$(element),anchor=row.find('.tplTit strong a').first();
    const info=row.find('.etc .cell').map((_,el)=>text($(el).text())).get();
    const location=info.find(s=>s.includes(region));
    if(!anchor.length||!location)return;
    let link;try{link=jobkoreaListLink(anchor.attr('href'));}catch{return;}
    const company=text(row.find('.tplCo>a').first().text());
    const job=baseJob(link,company,anchor.attr('title')||anchor.text(),region,now);
    const tracked=row.find('[data-brazeinfo]').first().attr('data-brazeinfo')?.split('|')||[];
    const date=[...tracked].reverse().find(s=>/^\d{4}-\d{2}-\d{2}$/.test(s));
    const deadlineLabel=text(row.find('.date').text());
    Object.assign(job,{location,experience:info.find(s=>/경력|신입/.test(s))||'',education:info.find(s=>/학력|졸|박사|석사/.test(s))||'',employment:info.find(s=>/정규직|계약직|인턴|파견|프리랜서/.test(s))||'',category:text(row.find('.dsc').text()),deadlineLabel,expiresAt:/채용시|상시|수시/.test(deadlineLabel)?null:kstDeadline(date)||parseDeadline(deadlineLabel.replace(/\//g,'.'),now),registeredLabel:text(row.find('.time').text())});
    if(company&&job.title&&isOpen(job,now.getTime()))jobs.push(job);
  });
  const totalRaw=text($('#hdnGICnt').attr('value')||$('#recentTotal').text()),total=/^\d[\d,]*$/.test(totalRaw)?Number(totalRaw.replace(/,/g,'')):null;
  if(!rows.length&&!/검색.*없|채용정보가 없습니다/.test(text($('body').text())))throw new Error('잡코리아의 목록 구조 변경 또는 접근 제한을 확인했습니다.');
  return {jobs,total,pageItems:mainRows.length||rows.length,pageSize:40};
}
export function parseWork24List(html,region,now=new Date()) {
  const $=load(html),jobs=[];const links=$('a[href*="/empDetailAuthView.do?"]');
  links.each((_,element)=>{
    const anchor=$(element),row=anchor.closest('tr'),location=text(row.find('.emp_info_dtl .site').text());
    if(!location.includes(region)&&!/(?:등|외)\s*$|전국|전지역/.test(location))return;
    let link;try{link=jobLink(new URL(anchor.attr('href'),'https://www.work24.go.kr').href);}catch{return;}
    const data=row.find('input[id^="chkboxWantedAuthNo"]').attr('value')?.split('|')||[];
    const company=text(row.find('.cp_name').first().text()||data[2]);
    const job=baseJob(link,company,data.slice(3).join('|')||anchor.text(),region,now);
    const scripts=row.find('script').text();
    const date=scripts.match(/var\s+date\s*=\s*['"]([^'"]+)/)?.[1];
    const untilHired=/var\s+wantedYn\s*=\s*['"]Y/.test(scripts)||date?.startsWith('2099');
    const career=row.find('.emp_info_dtl .member .item').map((_,el)=>text($(el).text())).get();
    const dateTexts=row.find('td:last-child p').map((_,el)=>text($(el).text())).get();
    Object.assign(job,{location,address:location,experience:career[0]==='관계없음'?'경력무관':career[0]||'',education:career[1]||'',salary:text(row.find('.emp_info_dtl .dollar').text()),deadlineLabel:untilHired?'채용시 마감':date?`~${date}`:'마감일 원문 확인',expiresAt:untilHired?null:kstDeadline(date),registeredLabel:dateTexts.find(s=>s.includes('등록일'))||''});
    if(company&&job.title&&isOpen(job,now.getTime()))jobs.push(job);
  });
  const match=html.match(/totalRecordCount\s*:\s*(\d+)/),total=match?Number(match[1]):null;
  if(!links.length&&!/검색.*없|채용정보가 없습니다/.test(text($('body').text())))throw new Error('고용24의 목록 구조 변경 또는 접근 제한을 확인했습니다.');
  const pageSize=Number($('#resultCnt').val())||10;
  return {jobs,total,pageItems:links.length,pageSize};
}
export function affiliatedWork24Url(html) {
  const $=load(html);for(const element of $('iframe[src]').toArray()) {
    try {const link=jobLink($(element).attr('src'));if(link.portal==='work24')return link;}catch{}
  }
  return null;
}
export function affiliatedSaraminUrl(html) {
  const $=load(html);for(const element of $('iframe[src]').toArray()) {
    try {
      const url=new URL($(element).attr('src'));
      if(url.hostname==='www.saramin.co.kr'&&url.pathname==='/api/jobs/job/content'&&/^\d+$/.test(url.searchParams.get('rec_idx')||''))return jobLink(`https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=${url.searchParams.get('rec_idx')}`);
    }catch{}
  }
  return null;
}
export function parseJobkoreaAffiliateDetail(html,regions,affiliate) {
  const $=load(html);
  if(affiliate==='알바몬') {
    let data;try{data=JSON.parse($('#__NEXT_DATA__').text()).props.pageProps.data.viewData;}catch{}
    if(!data)throw new Error('잡코리아 제휴 알바몬 공고의 공개 상세정보를 확인하지 못했습니다.');
    const address=text(data.workingAddress),sites=sitesFrom([{address,latitude:data.latitude,longitude:data.longitude}],regions,'잡코리아 제휴 알바몬 근무지');
    const expiresAt=data.allTime?null:kstDeadline(String(data.closingDateTime||'').replace(' ','T'));
    return {sites,address,expiresAt,closed:Boolean(data.deleted||data.closeStat)||Boolean(data.postStatus?.key&&data.postStatus.key!=='OPEN'),locationNote:sites.length?'':'공개 제휴공고에서 정확한 근무지 좌표를 확인하지 못했습니다.'};
  }
  const body=$('body').clone();body.find('script,style').remove();
  const address=text($('.artWork .address,.artWork .addr').first().text());
  return {sites:[],address,closed:/이미 마감된 채용정보|마감된 채용공고입니다|해당 채용정보가 없습니다/.test(text(body.text())),locationNote:'고용24 제휴 공고의 근무예정지를 확인합니다.'};
}
function nextRecords($) {
  const records=[];
  for(const script of $('script').toArray()) {
    const match=$(script).text().match(/self\.__next_f\.push\((\[[\s\S]*\])\)/);if(!match)continue;
    try {const parsed=JSON.parse(match[1]);if(typeof parsed[1]!=='string')continue;
      for(const line of parsed[1].split('\n')) {const record=line.match(/^[\da-f]+:(.*)$/);if(record){try{records.push(JSON.parse(record[1]));}catch{}}}
    } catch{}
  }
  return records;
}
function walk(value,visit,depth=0) {
  if(depth>40||!value)return;
  if(typeof value==='object') {visit(value);for(const child of Object.values(value))walk(child,visit,depth+1);}
  else if(typeof value==='string'&&/^[\[{]/.test(value.trim())){try{walk(JSON.parse(value),visit,depth+1);}catch{}}
}
function sitesFrom(locations,regions,source) {
  const sites=[];
  for(const location of locations) {
    const address=text(location.fullAddress||location.address),lat=Number(location.latitude),lng=Number(location.longitude);
    if(regions.some(region=>address.includes(region))&&detailedAddress(address)&&validCoordinate(lat,lng)&&!sites.some(site=>site.lat===lat&&site.lng===lng))sites.push({address,lat,lng,source,confirmedAt:new Date().toISOString()});
  }
  return sites;
}
export function parseJobkoreaDetail(html,regions) {
  const $=load(html),objects=[];let posting;
  for(const script of $('script[type="application/ld+json"]').toArray()){try{walk(JSON.parse($(script).text()),object=>{if(object['@type']==='JobPosting')posting=object;});}catch{}}
  for(const record of nextRecords($))walk(record,object=>{if(object.workCondition?.workplace?.locationAttributes)objects.push(object);});
  const data=objects[0],locations=data?.workCondition?.workplace?.locationAttributes||[];
  const sites=sitesFrom(locations,regions,'잡코리아 근무지');
  const address=text(locations.find(location=>regions.some(region=>String(location.fullAddress||location.address).includes(region)))?.fullAddress||posting?.jobLocation?.address?.streetAddress||'');
  const expiresAt=kstDeadline(data?.post?.postingEndAt||posting?.validThrough);
  const closed=Boolean(data?.deleted)||Boolean(data?.statusType&&data.statusType!=='POSTING')||Boolean(expiresAt&&Date.parse(expiresAt)<Date.now());
  const result={sites,address,closed,locationNote:sites.length?'':'공개 상세공고에서 이 지역의 정확한 근무지 좌표를 확인하지 못했습니다.'};
  if(posting?.title)result.title=text(posting.title);
  if(posting?.hiringOrganization?.name)result.company=text(posting.hiringOrganization.name);
  if(expiresAt)result.expiresAt=expiresAt;
  if(posting?.experienceRequirements)result.experience=text(posting.experienceRequirements);
  return result;
}
export function parseWork24Detail(html,regions) {
  const $=load(html),locations=[];
  // Only the published work-location button; the employer's registered headquarters is unrelated.
  $('[data-addr][data-map-coor-x][data-map-coor-y]').each((_,element)=>{const node=$(element);if(!/f_showWorkLocationMap/.test(node.attr('onclick')||''))return;locations.push({address:node.attr('data-addr'),latitude:node.attr('data-map-coor-y'),longitude:node.attr('data-map-coor-x')});});
  const sites=sitesFrom(locations,regions,'고용24 근무예정지');
  let address=locations.find(location=>regions.some(region=>String(location.address).includes(region)))?.address||'';
  if(!address)$('th,dt').each((_,element)=>{if(text($(element).text()).replace(/\s/g,'')==='근무예정지')address=text($(element).next().find('p').first().text());});
  const body=$('body').clone();body.find('script,style').remove();
  const closed=/이미 마감된 채용정보|마감된 채용공고입니다|해당 채용정보가 없습니다/.test(text(body.text()));
  return {sites,address:text(address),closed,locationNote:sites.length?'':'공개 상세공고에서 이 지역의 정확한 근무예정지 좌표를 확인하지 못했습니다.'};
}
export function listRequest(portal,region,page) {
  const code=AREA_CODES[portal]?.[region];if(!code)throw new Error('지원하지 않는 지역입니다.');
  if(portal==='saramin'){const url=new URL('https://www.saramin.co.kr/zf_user/jobs/list/domestic');url.search=new URLSearchParams({loc_cd:code,page:String(page),page_count:'50',sort:'RD'}).toString();return{url:url.href};}
  if(portal==='jobkorea'){
    if(page>1)return{url:'https://www.jobkorea.co.kr/Recruit/Home/_GI_List/',method:'POST',headers:{'X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams({'condition[local]':code,'condition[menucode]':'local',page:String(page),pagesize:'40',order:'20',tabindex:'0',direct:'0',onePick:'0',confirm:'0',profile:'0'}).toString()};
    const url=new URL('https://www.jobkorea.co.kr/recruit/joblist');url.search=new URLSearchParams({menucode:'local',local:code}).toString();return{url:url.href};
  }
  const body=new URLSearchParams({region:code,resultCnt:'50',sortField:'DATE',sortOrderBy:'DESC',pageIndex:String(page),currentPageNo:String(page),siteClcd:'all'}).toString();
  return {url:'https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchListInPost.do',method:'POST',body};
}
export function searchUrl(portal,region='홍성군') {
  const request=listRequest(portal,region,1);
  if(portal!=='work24')return request.url;
  return 'https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do?'+request.body;
}
export function parsePortalList(portal,html,region,now=new Date()) {
  if(portal==='jobkorea')return parseJobkoreaList(html,region,now);
  if(portal==='work24')return parseWork24List(html,region,now);
  const result=saraminList(html,region,now);
  result.jobs=result.jobs.map(job=>({...job,...jobLink(job.url),source:'saramin'}));
  return {...result,pageSize:50};
}
export function detailRequest(job) {return{url:job.portal==='saramin'?`https://m.saramin.co.kr/job-search/view?rec_idx=${job.externalId}`:job.url};}
export function parsePortalDetail(job,html) {return job.portal==='jobkorea'?job.affiliate?parseJobkoreaAffiliateDetail(html,job.regions,job.affiliate):parseJobkoreaDetail(html,job.regions):job.portal==='work24'?parseWork24Detail(html,job.regions):saraminDetail(html,job.regions);}
export function manualPortalJob(input) {
  if(!['홍성군','예산군'].includes(input.region))throw new Error('홍성군 또는 예산군을 선택해 주세요.');
  const job=baseJob(jobLink(input.url),input.company,input.title,input.region,new Date());
  if(!job.company||!job.title)throw new Error('회사명과 공고 제목을 입력해 주세요.');
  job.company=job.company.slice(0,120);job.title=job.title.slice(0,200);job.manual=true;job.registeredLabel='직접 등록';return job;
}
