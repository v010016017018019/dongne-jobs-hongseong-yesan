import {readFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dataDir=process.env.JOB_MAP_DATA_DIR;
const row=id=>`<tr><td><input id="chkboxWantedAuthNo0" value="${id}|VALIDATION|검증 회사|새 공고 자동 반영"><a class="cp_name">검증 회사</a><a href="/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${id}&amp;infoTypeCd=VALIDATION">새 공고</a></td><td><ul class="emp_info_dtl"><li class="member"><span class="item">경력무관</span></li><li class="site">충남 홍성군</li></ul></td><td><script>var date='2099-12-31';var wantedYn='Y';</script></td></tr>`;
globalThis.fetch=async(url,options={})=>{
  const target=new URL(url);if(target.hostname!=='www.work24.go.kr')throw new Error('Unexpected external request in test: '+url);
  const mode=(await readFile(resolve(dataDir,'fixture-mode.txt'),'utf8')).trim();
  await appendFile(resolve(dataDir,'fixture-requests.txt'),target.pathname+'\n');
  if(mode==='failure')return new Response('접속 실패',{status:503});
  if(mode==='captcha')return new Response('<html><body>'+(' '.repeat(6500))+'보안문자를 입력해 주시기 바랍니다.</body></html>');
  if(target.pathname.includes('empDetailAuthView'))return new Response('<button data-addr="충남 홍성군 홍성읍 대학1길 19" data-map-coor-x="126.659169" data-map-coor-y="36.579786" onclick="f_showWorkLocationMap(this.dataset.addr)"></button>');
  const params=new URLSearchParams(options.body),hong=params.get('region')==='44800';
  if(mode==='repeat'&&hong)return new Response('<input id="resultCnt" value="50"><script>totalRecordCount:100</script><table>'+row('KTESTNEW').repeat(50)+'</table>');
  return new Response('<input id="resultCnt" value="50"><script>totalRecordCount:'+(hong?1:0)+'</script><table>'+(hong?row('KTESTNEW'):'')+'</table>'+(hong?'':'<p>검색 결과가 없습니다</p>'));
};
