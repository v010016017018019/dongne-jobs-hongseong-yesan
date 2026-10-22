import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isOpen,mergeJobs,text,validCoordinate,detailedAddress} from './lib/jobs.mjs';
import {PORTALS,jobLink,listRequest,searchUrl,parsePortalList,detailRequest,parsePortalDetail,manualPortalJob,affiliatedWork24Url,affiliatedSaraminUrl} from './lib/providers.mjs';
import {verifiedJobs,qualitySummary} from './lib/quality.mjs';
import {REFRESH_INTERVAL_MS,NEW_WINDOW_MS,nextCheckAt,createAutoRefresh,emptyDiscovery,recordDiscovery,applyDiscovery} from './lib/freshness.mjs';
import {emptyPersonal,updatePersonal,canonicalizePersonal} from './lib/personal.mjs';
import {historyRows,emptyHistory,reconcileHistory,archivedJobs} from './lib/history.mjs';
import {publicFacts} from './lib/facts.mjs';

const root=dirname(fileURLToPath(import.meta.url)),dataDir=resolve(process.env.JOB_MAP_DATA_DIR||resolve(root,'data'));
await mkdir(dataDir,{recursive:true});
const env={};
try{for(const line of(await readFile(resolve(root,'.env'),'utf8')).split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch(e){if(e.code!=='ENOENT')throw e;}
const port=Number(process.env.PORT||env.PORT||4327);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT를 확인해 주세요.');
const tileUrl=process.env.TILE_URL||env.TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const tileOrigin=new URL(tileUrl).origin;
const tileAttribution=process.env.TILE_ATTRIBUTION||env.TILE_ATTRIBUTION||'© OpenStreetMap contributors';
async function readJson(name,fallback){try{return JSON.parse(await readFile(resolve(dataDir,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw new Error(`data/${name} 파일을 읽을 수 없습니다. 원본을 보관하고 형식을 확인해 주세요.`);}}
let writeQueue=Promise.resolve();
async function saveJson(name,value){const serialized=JSON.stringify(value,null,2);const task=writeQueue.then(async()=>{const path=resolve(dataDir,name);await writeFile(path+'.tmp',serialized,'utf8');await rename(path+'.tmp',path);});writeQueue=task.catch(()=>{});return task;}
const emptyMeta=()=>({fetchedAt:null,totals:{},pages:{},truncated:[],error:'',lastStartedAt:null});
let store=await readJson('jobs-v7.json',null),detailCache=await readJson('details-v7.json',null),manual=await readJson('manual-v7.json',null),overrides=await readJson('locations-v7.json',null);
if(!store){
  const legacy=await readJson('jobs.json',{jobs:[],fetchedAt:null,totals:{},pages:{},truncated:[]});
  store={jobs:legacy.jobs.map(job=>({...job,...jobLink(job.url),source:'saramin'})),providers:Object.fromEntries(Object.keys(PORTALS).map(key=>[key,emptyMeta()]))};
  store.providers.saramin={...emptyMeta(),fetchedAt:legacy.fetchedAt,totals:legacy.totals,pages:legacy.pages,truncated:legacy.truncated};
  await saveJson('jobs-v7.json',store);
}
if(!detailCache){const legacy=await readJson('details.json',{});detailCache=Object.fromEntries(Object.entries(legacy).map(([key,value])=>[`saramin:${key}`,value]));await saveJson('details-v7.json',detailCache);}
if(!manual){const legacy=await readJson('manual.json',[]);manual=legacy.map(job=>({...job,...jobLink(job.url),source:'saramin',manual:true}));await saveJson('manual-v7.json',manual);}
if(!overrides){const legacy=await readJson('locations.json',{});overrides=Object.fromEntries(Object.entries(legacy).map(([key,value])=>[`saramin:${key}`,value]));await saveJson('locations-v7.json',overrides);}
for(const portal of Object.keys(PORTALS))store.providers[portal]||=emptyMeta();
for(const meta of Object.values(store.providers))if(meta.collectionComplete===false){meta.interrupted=true;meta.error=meta.error||'이전 조회가 중단됐습니다. 저장된 자료를 표시합니다. 공고 가져오기로 이어서 확인하세요.';}
let discovery=await readJson('discovery-v7.json',null),settings=await readJson('settings-v7.json',{autoRefresh:true});
let origins=await readJson('origins-v7.json',{});
for(const [id,detail]of Object.entries(detailCache))if(detail.originId&&detail.originUrl&&!origins[id])origins[id]={originId:detail.originId,originUrl:detail.originUrl,sourceCheckedAt:detail.checkedAt};
if(!discovery){discovery=emptyDiscovery();recordDiscovery(discovery,mergeJobs([...store.jobs,...manual]),detailCache,discovery.initializedAt,true);await saveJson('discovery-v7.json',discovery);}
let personal=await readJson('personal-v7.json',emptyPersonal()),history=await readJson('history-v7.json',null);
let personalQueue=Promise.resolve();
function mutatePersonal(change){const task=personalQueue.then(async()=>{const next=change(personal);if(JSON.stringify(next)!==JSON.stringify(personal))await saveJson('personal-v7.json',next);personal=next;return personal;});personalQueue=task.catch(()=>{});return task;}
if(!history){history=emptyHistory(historyRows(mergeJobs([...store.jobs,...manual]),detailCache,overrides));await saveJson('history-v7.json',history);}
let historyQueue=Promise.resolve();
function refreshHistory(force=false){const task=historyQueue.then(async()=>{const rows=historyRows(mergeJobs([...store.jobs,...manual]),detailCache,overrides);await mutatePersonal(value=>canonicalizePersonal(value,[...Object.values(history.snapshots),...rows]));const result=reconcileHistory(history,rows,new Date().toISOString(),[...personal.savedIds,...Object.keys(personal.applications)]);if(force||result.addedEvents.length){await saveJson('history-v7.json',result.history);history=result.history;}});historyQueue=task.catch(()=>{});return task;}
await refreshHistory();
let status={running:false,portal:null,phase:'',completed:0,total:0,error:'',lastStartedAt:null};
function getJobs(){return applyDiscovery(verifiedJobs(mergeJobs([...store.jobs,...manual]),detailCache,overrides),discovery);}
function automaticStatus(){const providers=Object.entries(PORTALS).map(([id,label])=>({id,label,pausedForAccess:Boolean(store.providers[id].pausedForAccess),nextCheckAt:store.providers[id].pausedForAccess?null:new Date(Math.max(Date.now(),nextCheckAt(store.providers[id]))).toISOString(),lastSuccessAt:store.providers[id].fetchedAt||null,lastAttemptAt:store.providers[id].lastStartedAt||null,error:store.providers[id].error||''}));return {enabled:settings.autoRefresh,intervalHours:REFRESH_INTERVAL_MS/3600000,newDays:NEW_WINDOW_MS/86400000,nextCheckAt:settings.autoRefresh?providers.map(p=>p.nextCheckAt).filter(Boolean).sort()[0]||null:null,providers};}
const publicConfig=()=>({tileUrl,tileAttribution,localOnly:true,version:'7.0.0',portals:PORTALS});
function payload(){
  const jobs=getJobs(),providers=Object.entries(PORTALS).map(([id,label])=>({id,label,...store.providers[id],count:jobs.filter(job=>job.portal===id).length,located:jobs.filter(job=>job.portal===id&&job.sites.length).length,searchUrls:{'홍성군':searchUrl(id,'홍성군'),'예산군':searchUrl(id,'예산군')}}));
  return {...publicConfig(),jobs,providers,status,personal,historyInitializedAt:history.initializedAt,historyCount:history.events.length,automatic:automaticStatus(),newCount:new Set(jobs.filter(job=>job.isNew).map(job=>job.canonicalId)).size,quality:qualitySummary(jobs),fetchedAt:providers.map(provider=>provider.fetchedAt).filter(Boolean).sort().at(-1)||null};
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const portalFetch=new Map();
function publicHtml(request,portal){
  if(!portalFetch.has(portal))portalFetch.set(portal,{lastRequest:0,queue:Promise.resolve()});
  const fetchState=portalFetch.get(portal);
  const task=fetchState.queue.then(async()=>{
    await delay(Math.max(0,(portal==='jobkorea'?3500:1200)-(Date.now()-fetchState.lastRequest)));fetchState.lastRequest=Date.now();
    const label=PORTALS[portal];let response;
    try{response=await fetch(request.url,{method:request.method||'GET',body:request.body,headers:{'User-Agent':'HongseongYesanLocalJobMap/7.0 (personal local job map)',Accept:'text/html','Accept-Language':'ko-KR',...(request.body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...request.headers},signal:AbortSignal.timeout(20000)});}catch{throw new Error(`${label}에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.`);}
    if(!response.ok)throw new Error(`${label} 접속 실패(HTTP ${response.status}). 해당 사이트 조회를 중단했습니다.`);
    if(/jkConfirm\.aspx|captcha/i.test(response.url||''))throw new Error(`${label}에서 접속 확인을 요청했습니다. 자동 조회를 중지하고 기존 자료를 표시합니다.`);
    const html=await response.text();
    if(html.length>5000000||/access denied|비정상적인 접근|captcha/i.test(html.slice(0,5000))||/보안정책에\s*의하여|보안문자(?:를)?\s*입력/.test(html))throw new Error(`${label}에서 접속 확인을 요청했습니다. 자동 조회를 중지하고 기존 자료를 표시합니다.`);
    return html;
  });fetchState.queue=task.catch(()=>{});return task;
}
async function collect(maxPages=100,portals=Object.keys(PORTALS),force=false,trigger='manual'){
  status={running:true,portal:null,phase:'사이트별 공고와 근무지 재검증 중',completed:0,total:0,error:'',lastStartedAt:new Date().toISOString(),trigger,progress:{}};
  const errors=[];
  try{
    await Promise.all(portals.map(async portal=>{
      const label=PORTALS[portal],meta=store.providers[portal],progress={phase:'목록 확인 중',completed:0,total:0,running:true};status.progress[portal]=progress;
      meta.lastStartedAt=new Date().toISOString();meta.error='';meta.interrupted=false;meta.pausedForAccess=false;meta.collectionComplete=false;meta.trigger=trigger;meta.detailsFinishedAt=null;await saveJson('jobs-v7.json',store);
      const update=()=>{status.completed=Object.values(status.progress).reduce((sum,p)=>sum+p.completed,0);status.total=Object.values(status.progress).reduce((sum,p)=>sum+p.total,0);};
      try{
        const collected=[],totals={},pages={},truncated=[];
        for(const region of ['홍성군','예산군']){
          const seen=new Set();pages[region]=0;
          for(let page=1;page<=maxPages;page++){
            progress.phase=`${region} 목록 ${page}페이지`;
            const parsed=parsePortalList(portal,await publicHtml(listRequest(portal,region,page),portal),region);
            if(page===1)totals[region]=parsed.total;
            const fingerprint=parsed.jobs.map(job=>job.id).join(',');
            if(fingerprint&&seen.has(fingerprint)){truncated.push(region);break;}seen.add(fingerprint);
            collected.push(...parsed.jobs);pages[region]=page;
            if(parsed.pageItems<parsed.pageSize||(Number.isFinite(totals[region])&&page*parsed.pageSize>=totals[region]))break;
            if(page===maxPages)truncated.push(region);
          }
        }
        const jobs=mergeJobs(collected);
        if(truncated.length){meta.lastAttemptPages=pages;meta.lastAttemptTruncated=truncated;throw new Error(`${label} 목록을 끝까지 확인하지 못했습니다. 기존 공고를 유지합니다. (${truncated.join(' · ')})`);}
        const previous=store.jobs.filter(job=>job.portal===portal),at=new Date().toISOString(),ids=new Set(jobs.map(job=>job.id));
        const added=jobs.filter(job=>!Object.hasOwn(discovery.firstSeenById,job.id)).length;
        store.jobs=[...store.jobs.filter(job=>job.portal!==portal),...jobs];
        recordDiscovery(discovery,mergeJobs([...store.jobs,...manual]),detailCache,at);
        Object.assign(meta,{fetchedAt:at,totals,pages,truncated,lastAttemptTruncated:[],lastChanges:{at,added,removed:previous.filter(job=>!ids.has(job.id)).length}});
        await saveJson('discovery-v7.json',discovery);await saveJson('jobs-v7.json',store);
        const pending=jobs.filter(job=>(!overrides[job.id]||detailCache[job.id]?.factsVersion!==5)&&(force||job.affiliate==='고용24'&&origins[job.id]&&!detailCache[job.id]?.originId||detailCache[job.id]?.factsVersion!==5||!detailCache[job.id]?.checkedAt||detailCache[job.id]?.verificationError||Date.now()-Date.parse(detailCache[job.id].checkedAt)>86400000));
        progress.total=pending.length;progress.phase='근무지 재검증';meta.detailsTotal=jobs.length;update();
        let consecutiveFailures=0;const failed=[];
        for(const job of pending){
          try {
          const html=await publicHtml(detailRequest(job),portal);let detail={...parsePortalDetail(job,html),...publicFacts(job,html)};
          if(job.affiliate==='고용24'||job.portal==='work24') {
            const published=job.affiliate==='고용24'?affiliatedWork24Url(html):affiliatedSaraminUrl(html);
            let linked=published;
            if(!linked&&job.affiliate==='고용24'&&origins[job.id]?.originUrl){try{const previous=jobLink(origins[job.id].originUrl);if(previous.portal==='work24')linked=previous;}catch{}}
            if(linked) {
              if(published)origins[job.id]={originId:linked.id,originUrl:linked.url,sourceCheckedAt:new Date().toISOString()};
              const linkedJob={...job,...linked,affiliate:undefined,regions:store.jobs.find(item=>item.id===linked.id)?.regions||job.regions},cached=detailCache[linked.id];
              if(cached&&!cached.verificationError&&cached.factsVersion===5&&Date.now()-Date.parse(cached.checkedAt)<86400000)detail={...cached};else {const linkedHtml=await publicHtml(detailRequest(linkedJob),linked.portal);detail={...parsePortalDetail(linkedJob,linkedHtml),...publicFacts(linkedJob,linkedHtml)};}
              detail={...detail,originId:linked.id,originUrl:linked.url,originEvidence:published?'공개 제휴 원문 링크':'이전에 확인한 제휴 링크로 원문 재확인',originSourceCheckedAt:origins[job.id]?.sourceCheckedAt};
            }
          }
          detailCache[job.id]={...detail,checkedAt:new Date().toISOString()};consecutiveFailures=0;
          }catch(error) {
            if(/접속 확인|구조 변경|접근 제한|HTTP (?:403|429|503)/.test(error.message))throw error;
            failed.push(job.id);consecutiveFailures++;detailCache[job.id]={...detailCache[job.id],verificationError:error.message};
            if(consecutiveFailures>=3)throw new Error(`${label} 상세공고 연결이 연속 3회 실패했습니다. 확인한 데이터와 진행 기록을 저장했습니다.`);
          }
          progress.completed++;update();
          if(progress.completed%10===0){meta.detailsVerified=jobs.filter(item=>overrides[item.id]||detailCache[item.id]?.checkedAt&&!detailCache[item.id]?.verificationError).length;await saveJson('details-v7.json',detailCache);await saveJson('jobs-v7.json',store);}
        }
        recordDiscovery(discovery,mergeJobs([...store.jobs,...manual]),detailCache);
        await saveJson('discovery-v7.json',discovery);await saveJson('details-v7.json',detailCache);
        meta.failedDetails=failed;meta.detailsVerified=jobs.filter(item=>overrides[item.id]||detailCache[item.id]?.checkedAt&&!detailCache[item.id]?.verificationError).length;
        meta.collectionComplete=!truncated.length&&!failed.length;meta.detailsFinishedAt=new Date().toISOString();progress.phase=failed.length?`${failed.length}개 재확인 필요`:'검증 완료';
        if(failed.length){meta.error=`${label} 상세공고 ${failed.length}개 재확인 필요`;errors.push(meta.error);}
      }catch(error){meta.error=error.message;if(/접속 확인/.test(error.message))meta.pausedForAccess=true;errors.push(error.message);recordDiscovery(discovery,mergeJobs([...store.jobs,...manual]),detailCache);await saveJson('discovery-v7.json',discovery);await saveJson('details-v7.json',detailCache);}
      progress.running=false;progress.error=meta.error;
      await saveJson('jobs-v7.json',store);
    }));
    status.phase=errors.length?'일부 사이트 조회 중단 · 확인된 공고를 표시합니다':'채용사이트별 공고와 근무지 확인 완료';status.error=errors.join(' ');
  }catch(error){status.error=error.message;status.phase='조회 중단 · 저장된 공고를 표시합니다';}
  finally{try{await saveJson('origins-v7.json',origins);await refreshHistory(true);}catch(error){status.error=`변경 이력 저장 실패: ${error.message}`;}status.running=false;status.portal=null;}
}
const autoRefresh=createAutoRefresh({providers:()=>Object.fromEntries(Object.entries(store.providers).filter(([,meta])=>!meta.pausedForAccess)),running:()=>status.running,enabled:()=>settings.autoRefresh,collect:portals=>collect(100,portals,false,'automatic')});
const checkAutomatically=()=>autoRefresh().catch(error=>console.error('자동 갱신 오류:',error.message));
function json(res,code,value){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new Error('JSON 요청이 필요합니다.');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768)throw new Error('요청이 너무 큽니다.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('입력 내용을 확인해 주세요.');}}
let mutationQueue=Promise.resolve();
async function mutate(req,res,path){
  const input=await body(req);
  if(path==='/api/personal'){
    const id=String(input.id||''),active=getJobs(),job=active.find(job=>job.id===id||job.canonicalId===id)||Object.values(history.snapshots).find(job=>job.id===id||job.canonicalId===id);
    await mutatePersonal(value=>updatePersonal(value,input,job));return json(res,200,{personal});
  }
  if(path==='/api/auto-refresh'){
    if(typeof input.enabled!=='boolean')throw new Error('자동 갱신 설정을 확인해 주세요.');
    const next={...settings,autoRefresh:input.enabled};await saveJson('settings-v7.json',next);settings=next;
    if(settings.autoRefresh)void checkAutomatically();return json(res,200,payload());
  }
  if(path==='/api/refresh'){
    if(status.running)return json(res,202,{status});
    let portals=Array.isArray(input.portals)?[...new Set(input.portals)]:input.portal&&input.portal!=='all'?[input.portal]:Object.keys(PORTALS);
    if(!portals.length)throw new Error('채용사이트를 선택해 주세요.');
    if(portals.some(portal=>!PORTALS[portal]))throw new Error('채용사이트를 확인해 주세요.');
    portals=portals.filter(portal=>!store.providers[portal].lastStartedAt||Date.now()-Date.parse(store.providers[portal].lastStartedAt)>=300000);
    if(!portals.length)throw new Error('해당 사이트를 최근에 조회했습니다. 5분 후 다시 조회할 수 있습니다.');
    void collect(Math.max(1,Math.min(100,Math.trunc(Number(input.maxPages)||100))),portals,Boolean(input.reverify));return json(res,202,{status});
  }
  if(path==='/api/manual'){
    const job=manualPortalJob(input),next=[...manual.filter(item=>item.id!==job.id),job];recordDiscovery(discovery,mergeJobs([...store.jobs,...next]),detailCache);await saveJson('discovery-v7.json',discovery);await saveJson('manual-v7.json',next);manual=next;await refreshHistory(true);return json(res,201,payload());
  }
  if(path==='/api/location'){
    const job=getJobs().find(item=>item.id===String(input.id));if(!job)throw new Error('공고를 찾을 수 없습니다.');
    const lat=Number(input.lat),lng=Number(input.lng),address=text(input.address).slice(0,240);
    if(!validCoordinate(lat,lng)||!job.regions.some(region=>address.includes(region))||!detailedAddress(address))throw new Error('홍성군·예산군의 정확한 근무지 주소와 지도 위치를 지정해 주세요.');
    const next={...overrides,[job.id]:{lat,lng,address,source:'직접 확인한 근무지',confirmedAt:new Date().toISOString()}};await saveJson('locations-v7.json',next);overrides=next;await refreshHistory(true);return json(res,200,payload());
  }
  return json(res,404,{error:'요청한 기능이 없습니다.'});
}
const staticFiles={
  '/education.js':['public/education.js','text/javascript; charset=utf-8'],
  '/features.js':['public/features.js','text/javascript; charset=utf-8'],
  '/model.js':['public/model.js','text/javascript; charset=utf-8'],
  '/vendor/markercluster.js':['node_modules/leaflet.markercluster/dist/leaflet.markercluster.js','text/javascript; charset=utf-8'],
  '/vendor/MarkerCluster.css':['node_modules/leaflet.markercluster/dist/MarkerCluster.css','text/css; charset=utf-8'],
  '/':['public/index.html','text/html; charset=utf-8'],'/app.js':['public/app.js','text/javascript; charset=utf-8'],'/links.js':['public/links.js','text/javascript; charset=utf-8'],'/filters.js':['public/filters.js','text/javascript; charset=utf-8'],'/styles.css':['public/styles.css','text/css; charset=utf-8'],'/favicon.svg':['public/favicon.svg','image/svg+xml'],
  '/vendor/leaflet.js':['node_modules/leaflet/dist/leaflet.js','text/javascript; charset=utf-8'],'/vendor/leaflet.css':['node_modules/leaflet/dist/leaflet.css','text/css; charset=utf-8'],'/vendor/leaflet.js.map':['node_modules/leaflet/dist/leaflet.js.map','application/json'],
};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${tileOrigin}; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`);
  const hosts=[`localhost:${port}`,`127.0.0.1:${port}`];if(!hosts.includes(req.headers.host)||(req.headers.origin&&!hosts.map(host=>`http://${host}`).includes(req.headers.origin)))return json(res,403,{error:'이 PC의 채용지도에서만 요청할 수 있습니다.'});
  try{const path=new URL(req.url,`http://localhost:${port}`).pathname;
    if(req.method==='GET'&&path==='/api/jobs')return json(res,200,payload());if(req.method==='GET'&&path==='/api/config')return json(res,200,publicConfig());
    if(req.method==='GET'&&path==='/api/history')return json(res,200,{initializedAt:history.initializedAt,events:history.events,archived:archivedJobs(history,getJobs())});
    if(req.method==='POST'&&path.startsWith('/api/')){const task=mutationQueue.then(()=>mutate(req,res,path));mutationQueue=task.catch(()=>{});await task;return;}
    if(req.method==='GET'&&staticFiles[path]){const[file,type]=staticFiles[path],data=await readFile(resolve(root,file));res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});return res.end(data);}
    json(res,404,{error:'페이지를 찾을 수 없습니다.'});
  }catch(error){json(res,400,{error:error.message||'처리하지 못했습니다.'});}
});
if(process.argv.includes('--collect-only')){
  const sourceArg=process.argv.find(arg=>arg.startsWith('--sources='));const portals=sourceArg?sourceArg.slice(10).split(','):Object.keys(PORTALS);
  if(portals.some(portal=>!PORTALS[portal]))throw new Error('지원하지 않는 채용사이트입니다.');
  await collect(process.argv.includes('--preview')?1:100,portals);const data=payload();console.log(JSON.stringify({jobs:data.jobs.length,providers:data.providers.map(({id,count,located,error,truncated})=>({id,count,located,error,truncated})),status}));process.exitCode=status.error?1:0;
}else server.listen(port,'127.0.0.1',()=>{
  console.log(`홍성·예산 채용지도 V7: http://localhost:${port}\n사람인 · 잡코리아 · 고용24 / API 키 없이 실행됩니다. 종료: Ctrl+C`);
  if(process.argv.includes('--collect-on-start')) {
    const sourceArg=process.argv.find(arg=>arg.startsWith('--sources=')),portals=sourceArg?sourceArg.slice(10).split(','):Object.keys(PORTALS);
    if(portals.some(portal=>!PORTALS[portal]))throw new Error('지원하지 않는 채용사이트입니다.');
    void collect(100,portals,process.argv.includes('--reverify'));
  }
  setTimeout(checkAutomatically,1500).unref();
  setInterval(checkAutomatically,60000).unref();
  setInterval(()=>{if(!status.running)void refreshHistory().catch(error=>console.error(error.message));},60000).unref();
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`${port} 포트에 이미 실행 중인 앱이 있습니다.`:'서버를 시작하지 못했습니다.');process.exitCode=1;});
