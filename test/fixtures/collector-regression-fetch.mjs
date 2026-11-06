import {readFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const dataDir=process.env.JOB_MAP_DATA_DIR;
const row=(id,href,company='검증 회사')=>`<tr><td><input id="chkboxWantedAuthNo${id}" value="${id}|VALIDATION|${company}|새 공고"><a class="cp_name">${company}</a><a href="${href}">새 공고</a></td><td><ul class="emp_info_dtl"><li class="site">충남 홍성군</li></ul></td><td><script>var date='2099-12-31';var wantedYn='Y';</script></td></tr>`;
globalThis.fetch=async(url,options={})=>{
  const target=new URL(url),mode=(await readFile(resolve(dataDir,'fixture-mode.txt'),'utf8')).trim();
  await appendFile(resolve(dataDir,'fixture-requests.txt'),target.hostname+target.pathname+'\n');
  if(target.hostname!=='www.work24.go.kr')throw new Error('Unexpected external request: '+url);
  if(mode==='challenge-korean')return new Response('<html><body>보안문자를 입력해 주시기 바랍니다.</body></html>');
  if(mode==='challenge-captcha')return new Response('<html><title>CAPTCHA verification</title><body>Please complete the CAPTCHA to continue.</body></html>');
  if(mode==='challenge-recaptcha')return new Response('<html><body>Please complete the reCAPTCHA to continue.</body></html>');
  if(mode==='challenge-frame')return new Response('<html><body><iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe></body></html>');
  if(mode==='challenge-url'){const response=new Response('<html></html>');Object.defineProperty(response,'url',{value:'https://www.work24.go.kr/captcha/challenge'});return response;}
  const script=mode==='recaptcha-script'?'<script src="https://www.google.com/recaptcha/api.js?render=site-key"></script>':'';
  if(target.pathname.includes('empDetailAuthView')){if(mode==='detail-error')throw new Error('detail unavailable');if(mode==='detail-wait')await new Promise(done=>setTimeout(done,30000));return new Response(`<html>${script}</html>`);}
  const params=new URLSearchParams(options.body),hong=params.get('region')==='44800';
  if(mode.startsWith('pages-')){
    const page=Number(params.get('pageIndex'));
    const total=hong?(mode==='pages-last'?51:mode==='pages-short-first'?101:mode==='pages-short-last'?100:151):0;
    const count=!hong?0:mode==='pages-short-first'?1:page===1?50:1;
    const rows=Array.from({length:count},(_,i)=>{const id=`KPAGE${String((page-1)*50+i+1).padStart(3,'0')}`;return row(id,`/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${id}`);}).join('');
    return new Response(`<input id="resultCnt" value="50"><script>totalRecordCount:${total}</script><table>${rows}</table>${hong?'':'<p>검색 결과가 없습니다</p>'}`);
  }
  const valid=row('KTESTNEW','/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=KTESTNEW');
  const invalid=row('KBROKEN','/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=x');
  return new Response(script+(hong?`<table>${valid}${mode==='bad-link'?invalid:''}</table>`:'<p>검색 결과가 없습니다</p>'));
};
