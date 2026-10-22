import {sanitizeSearch,stages} from './features.js';
export const emptyPersonal=()=>({savedIds:[],reads:{},applications:{},searches:[],activeSearchId:null,visit:{currentAt:null,previousAt:null}});
export function canonicalizePersonal(personal,rows){
  const aliases=new Map(rows.map(row=>[row.id,row.canonicalId||row.id]));
  const canonical=id=>{const seen=new Set();while(aliases.has(id)&&aliases.get(id)!==id&&!seen.has(id)){seen.add(id);id=aliases.get(id);}return id;};
  const next=structuredClone(personal);next.savedIds=[...new Set(personal.savedIds.map(canonical))];next.reads={};next.applications={};
  for(const [id,at]of Object.entries(personal.reads)){const key=canonical(id);if(!next.reads[key]||Date.parse(at)>Date.parse(next.reads[key]))next.reads[key]=at;}
  for(const [id,entry]of Object.entries(personal.applications)){const key=canonical(id),old=next.applications[key];if(!old){next.applications[key]=entry;continue;}const [latest,previous]=Date.parse(entry.updatedAt)>Date.parse(old.updatedAt)?[entry,old]:[old,entry];const previousNotes=[...(latest.previousNotes||[]),...(previous.previousNotes||[])];if(previous.note&&previous.note!==latest.note)previousNotes.push({note:previous.note,stage:previous.stage,updatedAt:previous.updatedAt});next.applications[key]={...latest,previousNotes};}
  if(JSON.stringify(next)!==JSON.stringify(personal))next.revision=(personal.revision||0)+1;
  return next;
}
export function updatePersonal(personal,input,job,at=new Date().toISOString()){
  const next=structuredClone(personal),key=job?.canonicalId||job?.id;
  next.revision=(personal.revision||0)+1;
  if(input.action==='visit'){
    if(!next.visit.currentAt||Date.parse(at)-Date.parse(next.visit.currentAt)>=1800000)next.visit={previousAt:next.visit.currentAt,currentAt:at};
    return next;
  }
  if(input.action==='save-search'){
    const name=String(input.name||'').trim().slice(0,40);if(!name)throw new Error('검색 조건 이름을 입력해 주세요.');
    const existing=next.searches.find(search=>search.name===name),id=existing?.id||crypto.randomUUID();
    if(!existing&&next.searches.length>=20)throw new Error('검색 조건은 20개까지 저장할 수 있습니다.');
    next.searches=[...next.searches.filter(search=>search.id!==id),{id,name,filters:sanitizeSearch(input.filters),savedAt:at}];next.activeSearchId=id;return next;
  }
  if(input.action==='use-search'){
    if(input.id!==null&&!next.searches.some(search=>search.id===input.id))throw new Error('저장한 검색 조건을 찾을 수 없습니다.');next.activeSearchId=input.id;return next;
  }
  if(input.action==='delete-search'){
    next.searches=next.searches.filter(search=>search.id!==input.id);if(next.activeSearchId===input.id)next.activeSearchId=null;return next;
  }
  if(!key)throw new Error('공고를 찾을 수 없습니다.');
  if(input.action==='read'){if(input.read===false)delete next.reads[key];else next.reads[key]=at;return next;}
  if(input.action==='favorite'){
    if(typeof input.saved!=='boolean')throw new Error('관심공고 설정을 확인해 주세요.');next.savedIds=next.savedIds.filter(id=>id!==key);if(input.saved)next.savedIds.push(key);return next;
  }
  if(input.action==='application'){
    if(!Object.hasOwn(stages,input.stage))throw new Error('지원 상태를 확인해 주세요.');
    const note=String(input.note||'');if(note.length>4000)throw new Error('메모는 4,000자까지 입력할 수 있습니다.');
    if(!input.stage&&!note.trim())delete next.applications[key];else next.applications[key]={...next.applications[key],stage:input.stage,note,updatedAt:at};return next;
  }
  throw new Error('지원하지 않는 저장 요청입니다.');
}
