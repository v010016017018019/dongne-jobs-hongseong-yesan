import {load} from 'cheerio';
import {conditionTags} from '../public/features.js';
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
export function publicFacts(job,html){
  const $=load(html),values={};
  $('th,dt').each((_,node)=>{const label=clean($(node).text()).replace(/\s/g,'');if(/^(?:임금조건|급여|급여조건|고용형태|근무형태|근무시간|복리후생|기타복리후생|학력|학력조건|지원학력|최종학력)$/.test(label))values[label]=clean($(node).next().text()).slice(0,600);});
  const result={factsVersion:5};
  let posting;
  const walk=value=>{if(!value||typeof value!=='object')return;if(value['@type']==='JobPosting')posting=value;else for(const child of Object.values(value))if(child&&typeof child==='object')walk(child);};
  for(const node of $('script[type="application/ld+json"]').toArray()){try{walk(JSON.parse($(node).text()));}catch{}}
  const description=$('meta[name="description"]').attr('content')||'';
  const base=posting?.baseSalary,amount=base?.value,period=({YEAR:'연봉',MONTH:'월급',HOUR:'시급',DAY:'일급'})[amount?.unitText];
  const numeric=base?.currency==='KRW'&&period&&Number.isFinite(amount?.minValue||amount?.value)?`${period} ${amount.minValue||amount.value}${amount.maxValue?'~'+amount.maxValue:''}원`:'';
  const salary=values.임금조건||values.급여조건||values.급여||description.match(/급여\s*:\s*(.*?)(?:,\s*마감일|$)/)?.[1]||numeric;
  if(salary)result.salary=clean(salary).slice(0,240);
  const employment=values.고용형태||values.근무형태||posting?.employmentType;if(employment)result.employment=clean(Array.isArray(employment)?employment.join(' · '):employment).slice(0,160);
  const credentials=Array.isArray(posting?.educationRequirements)?posting.educationRequirements:[posting?.educationRequirements];
  const education=values.학력||values.학력조건||values.지원학력||values.최종학력||credentials.map(value=>typeof value==='string'?value:value?.name||value?.credentialCategory||'').filter(value=>typeof value==='string'&&value).join(' / ');
  if(education)result.education=clean(education).slice(0,240);
  const facts=[job.title,job.category,values.근무시간,values.복리후생,values.기타복리후생,posting?.description?$('<div>').html(posting.description).text():''].filter(Boolean).join(' / ');
  result.conditions=conditionTags(facts).map(tag=>({...tag,url:job.url}));
  return result;
}
