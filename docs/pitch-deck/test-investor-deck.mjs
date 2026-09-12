/** Integration checks for the investor-facing contracts; no external services. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url));let server,browser,url;
before(async()=>{server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root))throw Error('path');const data=await readFile(path);res.setHeader('content-type',({'.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.pdf':'application/pdf'})[extname(path)]||'text/plain');res.end(data)}catch{res.writeHead(404);res.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch();});
after(async()=>{await browser?.close();await new Promise(r=>server.close(r))});
test('both editions have 9 readable native frames with source links',async()=>{
 const page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const lang of ['fr','en']){await page.goto(`${url}/pitch-deck.html?lang=${lang}`);await page.evaluate(()=>document.fonts.ready);assert.equal(await page.locator('.thumb').count(),9);
  for(let n=1;n<=9;n++){await page.locator(`.thumb[data-slide="${n}"]`).click();assert.equal(await page.locator('#slide>svg').count(),1);const bad=await page.locator('#slide svg').evaluate(svg=>{const b=[...svg.querySelectorAll('text')].map(t=>({text:t.textContent,...Object.fromEntries(['x','y','width','height'].map(k=>[k,t.getBBox()[k]]))}));const issues=b.filter(t=>t.x<65||t.x+t.width>1535||t.y<0||t.y+t.height>895).map(t=>t.text);for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++)if(Math.min(b[i].x+b[i].width,b[j].x+b[j].width)-Math.max(b[i].x,b[j].x)>3&&Math.min(b[i].y+b[i].height,b[j].y+b[j].height)-Math.max(b[i].y,b[j].y)>3)issues.push(b[i].text+' / '+b[j].text);return issues});assert.deepEqual(bad,[],`${lang} slide ${n}`);assert.ok((await page.locator('#slideNote').textContent()).length>20);if([2,5,8].includes(n))assert.ok(await page.locator('#sourceLinks a').count()>0)}
 }assert.deepEqual(errors,[]);await page.close();
});
test('fullscreen owns the only in-stage logo; replay, pause and keyboard work',async()=>{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(`${url}/pitch-deck.html?lang=fr#slide-4`);
 assert.equal(await page.locator('.fullscreen-brand').isVisible(),false);assert.equal(await page.locator('#slide .brand-mark').count(),0);
 await page.locator('#motion').click();assert.equal(await page.locator('#motion').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#slide [data-motion]').first().evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
 await page.locator('#replay').click();assert.equal(await page.locator('#motion').getAttribute('aria-pressed'),'false');await page.locator('#fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);assert.equal(await page.locator('.fullscreen-brand .brand-mark').isVisible(),true);assert.equal(await page.locator('.fullscreen-brand .brand-mark').count(),1);
 await page.keyboard.press('ArrowRight');assert.match(await page.locator('#stage').getAttribute('aria-label'),/5:/);await page.locator('[data-fs=exit]').click();await page.waitForFunction(()=>!document.fullscreenElement);assert.equal(await page.locator('.fullscreen-brand').isVisible(),false);
 await page.goto(`${url}/pitch-deck.html?lang=en#slide-9`);assert.equal(await page.locator('#nextControl').isDisabled(),true);assert.match(await page.locator('#summaryLink').getAttribute('href'),/nota-pitch-deck\.pdf/);await page.close();
});
test('mobile menus, reduced motion and shared rails remain usable',async()=>{
 const page=await browser.newPage({reducedMotion:'reduce'});
 for(const width of [390,768,1280]){await page.setViewportSize({width,height:900});for(const name of ['pitch-deck','business-plan']){await page.goto(`${url}/${name}.html?lang=fr`);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1,`${name} ${width}: ${overflow}`);const h=await page.locator('header.nota-header').boundingBox();assert.equal(h.height,52,`${name} at ${width}px`);if(width===390){assert.equal(await page.locator('.nota-header-actions').isVisible(),false);await page.locator('.nota-menu summary').click();assert.equal(await page.locator('.nota-header-actions').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.nota-header-actions').isVisible(),false)}if(name==='pitch-deck'){assert.equal(await page.locator('#motion').isDisabled(),true);assert.equal(await page.locator('#slide [data-motion]').first().evaluate(e=>getComputedStyle(e).animationName),'none')}}}await page.close();
});
test('the plan calculator distinguishes assumptions from the Year 1 forecast',async()=>{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 for(const lang of ['fr','en']){await page.goto(`${url}/business-plan.html?lang=${lang}`);await page.locator('[data-plan-chapter="2"]').click();
 const calc=page.locator(`[data-market-lang="${lang}"]`);assert.equal(await calc.locator('[data-market-result]').textContent(),'205');const input=calc.locator('input').first();await input.focus();await page.keyboard.press('Home');assert.equal(await calc.locator('[data-market-result]').textContent(),'0');await page.keyboard.press('End');assert.equal((await calc.locator('[data-market-result]').textContent()).replace(/[\s,\u00a0]/g,''),'2054');assert.equal(await page.locator('body').textContent().then(t=>t.includes('__NOTA_MONEY_')),false);assert.equal(await page.locator('body').textContent().then(t=>t.includes('<!-- MODEL:')),false)}await page.close();
});

test('the plan offers eight bilingual native chapters, complete details and interactive cash',async()=>{
 const page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const lang of ['fr','en']){await page.goto(url+'/business-plan.html?lang='+lang);await page.evaluate(()=>document.fonts.ready);assert.equal(await page.locator('[data-plan-chapter]').count(),8);
  for(let n=1;n<=8;n++){await page.locator('[data-plan-chapter="'+n+'"]').click();assert.equal(await page.locator('#planSlide>svg').count(),1);assert.ok((await page.locator('#planDetail').textContent()).length>400,lang+' chapter detail '+n);
   const bad=await page.locator('#planSlide svg').evaluate(svg=>{const b=[...svg.querySelectorAll('text')].map(t=>({text:t.textContent,...Object.fromEntries(['x','y','width','height'].map(k=>[k,t.getBBox()[k]]))}));const issues=b.filter(t=>t.x<65||t.x+t.width>1535||t.y<0||t.y+t.height>895).map(t=>t.text);for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++)if(Math.min(b[i].x+b[i].width,b[j].x+b[j].width)-Math.max(b[i].x,b[j].x)>3&&Math.min(b[i].y+b[i].height,b[j].y+b[j].height)-Math.max(b[i].y,b[j].y)>3)issues.push(b[i].text+' / '+b[j].text);return issues});assert.deepEqual(bad,[],lang+' plan chapter '+n);
   assert.equal(await page.locator('.plan-fullscreen-brand').isVisible(),false);
  }
  await page.locator('[data-plan-chapter="7"]').click();const cash=page.locator('#planCashMonth');await cash.focus();await page.keyboard.press('Home');assert.match(await page.locator('#planCashLabel').textContent(),/1 ·/);assert.equal(await page.locator('[data-cash-point]').getAttribute('x'),'818');await page.keyboard.press('End');assert.match(await page.locator('#planCashLabel').textContent(),/12 ·/);assert.equal(await page.locator('[data-cash-point]').getAttribute('x'),'1511');
 }
 assert.deepEqual(errors,[]);await page.close();
});
test('the plan remains branded in full screen and navigates with the keyboard',async()=>{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(url+'/business-plan.html?lang=fr#chapter-4');
 await page.locator('#planFullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);
 assert.equal(await page.locator('.plan-fullscreen-brand .plan-brand-mark').isVisible(),true);assert.equal(await page.locator('#planSlide .plan-brand-mark').count(),0);
 await page.locator('[data-plan-fs="motion"]').click();assert.equal(await page.locator('#planMotion').getAttribute('aria-pressed'),'true');
 await page.locator('[data-plan-fs="replay"]').click();assert.equal(await page.locator('#planMotion').getAttribute('aria-pressed'),'false');
 await page.keyboard.press('ArrowRight');assert.match(await page.locator('#planStage').getAttribute('aria-label'),/5:/);
 await page.locator('[data-plan-fs="exit"]').click();assert.equal(await page.locator('.plan-fullscreen-brand').isVisible(),false);
 await page.close();
});

test('presentation actions are direct labelled icon buttons and details stay on demand',async()=>{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 for(const name of ['pitch-deck','business-plan']){
  await page.goto(url+'/'+name+'.html?lang=fr');
  const buttons=page.locator(name==='pitch-deck'?'.controls button':'.plan-controls button');
  for(const button of await buttons.all()){assert.equal((await button.textContent()).trim(),'');assert.ok((await button.getAttribute('aria-label')).length>2);assert.equal(await button.locator('svg').count(),1)}
  const toggle=page.locator(name==='pitch-deck'?'#evidenceToggle':'#planDetailToggle');
  const panel=page.locator(name==='pitch-deck'?'#deckEvidence':'#planDetailPanel');assert.equal(await panel.isVisible(),false);await toggle.click();assert.equal(await panel.isVisible(),true);await toggle.click();assert.equal(await panel.isVisible(),false);
  await page.locator('#theme-toggle').click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nota.theme'))),await page.locator('html').getAttribute('data-theme'));
 }
 await page.close();
});
