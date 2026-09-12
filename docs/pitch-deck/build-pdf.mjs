/** Export the same bilingual native SVG used by the viewer as searchable, linked PDFs. */
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const here=dirname(fileURLToPath(import.meta.url)),docs=join(here,'..');
const html=readFileSync(join(docs,'pitch-deck.html'),'utf8');
const data=JSON.parse(html.match(/<script type="application\/json" id="deck-data">([\s\S]*?)<\/script>/)[1]);
const fonts=html.match(/@font-face\s*\{[^}]*\}/g).join('\n');
const browser=await chromium.launch();
try{
 const page=await browser.newPage({reducedMotion:'reduce'});
 for(const lang of ['fr','en']){
  const frames=data.editions[lang];if(frames.length!==9)throw new Error('The deck contract requires 9 slides per language');
  await page.setContent(`<!doctype html><html lang="${lang}-CA"><head><meta charset="utf-8"><title>Nota</title><style>${fonts}@page{size:1600px 900px;margin:0}html,body{margin:0}section{width:1600px;height:900px;break-after:page}section:last-child{break-after:auto}svg{display:block;width:1600px;height:900px}a{cursor:pointer}</style></head><body>${frames.map(frame=>`<section>${frame.svg}</section>`).join('')}</body></html>`);
  await page.evaluate(async()=>{await document.fonts.load('700 54px Sora');await document.fonts.load('500 24px Inter');await document.fonts.ready;if(!document.fonts.check('700 54px Sora'))throw new Error('Sora missing')});
  await page.pdf({path:join(docs,`nota-pitch-deck${lang==='fr'?'-fr':''}.pdf`),width:'1600px',height:'900px',printBackground:true,tagged:true,margin:{top:0,right:0,bottom:0,left:0}});
  console.log(`Wrote ${lang} PDF: 9 vector slides with selectable text and primary-source links`);
 }
}finally{await browser.close()}
