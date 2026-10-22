import { load } from 'cheerio';
import {exactAddressKey} from '../public/model.js';
export const REGIONS = { '115160': '홍성군', '115120': '예산군' };
export const text = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export function saraminUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('사람인 공고 링크를 입력해 주세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['www.saramin.co.kr', 'saramin.co.kr'].includes(url.hostname) || url.username || url.password || url.port || !/^\/zf_user\/jobs\/(view|relay\/view)\/?$/.test(url.pathname) || !/^\d+$/.test(url.searchParams.get('rec_idx') || '')) {
    throw new Error('rec_idx가 포함된 사람인 공고 상세페이지 링크가 필요합니다.');
  }
  return `https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=${url.searchParams.get('rec_idx')}`;
}

export function parseDeadline(label, now = new Date()) {
  const match = label.match(/(\d{1,2})\.(\d{1,2})/);
  if (!match) return null;
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  let year = today.getFullYear();
  const month = Number(match[1]), day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (today.getMonth() >= 9 && month <= 3) year++;
  return new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59+09:00`).toISOString();
}
export function isOpen(job, now = Date.now()) { return !job.closed && (!job.expiresAt || Date.parse(job.expiresAt) >= now); }

export function parseList(html, region, now = new Date()) {
  const $ = load(html), jobs = [];
  $('.list_item').each((_, element) => {
    const row = $(element), link = row.find('.job_tit a[href]').first();
    const location = text(row.find('.work_place').text());
    if (!location.includes(region) || !link.length) return;
    let url;
    try { url = saraminUrl(new URL(link.attr('href'), 'https://www.saramin.co.kr').href); } catch { return; }
    const id = new URL(url).searchParams.get('rec_idx');
    const career = text(row.find('.career').text()).split('·').map(s => s.trim());
    const hasEmployment = /정규직|계약직|인턴|아르바이트|파견|프리랜서|위촉|기간제|무기계약/.test(career.at(-1) || '');
    const deadlineLabel = text(row.find('.support_detail .date').text());
    const job = {
      id, url, company: text(row.find('.company_nm .str_tit').first().text()),
      title: text(link.attr('title') || link.text()), regions: [region], location,
      experience: (hasEmployment ? career.slice(0,-1) : career).join('/'), employment: hasEmployment ? career.at(-1) : '',
      education: text(row.find('.education').text()), category: text(row.find('.job_sector').text()),
      deadlineLabel, expiresAt: parseDeadline(deadlineLabel, now),
      registeredLabel: text(row.find('.deadlines').text()), source: 'saramin-public',
      fetchedAt: now.toISOString(), sites: [], locationNote: '', closed: false,
    };
    if (job.company && job.title && isOpen(job, now.getTime())) jobs.push(job);
  });
  const totalLabel = text($('.recruit_count, .total_count').first().text());
  const totalMatch = totalLabel.match(/[\d,]+/);
  if (!$('.list_item').length && !/검색.*(?:없|0건)|채용정보가 없습니다/.test($.text())) {
    throw new Error('사람인 목록 구조가 바뀌었거나 접속을 제한했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return { jobs, total: totalMatch ? Number(totalMatch[0].replace(/,/g, '')) : null, pageItems: $('.list_item').length };
}
export function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 36.3 && lat <= 37.0 && lng >= 126.3 && lng <= 127.1;
}
export function detailedAddress(address) {
  return Boolean(exactAddressKey(address));
}
export function parseDetail(html, regions) {
  const $ = load(html), sites = [];
  $('[data-latitude][data-longitude][data-address]').each((_, element) => {
    const node = $(element), address = text(node.attr('data-address'));
    const lat = Number(node.attr('data-latitude')), lng = Number(node.attr('data-longitude'));
    if (regions.some(region => address.includes(region)) && detailedAddress(address) && validCoordinate(lat, lng)) {
      if (!sites.some(site => site.lat === lat && site.lng === lng)) sites.push({ address, lat, lng, source: '사람인 근무지', confirmedAt: new Date().toISOString() });
    }
  });
  const addresses = $('.wrap_map_corp .txt_address').map((_, el) => text($(el).text())).get().filter(address => regions.some(region => address.includes(region)));
  const closed = /마감된 채용정보|이미 마감된 공고|채용이 마감된/.test($('.wrap_view, .wrap_recruit_view, #content, .job_view').text().slice(0,18000)) || /마감된 채용정보/.test($('title').text());
  return { sites, address: addresses[0] || '', closed, locationNote: sites.length ? '' : '공개 페이지에서 정확한 근무지 좌표를 확인하지 못했습니다.' };
}
export function manualJob(input) {
  const url = saraminUrl(input.url);
  if (!Object.values(REGIONS).includes(input.region)) throw new Error('홍성군 또는 예산군을 선택해 주세요.');
  const company = text(input.company).slice(0,120), title = text(input.title).slice(0,200);
  if (!company || !title) throw new Error('회사명과 공고 제목을 입력해 주세요.');
  return { id: new URL(url).searchParams.get('rec_idx'), url, company, title,
    regions: [input.region], location: `충남 ${input.region}`, experience: '', employment: '', education: '', category: '',
    deadlineLabel: '마감일 원문 확인', expiresAt: null, registeredLabel: '직접 등록', fetchedAt: new Date().toISOString(),
    source: 'manual', sites: [], closed: false, locationNote: '',
  };
}
export function mergeJobs(jobs) {
  const result = new Map();
  for (const job of jobs) {
    const current = result.get(job.id);
    if (current) current.regions = [...new Set([...current.regions, ...job.regions])];
    else result.set(job.id, structuredClone(job));
  }
  return [...result.values()];
}
