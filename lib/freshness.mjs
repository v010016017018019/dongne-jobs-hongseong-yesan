export const REFRESH_INTERVAL_MS=6*60*60*1000;
export const NEW_WINDOW_MS=7*24*60*60*1000;
const stamp=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0;

export function nextCheckAt(meta={},interval=REFRESH_INTERVAL_MS){
  const last=Math.max(stamp(meta.fetchedAt),stamp(meta.lastStartedAt));
  return last?last+interval:0;
}
export function duePortals(providers,now=Date.now(),interval=REFRESH_INTERVAL_MS){
  return Object.keys(providers).filter(id=>nextCheckAt(providers[id],interval)<=now);
}
export function createAutoRefresh({providers,running,enabled,collect,now=Date.now}){
  let active=false;
  return async()=>{
    if(active||running()||!enabled())return false;
    const due=duePortals(providers(),now());
    if(!due.length)return false;
    active=true;
    try{await collect(due);return true;}finally{active=false;}
  };
}

export function emptyDiscovery(at=new Date().toISOString()){
  return {initializedAt:at,firstSeenById:{},firstSeenByCanonical:{}};
}
export function recordDiscovery(history,raw,details,at=new Date().toISOString(),baseline=false){
  const lookup=new Map(raw.map(job=>[job.id,{...job,...details[job.id]}])),groups=new Map();
  for(const job of lookup.values()){
    if(!Object.hasOwn(history.firstSeenById,job.id))history.firstSeenById[job.id]=baseline?null:at;
    let current=job;const seen=new Set([job.id]);
    while(current.originId&&lookup.has(current.originId)&&!seen.has(current.originId)){seen.add(current.originId);current=lookup.get(current.originId);}
    const canonical=current.originId&&!seen.has(current.originId)?current.originId:current.id;
    if(!groups.has(canonical))groups.set(canonical,[]);
    groups.get(canonical).push(history.firstSeenById[job.id]);
  }
  for(const [key,values]of groups){
    if(Object.hasOwn(history.firstSeenByCanonical,key))values.push(history.firstSeenByCanonical[key]);
    history.firstSeenByCanonical[key]=values.includes(null)?null:values.filter(Boolean).sort()[0]||null;
  }
  return history;
}
export function applyDiscovery(jobs,history,now=Date.now()){
  return jobs.map(job=>{
    const key=job.canonicalId||job.originId||job.id;
    const firstSeenAt=Object.hasOwn(history.firstSeenByCanonical,key)?history.firstSeenByCanonical[key]:history.firstSeenById[job.id]||null;
    const age=firstSeenAt?now-Date.parse(firstSeenAt):Infinity;
    return {...job,firstSeenAt,isNew:Number.isFinite(age)&&age>=0&&age<NEW_WINDOW_MS};
  });
}
