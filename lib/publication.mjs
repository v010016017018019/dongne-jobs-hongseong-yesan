import {verifiedJobs,qualitySummary} from './quality.mjs';
import {mergeJobs} from './jobs.mjs';
import {applyDiscovery} from './freshness.mjs';
import {historyRows,emptyHistory,reconcileHistory,archivedJobs} from './history.mjs';
import {PORTALS,searchUrl} from './providers.mjs';
const jobFields=['id','canonicalId','portal','externalId','affiliate','url','company','title','regions','location','experience','employment','education','category','salary','deadlineLabel','expiresAt','registeredLabel','source','fetchedAt','checkedAt','locationNote','address','closed','originId','originUrl','originEvidence','originSourceCheckedAt','verificationError','firstSeenAt','isNew','locationStatus','exactAddress','coordinateConflict','closure'];
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
export function publicJob(job){
  const result=pick(job,jobFields);
  result.sites=(job.sites||[]).filter(site=>site.source!=='직접 확인한 근무지').map(site=>pick(site,['address','lat','lng','source','confirmedAt','verification','referenceUrl']));
  if(job.members)result.members=job.members.map(publicJob);
  if(job.archived){result.archived=true;result.archiveReason=job.archiveReason;}
  return result;
}
export function publicSnapshot({store,details,discovery,history,config={},now=Date.now()}){
  const raw=mergeJobs(store.jobs.filter(job=>!job.manual));
  const jobs=applyDiscovery(verifiedJobs(raw,details,{},now),discovery,now).map(publicJob);
  const rows=historyRows(raw,details,{},now),timeline=reconcileHistory(history||emptyHistory(rows),rows,new Date(now).toISOString()).history;
  const providers=Object.entries(PORTALS).map(([id,label])=>{
    const meta=pick(store.providers[id]||{},['fetchedAt','lastStartedAt','totals','pages','truncated','error','interrupted','pausedForAccess','collectionComplete','detailsTotal','detailsVerified','detailsFinishedAt','failedDetails','lastChanges']);
    return {id,label,...meta,count:jobs.filter(job=>job.portal===id).length,located:jobs.filter(job=>job.portal===id&&job.sites.length).length,searchUrls:Object.fromEntries(['홍성군','예산군'].map(region=>[region,searchUrl(id,region)]))};
  });
  const archive=archivedJobs(timeline,jobs).map(publicJob);
  const events=timeline.events.map(event=>({...pick(event,['id','type','at','jobId','canonicalId','company','title','url','portal']),changes:(event.changes||[]).filter(change=>['title','company','address','expiresAt','deadlineLabel','salary','employment','education','closure'].includes(change.field)).map(change=>pick(change,['field','before','after','newlyConfirmed']))}));
  return {jobs:{version:'7.0.0',online:true,localOnly:false,tileUrl:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',jobs,providers,historyInitializedAt:timeline.initializedAt,historyCount:events.length,quality:qualitySummary(jobs),fetchedAt:providers.map(provider=>provider.fetchedAt).filter(Boolean).sort().at(-1)||null},history:{initializedAt:timeline.initializedAt,events,archived:archive},publication:{updatesEnabled:config.updatesEnabled===true,repository:config.repository||'',workflow:config.repository?`${config.repository}/actions/workflows/refresh.yml`:'',schedule:'6시간 간격 예약 실행',generatedAt:new Date(now).toISOString()}};
}
