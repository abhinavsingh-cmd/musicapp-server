import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:3000';
const allLogs = [];
function out(msg) { allLogs.push(msg); console.log(msg); }

const INJECT = `
(function(){
  window.__D=[];
  function p(l,c,f,m,s){window.__D.push({l:l,c:c,f:f,m:String(m).slice(0,800),s:String(s||'').slice(0,500)});}
  const _f=window.fetch;
  window.fetch=async function(...a){
    const u=typeof a[0]==='string'?a[0]:a[0]?.url||'';
    p('INFO','fetch','req',a[1]?.method||'GET'+' '+u.slice(0,120));
    const t0=Date.now();
    try{const r=await _f.apply(this,a);p(r.ok?'OK':'ERR','fetch','resp',r.status+' '+u.slice(0,100)+' '+(Date.now()-t0)+'ms');return r;}
    catch(e){p('ERR','fetch','fail',e.message+' '+u.slice(0,100),e.stack);throw e;}
  };
  ['log','warn','error','info'].forEach(lv=>{
    const o=console[lv].bind(console);
    console[lv]=function(...a){
      o(...a);
      const m=a.map(x=>{if(typeof x==='string')return x;if(x instanceof Error)return x.message;try{return JSON.stringify(x).slice(0,400);}catch{return String(x);}}).join(' ');
      p(lv==='error'?'ERR':'LOG','console',lv,m.slice(0,600));
    };
  });
  window.addEventListener('error',e=>p('CRIT','window','error',e.message+' @'+e.filename+':'+e.lineno,e.error?.stack));
  window.addEventListener('unhandledrejection',e=>p('CRIT','window','rejection',String(e.reason?.message||e.reason),e.reason?.stack));
  p('INFO','DIAG','init','active');
})();
`;

async function getPageInfo(page) {
  return await page.evaluate(() => {
    const root = document.getElementById('root');
    const overlay = document.querySelector('vite-error-overlay');
    const text = document.body?.innerText || '';
    const inputs = [...document.querySelectorAll('input')].map(i => i.placeholder || i.type);
    const songRows = document.querySelectorAll('.song-row').length;
    return {
      rootChildren: root?.children.length || 0,
      overlay: overlay?.shadowRoot?.querySelector('.message-body')?.textContent?.slice(0, 300) || null,
      text: text.slice(0, 500),
      inputs, songRows,
    };
  });
}

async function getLogs(page) {
  return await page.evaluate(() => window.__D || []);
}

async function clearLogs(page) {
  await page.evaluate(() => { window.__D = []; });
}

async function run() {
  out('=== PRODUCTION BUILD DIAGNOSTIC (APK ENV) ===');
  out('API: https://musicapp-server-alkf.onrender.com');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  await page.addInitScript(() => {
    localStorage.setItem('auth-user', JSON.stringify({ id:'1', name:'Test', email:'test@test.com', avatar:'', token:'fake-jwt-token' }));
  });
  await page.addInitScript(INJECT);

  // ===== 1. HOME =====
  out('\n=== 1. HOME ===');
  await clearLogs(page);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(8000);
  const home = await getPageInfo(page);
  out('rootChildren: ' + home.rootChildren);
  out('overlay: ' + (home.overlay || 'none'));
  out('songRows: ' + home.songRows);
  out('inputs: ' + JSON.stringify(home.inputs));
  out('text: ' + home.text.slice(0, 300));
  const hLogs = await getLogs(page);
  out('--- browser logs: ' + hLogs.length + ' ---');
  hLogs.forEach(l => out('  [' + l.l + '] ' + l.c + '.' + l.f + ': ' + l.m.slice(0, 250)));

  // ===== 2. SEARCH =====
  out('\n=== 2. SEARCH ===');
  await clearLogs(page);
  await page.goto(BASE + '/search', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);
  const search = await getPageInfo(page);
  out('inputs: ' + JSON.stringify(search.inputs));
  out('text: ' + search.text.slice(0, 300));
  const sLogs = await getLogs(page);
  out('--- browser logs: ' + sLogs.length + ' ---');
  sLogs.forEach(l => out('  [' + l.l + '] ' + l.c + '.' + l.f + ': ' + l.m.slice(0, 250)));

  // ===== 3. CHARTS =====
  out('\n=== 3. CHARTS ===');
  await clearLogs(page);
  await page.goto(BASE + '/charts', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(6000);
  const charts = await getPageInfo(page);
  out('text: ' + charts.text.slice(0, 300));
  const cLogs = await getLogs(page);
  out('--- browser logs: ' + cLogs.length + ' ---');
  cLogs.forEach(l => out('  [' + l.l + '] ' + l.c + '.' + l.f + ': ' + l.m.slice(0, 250)));

  // ===== 4. PLAYBACK =====
  out('\n=== 4. PLAYBACK ===');
  await clearLogs(page);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(8000);
  const pState = await getPageInfo(page);
  out('songRows: ' + pState.songRows);
  if (pState.songRows > 0) {
    try {
      const row = await page.$('.song-row');
      if (row) {
        await row.click();
        out('clicked first song-row');
        await page.waitForTimeout(5000);
        const audio = await page.evaluate(() => {
          const a = document.querySelector('audio');
          return { exists: !!a, src: a?.src?.slice(0, 100) || 'none', paused: a?.paused, err: a?.error?.message || null };
        });
        out('audio: ' + JSON.stringify(audio));
      }
    } catch (e) { out('click error: ' + e.message); }
  } else {
    out('NO SONG ROWS to click');
  }
  const pLogs = await getLogs(page);
  out('--- browser logs: ' + pLogs.length + ' ---');
  pLogs.forEach(l => out('  [' + l.l + '] ' + l.c + '.' + l.f + ': ' + l.m.slice(0, 250)));

  // ===== 5. LIBRARY =====
  out('\n=== 5. LIBRARY ===');
  await clearLogs(page);
  await page.goto(BASE + '/library', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);
  const lib = await getPageInfo(page);
  out('text: ' + lib.text.slice(0, 300));
  const lLogs = await getLogs(page);
  out('--- browser logs: ' + lLogs.length + ' ---');
  lLogs.forEach(l => out('  [' + l.l + '] ' + l.c + '.' + l.f + ': ' + l.m.slice(0, 250)));

  await browser.close();
  writeFileSync('/tmp/prod-diagnostic.log', allLogs.join('\n'));
  out('\n=== DONE ===');
  out('Full log: /tmp/prod-diagnostic.log');
}

run().catch(e => { console.error('FAIL:', e); process.exit(1); });
