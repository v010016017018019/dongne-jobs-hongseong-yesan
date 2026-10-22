import {sanitizeEducation,educationInfo,educationAssessment} from './education.js';
export const stages={'':'미지정',planned:'지원 예정',applied:'지원 완료',interview:'면접',result:'결과 확인'};
export const locationLabels={all:'모든 위치',needed:'위치 확인 필요 전체',address:'정확한 주소 없음',coordinates:'주소는 있으나 좌표 없음',conflict:'좌표 충돌',outside:'지역 밖 근무지',verified:'위치 확인 완료'};
export function payInfo(value){
  const raw=String(value||'').replace(/\s+/g,' ').trim();
  const period=/월급/.test(raw)?'month':/연봉/.test(raw)?'year':/시급/.test(raw)?'hour':/일급/.test(raw)?'day':'unknown';
  const match=raw.match(/(?:월급|연봉|시급|일급)\s*([\d,.]+)\s*(만\s*원|원)?(?:\s*(?:~|∼|－|-|에서)\s*([\d,.]+)\s*(만\s*원|원)?)?/);
  let min=null,max=null;
  if(match&&(match[2]||match[4])){const scale=unit=>unit?.replace(/\s/g,'')==='만원'?10000:1;min=Number(match[1].replaceAll(',',''))*scale(match[2]||match[4]);max=match[3]?Number(match[3].replaceAll(',',''))*scale(match[4]||match[2]):min;if(!Number.isFinite(min)||min<=0||!Number.isFinite(max)||max<min||max>1e10){min=null;max=null;}else if(!match[3]){const suffix=raw.slice(match.index+match[0].length).split(/[(),]/)[0];if(/이하|미만/.test(suffix))min=null;else if(/이상|초과/.test(suffix))max=null;}}
  return {raw:raw||'급여 미기재',period,min,max,negotiable:/협의|내규|면접.*결정/.test(raw),missing:!raw};
}
export function payMatches(value,filter){
  const info=payInfo(value),period=filter.payPeriod||'all';
  if(period==='missing')return info.missing;
  if(period==='negotiable')return info.negotiable;
  if(period==='all')return true;
  return info.period===period&&(!filter.payMin||info.min!==null&&info.min>=filter.payMin);
}
export function employmentKinds(value){
  const raw=String(value||'');const kinds=[];
  if(/정규직|기간의?\s*정함이?\s*없|무기계약/.test(raw))kinds.push('regular');
  if(/계약직|기간제|기간의?\s*정함이?\s*있|CONTRACTOR|TEMPORARY/.test(raw))kinds.push('contract');
  if(/시간제|아르바이트|알바|PART_TIME/.test(raw))kinds.push('part');
  if(/인턴|INTERN/.test(raw))kinds.push('intern');
  if(/파견/.test(raw))kinds.push('dispatch');
  if(/프리랜서/.test(raw))kinds.push('freelance');
  return kinds;
}
export function employmentText(value){const raw=String(value||'').trim(),labels={FULL_TIME:'상근',PART_TIME:'시간제',CONTRACTOR:'계약직',TEMPORARY:'기간제',INTERN:'인턴'},parts=raw.split(/[,\s·]+/).filter(Boolean);return parts.length&&parts.every(part=>labels[part])?[...new Set(parts.map(part=>labels[part]))].join(' · '):raw||'고용형태 미기재';}
export function conditionTags(value){
  const text=String(value||'').replace(/\s+/g,' '),tags=[];
  const add=(id,label,regex)=>{const found=text.match(regex);if(found&&!/(?:없음|없습니다|미제공|미운영|제공\s*안|제공되지\s*않|제공하지\s*않|불가|운영\s*안)/.test(found[0]))tags.push({id,label,evidence:found[0].trim()});};
  add('day','주간 근무',/(?:주간\s*(?:고정|근무)|주간직)[^.!?\n/;,·]{0,24}/);
  add('night','야간 근무',/(?:야간\s*(?:고정|근무)|야간직)[^.!?\n/;,·]{0,24}/);
  add('shift','교대 근무',/(?:[234]\s*교대|주야\s*교대|교대\s*근무)[^.!?\n/;,·]{0,24}/);
  add('dorm','기숙사 안내',/기숙사[^.!?\n/;,·]{0,35}/);
  add('bus','통근버스 안내',/(?:통근|통학|출퇴근|셔틀)\s*(?:버스|차량)[^.!?\n/;,·]{0,35}/);
  return tags;
}
export function jobConditions(job){return [...new Map([...conditionTags([job.title,job.category].filter(Boolean).join(' / ')),...(job.conditions||[]).filter(tag=>conditionTags(tag.evidence).some(found=>found.id===tag.id))].map(tag=>[tag.id,tag])).values()];}
export function locationReason(job){
  if(job.sites?.length)return 'verified';
  if(job.coordinateConflict)return 'conflict';
  if(job.locationStatus==='outside')return 'outside';
  return job.exactAddress?'coordinates':'address';
}
export function featureMatches(job,filter,personal={}){
  const members=job.members||[job],key=job.canonicalId||job.id;
  if(filter.unreadOnly&&personal.reads?.[key])return false;
  if(filter.sinceVisit&&(!personal.visit?.previousAt||!job.firstSeenAt||Date.parse(job.firstSeenAt)<=Date.parse(personal.visit.previousAt)))return false;
  if(filter.applicationStage!==undefined&&filter.applicationStage!=='all'&&(personal.applications?.[key]?.stage||'')!==filter.applicationStage)return false;
  const reason=locationReason(job);
  if(filter.locationReason&&filter.locationReason!=='all'&&(filter.locationReason==='needed'?reason==='verified':filter.locationReason!==reason))return false;
  const education=sanitizeEducation(filter.education),assessment=educationAssessment(job);
  if(education.length&&!education.includes(assessment.kind))return false;
  return members.some(member=>(!education.length||assessment.kind==='unknown'||education.includes(educationInfo(member.education).kind))&&payMatches(member.salary,filter)&&(!filter.employment||filter.employment==='all'||(filter.employment==='missing'?!member.employment:employmentKinds(member.employment).includes(filter.employment)))&&(!filter.condition||filter.condition==='all'||jobConditions(member).some(tag=>tag.id===filter.condition)));
}
export function sanitizeSearch(input={}){
  const result={};const enums={region:['all','홍성군','예산군'],portal:['all','saramin','jobkorea','work24'],experience:['all','신입','경력','경력무관'],sort:['default','newest','deadline','company','distance'],scope:['all','local'],payPeriod:['all','month','year','hour','day','missing','negotiable'],employment:['all','regular','contract','part','intern','dispatch','freelance','missing'],condition:['all','day','night','shift','dorm','bus'],locationReason:Object.keys(locationLabels),applicationStage:['all','',...Object.keys(stages).filter(Boolean)]};
  for(const [key,values]of Object.entries(enums))if(values.includes(input[key]))result[key]=input[key];
  for(const key of ['locatedOnly','savedOnly','groupDuplicates','visibleOnly','soon','newOnly','unreadOnly','sinceVisit'])if(typeof input[key]==='boolean')result[key]=input[key];
  result.education=sanitizeEducation(input.education);
  result.query=String(input.query||'').trim().slice(0,160);
  result.payMin=Math.max(0,Math.min(1e10,Number(input.payMin)||0));
  if([5,10,20,'all'].includes(input.radius))result.radius=input.radius;
  if(input.reference&&Number.isFinite(input.reference.lat)&&Number.isFinite(input.reference.lng)&&input.reference.lat>=33&&input.reference.lat<=39&&input.reference.lng>=124&&input.reference.lng<=132)result.reference={lat:input.reference.lat,lng:input.reference.lng};
  if(result.sort==='distance'&&!result.reference)result.sort='default';
  return result;
}
