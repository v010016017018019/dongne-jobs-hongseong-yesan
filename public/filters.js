export function selectJobs(jobs,filter,saved=new Set()) {
  const result=jobs.filter(job=>{
    if(filter.portal!=='all'&&job.portal!==filter.portal)return false;
    if(filter.region!=='all'&&!job.regions.includes(filter.region))return false;
    if(filter.locatedOnly&&!job.sites?.length)return false;
    if(filter.savedOnly&&!saved.has(job.id))return false;
    const experience=job.experience||'';
    if(filter.experience!=='all'){
      if(filter.experience==='경력'&&((!experience.includes('경력')&&!/\d.*년/.test(experience))||experience==='경력무관'||experience==='관계없음'))return false;
      if(filter.experience!=='경력'&&!experience.includes(filter.experience))return false;
    }
    return !filter.query||[job.company,job.title,job.category,job.location,job.address,...(job.sites||[]).map(site=>site.address)].join(' ').toLowerCase().includes(filter.query.toLowerCase());
  });
  if(filter.sort==='deadline')result.sort((a,b)=>(Date.parse(a.expiresAt)||Infinity)-(Date.parse(b.expiresAt)||Infinity));
  if(filter.sort==='company')result.sort((a,b)=>a.company.localeCompare(b.company,'ko'));
  return result;
}
