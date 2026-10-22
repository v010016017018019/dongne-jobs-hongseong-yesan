import {latestEducation} from '../public/education.js';
const day=86400000;
const fields=['title','company','address','expiresAt','deadlineLabel','salary','employment','education','closure'];
export function historyRows(raw,details={},overrides={},now=Date.now()){
  const lookup=new Map(raw.map(job=>[job.id,{...job,...details[job.id],education:latestEducation(job,details[job.id])}]));
  return [...lookup.values()].map(job=>{
    let current=job;const seen=new Set([job.id]);while(current.originId&&lookup.has(current.originId)&&!seen.has(current.originId)){seen.add(current.originId);current=lookup.get(current.originId);}
    const canonicalId=current.originId&&!seen.has(current.originId)?current.originId:current.id;
    const address=overrides[job.id]?.address||job.address||job.sites?.[0]?.address||'';
    return {id:job.id,canonicalId,portal:job.portal,url:job.url,company:job.company,title:job.title,regions:job.regions,address,expiresAt:job.expiresAt||null,deadlineLabel:job.deadlineLabel||'',salary:job.salary||'',employment:job.employment||'',education:job.education||'',factsVersion:job.factsVersion||0,closure:job.closed?'closed':job.expiresAt&&Date.parse(job.expiresAt)<now?'deadline':'open'};
  });
}
export function emptyHistory(rows,at=new Date().toISOString()){
  return {initializedAt:at,snapshots:Object.fromEntries(rows.map(row=>[row.id,{...row,present:true,lastSeenAt:at}])),events:[]};
}
export function reconcileHistory(history,rows,at=new Date().toISOString(),protectedIds=[]){
  const next=structuredClone(history),seen=new Set(),events=[];
  const event=(type,row,changes=[])=>events.push({id:crypto.randomUUID(),type,at,jobId:row.id,canonicalId:row.canonicalId,company:row.company,title:row.title,url:row.url,portal:row.portal,changes});
  for(const row of rows){
    seen.add(row.id);const old=next.snapshots[row.id];
    if(!old)event('added',row);
    else {
      if(!old.present)event('reappeared',row);
      const changes=fields.filter(field=>(old[field]??'')!==(row[field]??'')).map(field=>({field,before:old[field]??'',after:row[field]??'',newlyConfirmed:field!=='closure'&&(!old[field]&&Boolean(row[field])||(old.factsVersion||0)<5&&row.factsVersion>=5)}));
      if(changes.length)event(changes.every(change=>change.newlyConfirmed)?'confirmed':'changed',row,changes);
    }
    next.snapshots[row.id]={...row,present:true,lastSeenAt:at};
  }
  for(const [id,row]of Object.entries(next.snapshots))if(!seen.has(id)){
    let snapshot=row;
    if(row.closure==='open'&&row.expiresAt&&Date.parse(row.expiresAt)<Date.parse(at)){snapshot={...row,closure:'deadline'};event('changed',snapshot,[{field:'closure',before:'open',after:'deadline',newlyConfirmed:false}]);}
    if(row.present){event('missing',snapshot);snapshot={...snapshot,present:false,missingAt:at};}
    next.snapshots[id]=snapshot;
  }
  const earliest=Date.parse(at)-90*day;
  next.events=[...events,...next.events].filter(item=>Date.parse(item.at)>=earliest).slice(0,10000);
  const protectedSet=new Set(protectedIds);
  for(const [id,row]of Object.entries(next.snapshots))if(!row.present&&Date.parse(row.missingAt||row.lastSeenAt)<earliest&&!protectedSet.has(row.canonicalId))delete next.snapshots[id];
  return {history:next,addedEvents:events};
}
export function archivedJobs(history,active){
  const current=new Set(active.map(job=>job.canonicalId)),groups=new Map();
  for(const row of Object.values(history.snapshots)){
    if(current.has(row.canonicalId))continue;
    if(!groups.has(row.canonicalId))groups.set(row.canonicalId,[]);groups.get(row.canonicalId).push(row);
  }
  return [...groups].map(([key,members])=>{
    const primary=members.find(row=>row.id===key)||members[0];
    return {...primary,id:key,canonicalId:key,members,sites:[],archived:true,isNew:false,archiveReason:members.some(row=>row.closure==='closed')?'원문 마감 확인':members.some(row=>row.closure==='deadline')?'마감일 경과':'사이트 목록에서 사라짐 · 마감 여부 미확인'};
  });
}
