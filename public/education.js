export const educationLabels={any:'학력무관',belowHigh:'중졸 이하',high:'고졸',college:'초대졸 (2·3년)',bachelor:'대졸 (4년)',master:'석사',doctor:'박사',unknown:'학력 확인 필요'};
export const highSchoolEducation=['any','belowHigh','high'];
const rank={belowHigh:0,high:1,college:2,bachelor:3,master:4,doctor:5};
export function sanitizeEducation(value){
  return Array.isArray(value)?Object.keys(educationLabels).filter(key=>value.includes(key)):[];
}
export function latestEducation(job,detail={}){
  const listed=String(job.education||'').trim(),verified=String(detail.education||'').trim();
  if(!listed)return verified;
  if(!verified)return listed;
  const listedAt=Date.parse(job.fetchedAt),checkedAt=Date.parse(detail.checkedAt);
  return Number.isFinite(listedAt)&&Number.isFinite(checkedAt)&&checkedAt>listedAt?verified:listed;
}
// Read only the dedicated education field. Group ranges by their stated minimum.
export function educationInfo(value){
  const raw=String(value||'').normalize('NFC').replace(/\s+/g,' ').trim();
  const result=(kind,reason='')=>({raw,kind,label:educationLabels[kind],reason});
  if(!raw)return result('unknown','학력 항목이 비어 있습니다.');
  const required=raw.replace(/\([^()]*우대[^()]*\)/g,'').replace(/[,;]\s*[^,;]*우대[^,;]*/g,'').trim();
  if(/학력\s*(?:무관|불문|제한\s*없)|^관계\s*없음$/.test(required)){
    return /(?:졸|학사|석사|박사).*(?:필수|이상|↑)/.test(required)?result('unknown','학력무관과 필수 학력 표현이 함께 있어 원문 확인이 필요합니다.'):result('any');
  }
  if(/우대|선호|권장|동등|대체|예외|이하|미만/.test(required))return result('unknown','최소 요구 학력을 확정하기 어려운 표현입니다.');
  const tokens=[...required.matchAll(/석\s*[·/]?\s*박사|박사|석사|초대졸|전문대(?:학)?(?:교)?(?:졸업|졸)?|(?:대학(?:교)?|대졸)\s*\([^)]{0,24}\)|대졸|대학교(?:졸업|졸)|학사|고졸|고등학교(?:졸업|졸)?|중졸|중학교(?:졸업|졸)?|초졸|초등학교(?:졸업|졸)?|무학/g)];
  if(!tokens.length)return result('unknown','분류할 수 없는 학력 표현입니다.');
  const kindOf=token=>{
    const text=token.replace(/\s/g,'');
    if(/^석.*박사|석사/.test(text))return 'master';
    if(text==='박사')return 'doctor';
    if(/초대졸|전문대/.test(text))return 'college';
    if(/\(/.test(text)){
      if(/\([^)]*4년/.test(text))return 'bachelor';
      if(/\([^)]*[23](?:[~,·\-]?[23])?년/.test(text))return 'college';
      return 'unknown';
    }
    if(/대졸|대학교|학사/.test(text))return 'bachelor';
    if(/고졸|고등학교/.test(text))return 'high';
    return 'belowHigh';
  };
  const kinds=tokens.map(token=>kindOf(token[0]));
  if(kinds.includes('unknown'))return result('unknown','대학의 수업 연한을 확인할 수 없습니다.');
  // Conditional career exceptions are not unconditional education alternatives.
  if(kinds.length>1){
    for(let i=1;i<tokens.length;i++){
      const between=required.slice(tokens[i-1].index+tokens[i-1][0].length,tokens[i].index);
      if(!/^[\s()졸업년↑이상제]*?(?:~|∼|～|부터|에서|또는|혹은|\/|·|,|및)[\s()졸업년↑이상제]*$/.test(between))return result('unknown','학력별 추가 조건이 있어 원문 확인이 필요합니다.');
    }
    if(/필수|경력|경험|가능/.test(required))return result('unknown','학력별 추가 조건이 있어 원문 확인이 필요합니다.');
  }
  return result(kinds.reduce((lowest,kind)=>rank[kind]<rank[lowest]?kind:lowest));
}
export function educationAssessment(job){
  const infos=(job.members||[job]).map(member=>educationInfo(member.education));
  const known=[...new Set(infos.filter(info=>info.kind!=='unknown').map(info=>info.kind))];
  return known.length>1?{kind:'unknown',conflict:true,label:educationLabels.unknown,reason:'원문별 학력 조건이 달라 확인이 필요합니다.'}:{kind:known[0]||'unknown',conflict:false,label:educationLabels[known[0]||'unknown']};
}
