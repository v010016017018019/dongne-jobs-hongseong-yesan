import {emptyPersonal,updatePersonal,canonicalizePersonal} from './personal-model.js';
import {groupJobs,exactAddressKey} from './model.js';
import {sanitizeSearch} from './features.js';

export const STORAGE_KEY='dongne-jobs-web-v7';
const clone=value=>structuredClone(value);
const open=(job,now)=>!job.closed&&(!job.expiresAt||Date.parse(job.expiresAt)>=now);
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
export function manualJob(input,now=new Date().toISOString()){
  let url;try{url=new URL(input.url);}catch{throw new Error('공고 링크를 확인해 주세요.');}
  if(url.protocol!=='https:')throw new Error('공식 채용사이트의 HTTPS 공고 링크를 입력해 주세요.');
  let id,portal,externalId,affiliate;
  if(/^(?:www\.)?saramin\.co\.kr$/.test(url.hostname)&&/^\/zf_user\/jobs\//.test(url.pathname)&&/^\d+$/.test(url.searchParams.get('rec_idx')||'')){
    portal='saramin';externalId=url.searchParams.get('rec_idx');id=`saramin:${externalId}`;url=new URL(`https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=${externalId}`);
  }else if(/^(?:www\.)?jobkorea\.co\.kr$/.test(url.hostname)&&/^\/Recruit\/GI_Read\/\d+(?:\/Ext)?\/?$/i.test(url.pathname)){
    portal='jobkorea';externalId=url.pathname.match(/GI_Read\/(\d+)/i)[1];affiliate=url.searchParams.get('siteCode')==='WN'?'고용24':undefined;id=`jobkorea:${affiliate?'WN:':''}${externalId}`;
    url=new URL(`https://www.jobkorea.co.kr/Recruit/GI_Read/${externalId}${affiliate?'/Ext?siteCode=WN':''}`);
  }else if(/^(?:www\.)?work24\.go\.kr$/.test(url.hostname)&&url.pathname==='/wk/a/b/1500/empDetailAuthView.do'&&/^[A-Za-z0-9_-]{1,100}$/.test(url.searchParams.get('wantedAuthNo')||'')&&/^[A-Za-z0-9_-]{1,40}$/.test(url.searchParams.get('infoTypeCd')||'')){
    portal='work24';externalId=url.searchParams.get('wantedAuthNo');const type=url.searchParams.get('infoTypeCd');id=`work24:${type}:${externalId}`;url=new URL(`https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${externalId}&infoTypeCd=${type}`);
  }else throw new Error('사람인·잡코리아·고용24의 공고 상세 링크를 입력해 주세요.');
  const company=clean(input.company).slice(0,120),title=clean(input.title).slice(0,200),region=input.region;
  if(!company||!title||!['홍성군','예산군'].includes(region))throw new Error('회사명·제목·근무 지역을 입력해 주세요.');
  return {id,canonicalId:id,portal,externalId,...(affiliate?{affiliate}:{}),url:url.href,company,title,regions:[region],location:`충남 ${region}`,sites:[],education:'',salary:'',employment:'',experience:'',manual:true,closed:false,expiresAt:null,deadlineLabel:'마감일 원문 확인',firstSeenAt:now,locationNote:'이 브라우저에 직접 등록한 공고입니다. 원문에서 학력과 근무지를 확인하세요.'};
}
export function createBrowserApi({storage,fetcher=fetch,now=()=>Date.now(),lock=async task=>task()}={}){
  let snapshot=null,manifest=null,historyCache=null,queue=Promise.resolve(),snapshotPromise=null;
  const readLocal=()=>{
    let raw;try{raw=storage.getItem(STORAGE_KEY);}catch{throw new Error('브라우저 저장 공간을 사용할 수 없습니다. 일반 창에서 다시 열어 주세요.');}
    if(!raw)return {personal:emptyPersonal(),manual:[],locations:{},managed:{}};
    let data;try{data=JSON.parse(raw);}catch{throw new Error('이 브라우저의 저장 기록을 읽지 못했습니다. 기존 기록은 덮어쓰지 않았습니다.');}
    if(!data||typeof data!=='object'||!data.personal||!Array.isArray(data.personal.savedIds)||!Array.isArray(data.personal.searches)||!data.personal.reads||!data.personal.applications||!data.personal.visit||!Array.isArray(data.manual)||!data.locations||!data.managed)throw new Error('브라우저 저장 기록 형식을 확인해 주세요. 기존 기록은 보존했습니다.');
    return data;
  };
  const writeLocal=data=>{try{storage.setItem(STORAGE_KEY,JSON.stringify(data));}catch{throw new Error('브라우저 저장 공간이 부족하거나 저장이 차단되었습니다. 변경 내용을 저장하지 못했습니다.');}};
  const getJson=async path=>{const response=await fetcher(path,{cache:'no-store'});if(!response.ok)throw new Error('최신 공고 자료를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.');return response.json();};
  async function loadSnapshot(){
    if(snapshotPromise)return snapshotPromise;
    snapshotPromise=(async()=>{
      const next=await getJson('/data/manifest.json');
      if(next.schema!==1||!/^\/data\/jobs-[a-f0-9]{16}\.json$/.test(next.jobs)||!/^\/data\/history-[a-f0-9]{16}\.json$/.test(next.history))throw new Error('공고 배포 자료의 형식을 확인해 주세요.');
      if(!manifest||next.jobs!==manifest.jobs){const data=await getJson(next.jobs);if(!Array.isArray(data.jobs)||!Array.isArray(data.providers))throw new Error('공고 목록의 형식을 확인해 주세요.');snapshot=data;historyCache=null;}
      if(manifest?.history!==next.history)historyCache=null;
      manifest=next;return snapshot;
    })();try{return await snapshotPromise;}finally{snapshotPromise=null;}
  }
  function activeJobs(local){
    const byId=new Map((snapshot.jobs||[]).map(job=>[job.id,clone(job)]));
    for(const job of local.manual)if(!byId.has(job.id))byId.set(job.id,clone(job));
    return [...byId.values()].filter(job=>open(job,now())).map(job=>{
      const key=job.canonicalId||job.id,entry=local.locations[key];
      if(entry){job.sites=[clone(entry)];job.address=entry.address;job.locationStatus='verified';job.exactAddress=true;job.coordinateConflict=false;job.locationNote='이 브라우저에서 직접 지정한 위치입니다.';}
      const age=job.firstSeenAt?now()-Date.parse(job.firstSeenAt):Infinity;
      return {...job,isNew:age>=0&&age<7*86400000};
    });
  }
  function payload(local){
    const jobs=activeJobs(local),providers=snapshot.providers.map(provider=>({...provider,count:jobs.filter(job=>job.portal===provider.id).length,located:jobs.filter(job=>job.portal===provider.id&&job.sites.length).length}));
    return {...clone(snapshot),jobs,providers,personal:clone(local.personal),localOnly:false,online:true,publication:manifest.publication,automatic:{enabled:Boolean(manifest.publication?.updatesEnabled),intervalHours:6,nextCheckAt:null,providers:[]},status:{running:false,error:''},historyCount:snapshot.historyCount};
  }
  async function getHistory(){
    if(!historyCache)historyCache=await getJson(manifest.history);
    const local=readLocal(),active=activeJobs(local),current=new Set(active.map(job=>job.canonicalId||job.id)),activeIds=new Set(active.map(job=>job.id)),isCurrent=job=>current.has(job.canonicalId||job.id)||(job.members||[job]).some(member=>activeIds.has(member.id)),archived=new Map((historyCache.archived||[]).filter(job=>!isCurrent(job)).map(job=>[job.canonicalId||job.id,job]));
    for(const job of groupJobs([...snapshot.jobs,...local.manual]))if(!current.has(job.canonicalId))archived.set(job.canonicalId,{...job,sites:[],archived:true,isNew:false,archiveReason:job.closed?'원문 마감 확인':'마감일 경과'});
    for(const [key,job]of Object.entries(local.managed))if(!isCurrent(job)&&!archived.has(key))archived.set(key,{...clone(job),sites:[],archived:true,isNew:false,archiveReason:job.expiresAt&&Date.parse(job.expiresAt)<now()?'마감일 경과':'사이트 목록에서 사라짐 · 마감 여부 미확인'});
    return {...clone(historyCache),archived:[...archived.values()]};
  }
  async function mutate(path,input){
    if(!snapshot)await loadSnapshot();
    if(path==='/api/refresh'){await loadSnapshot();return payload(readLocal());}
    const history=await getHistory();
    return lock(async()=>{
      const local=readLocal(),active=activeJobs(local),older=history.archived.flatMap(job=>job.members||[job]),rows=[...older,...active];
      local.personal=canonicalizePersonal(local.personal,rows);
      const id=String(input.id||''),job=active.find(job=>job.id===id||job.canonicalId===id)||older.find(job=>job.id===id||job.canonicalId===id)||local.managed[id];
      if(path==='/api/personal')local.personal=updatePersonal(local.personal,input,job,new Date(now()).toISOString());
      else if(path==='/api/manual'){
        const next=manualJob(input,new Date(now()).toISOString());local.manual=[...local.manual.filter(job=>job.id!==next.id),next];
      }else if(path==='/api/location'){
        if(!job)throw new Error('공고를 찾을 수 없습니다.');const lat=Number(input.lat),lng=Number(input.lng),address=clean(input.address).slice(0,240);
        if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<36.3||lat>37||lng<126.3||lng>127.2||!exactAddressKey(address)||!job.regions.some(region=>address.includes(region)))throw new Error('홍성군·예산군의 정확한 주소와 지도 위치를 지정해 주세요.');
        local.locations[job.canonicalId||job.id]={lat,lng,address,source:'직접 확인한 근무지',confirmedAt:new Date(now()).toISOString()};
      }else throw new Error('지원하지 않는 요청입니다.');
      const keys=new Set([...local.personal.savedIds,...Object.keys(local.personal.applications)]),groups=groupJobs(activeJobs(local));
      for(const key of Object.keys(local.managed))if(!keys.has(key))delete local.managed[key];
      for(const group of groups)if(keys.has(group.canonicalId))local.managed[group.canonicalId]=group;
      writeLocal(local);
      return path==='/api/personal'?{personal:clone(local.personal)}:payload(local);
    });
  }
  return async(path,input)=>{
    if(input!==undefined){const task=queue.then(()=>mutate(path,input));queue=task.catch(()=>{});return task;}
    if(path==='/api/jobs'){await loadSnapshot();return payload(readLocal());}
    if(path==='/api/history'){if(!snapshot)await loadSnapshot();return getHistory();}
    throw new Error('지원하지 않는 요청입니다.');
  };
}
let browserApi;
export function webApi(path,input){
  if(!browserApi)browserApi=createBrowserApi({storage:localStorage,lock:task=>navigator.locks?navigator.locks.request(STORAGE_KEY,task):task()});
  return browserApi(path,input);
}
