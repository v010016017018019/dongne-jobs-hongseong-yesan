export function mapQuery(address) {
  const clean=String(address || '').replace(/^\(\d{5}\)\s*/, '').trim();
  const road=clean.match(/^(.*?(?:로|길)\s+\d+(?:-\d+)?)/);
  const land=clean.match(/^(.*?(?:읍|면|동|리)\s+\d+(?:-\d+)?)/);
  return road?.[1] || land?.[1] || clean;
}
export function naverLink(job,site=job.sites?.[0]) {
  const address=site?.address || job.address;
  const query=address && !/\*|(?:로|길)\s*0+(?:\s|$)/.test(address)?mapQuery(address):`${job.regions[0]} ${job.company}`;
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}
