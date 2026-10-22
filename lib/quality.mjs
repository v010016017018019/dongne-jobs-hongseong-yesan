import {exactAddressKey,kmBetween} from '../public/model.js';
import {isOpen,validCoordinate} from './jobs.mjs';
import {latestEducation} from '../public/education.js';

export function verifiedJobs(raw,details={},overrides={},now=Date.now()) {
  const jobs=raw.map(job=>({...structuredClone(job),...structuredClone(details[job.id]||{}),education:latestEducation(job,details[job.id])}));
  const lookup=new Map(jobs.map(job=>[job.id,job]));
  for(const job of jobs){let current=job;const seen=new Set([job.id]);while(current.originId&&lookup.has(current.originId)&&!seen.has(current.originId)){seen.add(current.originId);current=lookup.get(current.originId);}job.canonicalId=current.originId&&!seen.has(current.originId)?current.originId:current.id;
    if(current!==job){if(!job.sites?.length&&current.sites?.length){job.sites=structuredClone(current.sites);job.locationNote='';}if(!job.address)job.address=current.address;if(current.closed)job.closed=true;}
    if(overrides[job.id])job.sites=[overrides[job.id]];
    job.sites=(job.sites||[]).filter(site=>exactAddressKey(site.address)&&validCoordinate(Number(site.lat),Number(site.lng))).map(site=>({...site,lat:Number(site.lat),lng:Number(site.lng)}));
  }
  const manualByCanonical=new Map();
  for(const job of jobs)if(overrides[job.id]){const current=manualByCanonical.get(job.canonicalId),next=overrides[job.id];if(!current||Date.parse(next.confirmedAt||0)>=Date.parse(current.confirmedAt||0))manualByCanonical.set(job.canonicalId,next);}
  for(const job of jobs)if(manualByCanonical.has(job.canonicalId)){const site=manualByCanonical.get(job.canonicalId);job.sites=[structuredClone(site)];job.address=site.address;job.locationNote='직접 확인한 근무지를 같은 원문 공고에 적용했습니다.';}
  const active=jobs.filter(job=>isOpen(job,now)),index=new Map();
  for(const job of active)for(const site of job.sites){if(site.source==='직접 확인한 근무지')continue;const key=exactAddressKey(site.address);if(!index.has(key))index.set(key,[]);index.get(key).push({job,site});}
  for(const job of active){
    if(!job.sites.length&&exactAddressKey(job.address)){
      const candidates=index.get(exactAddressKey(job.address))||[];
      const conflict=candidates.some(a=>candidates.some(b=>kmBetween(a.site,b.site)>.15));
      if(candidates.length&&!conflict){const donor=candidates.find(item=>item.job.portal==='work24')||candidates[0];job.sites=[{...donor.site,address:job.address,source:'동일 근무지 주소 대조',verification:'address-match',referenceJobId:donor.job.id,referenceUrl:donor.job.url,referenceAddress:donor.site.address}];job.locationNote='동일한 도로명·건물번호의 공개 근무지 좌표와 대조했습니다.';}
      else if(conflict){job.locationNote='같은 주소의 공개 좌표가 서로 달라 원문에서 위치 재확인이 필요합니다.';job.coordinateConflict=true;}
    }
    job.locationStatus=job.sites.length?'verified':job.address&&!/홍성군|예산군/.test(job.address)?'outside':'unknown';job.exactAddress=Boolean(exactAddressKey(job.address));
  }
  return active;
}
export function qualitySummary(jobs) {
  return {rawJobs:jobs.length,uniqueJobs:new Set(jobs.map(job=>job.canonicalId)).size,directLocated:jobs.filter(job=>job.sites.some(site=>site.verification!=='address-match'&&site.source!=='직접 확인한 근무지')).length,addressMatched:jobs.filter(job=>job.sites.some(site=>site.verification==='address-match')).length,manualLocated:jobs.filter(job=>job.sites.some(site=>site.source==='직접 확인한 근무지')).length,located:jobs.filter(job=>job.sites.length).length,outside:jobs.filter(job=>job.locationStatus==='outside').length,unchecked:jobs.filter(job=>!job.checkedAt&&!job.manual).length,verificationErrors:jobs.filter(job=>job.verificationError).length,coordinateConflicts:jobs.filter(job=>job.coordinateConflict).length};
}
