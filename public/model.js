import {featureMatches} from './features.js';
export function exactAddressKey(value) {
  const clean=String(value||'').normalize('NFC').replace(/^\(?\d{5}\)?\s*/,'').replace(/^충청남도/,'충남').trim();
  if(!/홍성군|예산군/.test(clean)||/\*|미상|인근|일원|주변|미정|예정|거주지|전지역|전국/.test(clean))return '';
  const road=clean.match(/^(.+?(?:대로|로|길))\s+([1-9]\d*(?:-\d+)?)(?=\s|[,.(]|$)/);
  const land=clean.match(/^(.+?(?:읍|면|동|리|가))\s+([1-9]\d*(?:-\d+)?)(?=\s|[,.(]|$)/);
  const match=road||land;
  return match?`${match[1]} ${match[2]}`.replace(/\s/g,''):'';
}
export function kmBetween(a,b) {
  const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlng=(b.lng-a.lng)*rad;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function distanceFrom(job,point) {
  return point&&job.sites?.length?Math.min(...job.sites.map(site=>kmBetween(point,site))):Infinity;
}
export function civilDaysUntil(expiresAt,now=Date.now()) {
  return Math.floor((Date.parse(expiresAt)+32400000)/86400000)-Math.floor((now+32400000)/86400000);
}
export function favoriteKey(job) {return job.canonicalId||job.originId||job.id;}
export function groupJobs(jobs,enabled=true) {
  if(!enabled)return jobs.map(job=>({...job,members:[job],canonicalId:favoriteKey(job)}));
  const groups=new Map();
  for(const job of jobs){const key=favoriteKey(job);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(job);}
  return [...groups].map(([key,members])=>{
    const primary=members.find(job=>job.id===key)||members[0],sites=[];
    for(const member of members)for(const site of member.sites||[]){const addressKey=exactAddressKey(site.address);if(!sites.some(item=>addressKey?exactAddressKey(item.address)===addressKey:item.lat===site.lat&&item.lng===site.lng))sites.push(site);}
    return {...primary,id:key,canonicalId:key,members,isNew:members.some(job=>job.isNew),exactAddress:members.some(job=>job.exactAddress),coordinateConflict:members.some(job=>job.coordinateConflict),firstSeenAt:members.map(job=>job.firstSeenAt).filter(Boolean).sort()[0]||null,regions:[...new Set(members.flatMap(job=>job.regions))],sites,portals:[...new Set(members.map(job=>job.portal))]};
  });
}
export function filterJobs(jobs,filter,saved=new Set(),personal={}) {
  let members=jobs.filter(job=>filter.portal==='all'||job.portal===filter.portal);
  let groups=groupJobs(members,filter.groupDuplicates!==false);
  const result=groups.filter(job=>{
    if(!featureMatches(job,filter,personal))return false;
    if(filter.region!=='all'&&!job.regions.includes(filter.region))return false;
    if(filter.locatedOnly&&!job.sites.length)return false;
    if(filter.savedOnly&&!saved.has(favoriteKey(job)))return false;
    if(filter.newOnly&&!job.isNew)return false;
    if(filter.scope==='local'&&job.locationStatus==='outside'&&!job.sites.length)return false;
    if(filter.query&&!job.members.some(member=>[member.company,member.title,member.category,member.location,member.address,...(member.sites||[]).map(site=>site.address)].join(' ').toLowerCase().includes(filter.query.toLowerCase())))return false;
    const experience=job.members.map(member=>member.experience||'').join(' / ');
    if(filter.experience==='경력'&&!/경력|\d.*년/.test(experience.replace(/경력무관/g,'')))return false;
    if(filter.experience!=='all'&&filter.experience!=='경력'&&!experience.includes(filter.experience))return false;
    if(filter.soon&&(!job.expiresAt||civilDaysUntil(job.expiresAt)>7))return false;
    const distance=distanceFrom(job,filter.reference);
    if(filter.reference&&Number.isFinite(filter.radius)&&distance>filter.radius)return false;
    if(filter.visibleOnly&&filter.bounds&&!job.sites.some(site=>site.lat>=filter.bounds.south&&site.lat<=filter.bounds.north&&site.lng>=filter.bounds.west&&site.lng<=filter.bounds.east))return false;
    return true;
  });
  if(filter.sort==='deadline')result.sort((a,b)=>(Date.parse(a.expiresAt)||Infinity)-(Date.parse(b.expiresAt)||Infinity));
  if(filter.sort==='company')result.sort((a,b)=>a.company.localeCompare(b.company,'ko'));
  if(filter.sort==='distance')result.sort((a,b)=>distanceFrom(a,filter.reference)-distanceFrom(b,filter.reference));
  if(filter.sort==='newest')result.sort((a,b)=>(Date.parse(b.firstSeenAt)||0)-(Date.parse(a.firstSeenAt)||0));
  return result;
}
export function jobsCsv(jobs) {
  const field=value=>`"${String(value??'').replace(/^(\s*)([=+@-])/,"'$1$2").replaceAll('"','""')}"`;
  const rows=[['회사명','공고 제목','지역','근무지 주소','경력','마감','출처','원문 링크','급여(원문)','고용형태(원문)','앱 최초 발견','학력(원문)']];
  for(const job of jobs)rows.push([job.company,job.title,job.regions.join(' · '),job.sites.map(site=>site.address).join(' / ')||job.address||'',job.experience,job.deadlineLabel,(job.members||[job]).map(member=>member.affiliate?`${member.portal} (${member.affiliate})`:member.portal).join(' / '),(job.members||[job]).map(member=>member.url).join(' / '),[...new Set((job.members||[job]).map(member=>member.salary).filter(Boolean))].join(' / '),[...new Set((job.members||[job]).map(member=>member.employment).filter(Boolean))].join(' / '),job.firstSeenAt||'',[...new Set((job.members||[job]).map(member=>member.education||'학력 미기재'))].join(' / ')]);
  return '\ufeff'+rows.map(row=>row.map(field).join(',')).join('\r\n');
}
