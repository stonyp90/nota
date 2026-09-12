/** Build the short, silent inline calendar clip. No voice or audio pipeline.
 * npm install --prefix output/calendar-runtime --no-audit --no-fund @resvg/resvg-js
 * node demo/render-calendar.mjs [--lang=en]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const {Resvg}=require(process.env.RESVG_MODULE||join(root,'output/calendar-runtime/node_modules/@resvg/resvg-js'));
const publicDir=join(root,'apps/web/public');
const css=readFileSync(join(publicDir,'styles.css'),'utf8');
const dark=css.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/)[1];
const token=(name,source=css)=>{
  const match=source.match(new RegExp(name+':\\s*(#[0-9a-f]{6})\\s*;', 'i'));
  if(!match)throw new Error('Missing Nota colour: '+name);
  return match[1];
};
const family=name=>css.match(new RegExp(name+":\\s*'([^']+)'"))[1];
const captureDir=join(root,'demo/calendar-captures');
const captures=JSON.parse(readFileSync(join(captureDir,'manifest.json'),'utf8'));
for(const lang of ['fr','en']) for(const name of ['subscribe','offer','confirm']) {
  const capture=captures[lang][name],filename=capture.file||name+'-'+lang+'.png';
  const path=join(captureDir,filename);
  const probe=spawnSync(process.env.FFPROBE||'ffprobe',['-v','error','-show_entries','stream=width,height','-of','json',path],{encoding:'utf8'});
  if(probe.status!==0)throw new Error('Unreadable capture: '+path);
  const dimensions=JSON.parse(probe.stdout).streams[0];
  capture.imageWidth=dimensions.width;capture.imageHeight=dimensions.height;
  if(!(capture.width>0&&capture.height>0&&capture.x>=0&&capture.y>=0&&capture.x+capture.width<=capture.imageWidth+1&&capture.y+capture.height<=capture.imageHeight+1))throw new Error('Invalid capture framing: '+filename);
  if(name==='confirm'&&(!capture.footer||capture.footer.y<0||capture.footer.height<=0||capture.footer.y+capture.footer.height>capture.height+1))throw new Error('Confirmation footer is missing or outside its capture: '+filename);
  capture.image='data:image/'+(filename.endsWith('.jpg')?'jpeg':'png')+';base64,'+readFileSync(path).toString('base64');
}
const box={NotaDomain:require('../packages/domain/index.js'),NotaCalendarBrand:{
  captures,logo:'data:image/svg+xml;base64,'+readFileSync(join(publicDir,'nota-logo-light.svg')).toString('base64'),demoOffer:JSON.parse(readFileSync(join(captureDir,'offer.json'),'utf8')),
  heading:family('--font-display'),body:family('--font-sans'),
  colors:{bg:token('--bg',dark),surface:token('--surface',dark),ink:token('--ink',dark),
    muted:token('--ink-muted',dark),border:token('--border',dark),accent:token('--nota-blue-400'),
    brand:token('--nota-blue-700'),paper:token('--paper'),lightInk:token('--canvas-ink'),
    lightBg:token('--canvas-bg'),lightMuted:token('--canvas-ink-muted'),lightBorder:token('--canvas-border'),lightSurface:token('--canvas-surface'),inset:token('--canvas-surface-inset')}
}};
for(const name of ['i18n.js','agenda-demo-render.js'])vm.runInNewContext(readFileSync(join(root,'apps/web/public',name),'utf8'),box);
const film=box.NotaCalendarFilm,lang=process.argv.includes('--lang=en')?'en':'fr',fps=24;
const destination=join(root,'apps/web/public/media'),review=join(root,'demo/sortie/calendrier');
mkdirSync(destination,{recursive:true});mkdirSync(review,{recursive:true});
const fontPrep=spawnSync(process.env.PYTHON||'python3',[join(root,'demo/prepare-calendar-fonts.py')],{encoding:'utf8'});
if(fontPrep.status!==0)throw new Error('Install fonttools and brotli in output/calendar-runtime/python. '+fontPrep.stderr);
const fonts=['inter-400','inter-600','inter-700','sora-700'].map(name=>join(root,'output/calendar-runtime/fonts',name+'.ttf'));
if(!fonts.every(existsSync))throw new Error('Nota film fonts are missing.');
let previousSvg,previousFrame;
const frame=t=>{
  const svg=film.render(t,lang);
  // Held scenes keep the exact same pixels; rasterize only when they change.
  if(svg!==previousSvg){
    previousSvg=svg;
    previousFrame=new Resvg(svg,{background:box.NotaCalendarBrand.colors.lightBg,fitTo:{mode:'width',value:1280},font:{fontFiles:fonts,loadSystemFonts:false,defaultFontFamily:box.NotaCalendarBrand.body}}).render().asPng();
  }
  return previousFrame;
};
if(process.argv.includes('--frames-only')){
  const previews=join(root,'output/calendar-brand-review');mkdirSync(previews,{recursive:true});
  for(const t of [1,3.9,4,5.5,7.5,9.5,10.5,12,14.8,film.duration-.001])writeFileSync(join(previews,lang+'-'+t+'.png'),frame(t));
  console.log(previews);process.exit(0);
}
writeFileSync(join(destination,'nota-agenda-'+lang+'.png'),frame(10));
const temp=join(destination,'nota-agenda-'+lang+'.tmp.mp4'),movie=join(destination,'nota-agenda-'+lang+'.mp4');
const encoder=spawn(process.env.FFMPEG||'ffmpeg',['-y','-v','error','-f','image2pipe','-framerate',String(fps),'-vcodec','png','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-t',String(film.duration),'-movflags','+faststart',temp],{stdio:['pipe','ignore','pipe']});
let error='';encoder.stderr.on('data',chunk=>{error+=chunk;});const completion=once(encoder,'close');
for(let i=0;i<film.duration*fps;i++){
  if(!encoder.stdin.write(frame(i/fps)))await once(encoder.stdin,'drain');
  if(i%(fps*6)===0)console.log(lang+': '+i/fps+'/'+film.duration+' s');
}
encoder.stdin.end();const [code]=await completion;if(code!==0)throw new Error(error);
renameSync(temp,movie);copyFileSync(movie,join(review,'nota-calendrier-'+lang+'.mp4'));
// Also refresh development URLs: the service worker caches unversioned media.
// Production adds its own hashed filenames on top of these content versions.
for(const page of ['index.html','agenda-demo.html']){
  const path=join(publicDir,page);let html=readFileSync(path,'utf8');
  for(const extension of ['mp4','png']){
    const name='nota-agenda-'+lang+'.'+extension;
    const version=createHash('sha256').update(readFileSync(join(destination,name))).digest('hex').slice(0,10);
    html=html.replace(new RegExp('media/nota-agenda-'+lang+'\\.'+extension+'(?:\\?v=[a-f0-9]+)?','g'),'media/'+name+'?v='+version);
  }
  writeFileSync(path,html);
}
console.log(movie);
