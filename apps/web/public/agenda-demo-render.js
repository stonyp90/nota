/* A notary's complete calendar-to-acceptance journey.
 * Calendar synchronization is illustrated; every Nota panel is a real capture
 * of the local application. The exporter supplies captures and domain data. */
(function (root) {
  'use strict';
  var D = root.NotaDomain, I = root.NotaI18N, B = root.NotaCalendarBrand;
  if (!B || !B.captures || !B.demoOffer) throw new Error('The film needs real Nota captures and an offer.');
  var C = B.colors, bid = B.demoOffer, duration = 15.5;
  var W=1120,H=630;
  var offers = D.makeFixtures(bid.createdAt).filter(function (b) { return b.dateISO.slice(0, 7) === bid.dateISO.slice(0, 7); });
  var byDate = {};
  offers.forEach(function (b) { if (!byDate[b.dateISO]) byDate[b.dateISO] = b; });
  byDate[bid.dateISO] = bid;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]; }); }
  function rect(x,y,w,h,fill,r,stroke) { return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+(r||0)+'" fill="'+fill+'"'+(stroke?' stroke="'+stroke+'"':'')+'/>'; }
  function text(x,y,s,size,color,weight,heading) { return '<text x="'+x+'" y="'+y+'" fill="'+(color||C.lightInk)+'" font-family="'+(heading?B.heading:B.body)+'" font-size="'+size+'" font-weight="'+(weight||400)+'">'+esc(s)+'</text>'; }
  function ease(v) { v=Math.max(0,Math.min(1,v)); return v*v*(3-2*v); }
  function mix(a,b,t) { return a+(b-a)*t; }
  function group(body,alpha) { return '<g opacity="'+alpha+'">'+body+'</g>'; }
  function pointer(x,y,click) {
    return (click>0?'<circle cx="'+x+'" cy="'+y+'" r="'+(9+click*22)+'" fill="none" stroke="'+C.brand+'" stroke-width="2" opacity="'+(1-click)+'"/>':'')+
      '<path d="M0 0L0 25L7 19L13 31L18 28L12 17L22 17Z" transform="translate('+x+' '+y+')" fill="'+C.lightInk+'" stroke="'+C.paper+'" stroke-width="2" stroke-linejoin="round"/>';
  }
  function shot(name,lang,x,y,scale,height,pan,suffix) {
    var a=B.captures[lang][name],h=height||a.height*scale,id='shot-'+name+(suffix?'-'+suffix:'');
    // Crop the full browser capture inside SVG: no replica of application UI.
    return '<defs><clipPath id="'+id+'"><rect x="'+x+'" y="'+y+'" width="'+a.width*scale+'" height="'+h+'" rx="12"/></clipPath></defs>'+
      '<g clip-path="url(#'+id+')"><image href="'+a.image+'" x="'+(x-a.x*scale)+'" y="'+(y-(a.y+(pan||0))*scale)+'" width="'+a.imageWidth*scale+'" height="'+a.imageHeight*scale+'"/></g>';
  }
  function render(time,lang) {
    lang=lang==='en'?'en':'fr';
    var s=Math.max(0,Math.min(duration-.001,Number(time)||0));
    var T=function(v) { return lang==='en'?I.tEn(v):v; };
    var amount=lang==='en'?D.moneyEn(bid.montant):D.money(bid.montant);
    var svc=D.serviceById(bid.serviceId),service=lang==='en'?svc.nomCourtEn:svc.nomCourt;
    var step=s<4?0:s<10.5?1:2;
    var titles=['Le notaire ajoute Nota à son agenda.','Choisissez une offre dans votre agenda.','Vérifiez et confirmez dans Nota.'];
    var notes=['Google Agenda · Outlook · Apple Calendrier','Mises à jour selon la synchronisation de votre agenda.','Le lien ouvre directement cette demande après connexion.'];
    var out='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">';
    // The product canvas and logo remain visible throughout every scene.
    out+=rect(0,0,W,H,C.lightBg,12);
    out+='<image href="'+B.logo+'" x="14" y="0" width="126" height="59"/>';
    out+=text(925,35,T('Exemple de démonstration'),11,C.lightMuted);
    out+=text(24,88,T(titles[step]),25,C.lightInk,700,true);
    out+=text(24,114,T(notes[step]),13,C.lightMuted);
    out+=rect(24,126,1072,1,C.lightBorder);
    out+='<g>';

    if(step===0) {
      var sub=B.captures[lang].subscribe,subScale=Math.min(530/sub.width,410/sub.height),subX=24;
      out+=shot('subscribe',lang,subX,165,subScale,sub.height*subScale);
      // A calendar beside the real subscription choices makes their purpose
      // immediately visible, and the following scene opens this same month.
      out+=rect(586,151,510,428,C.lightSurface,12,C.lightBorder);
      out+=text(608,190,T('Septembre 2026'),20,C.lightInk,700,true);
      var miniDays=lang==='en'?['M','T','W','T','F','S','S']:['L','M','M','J','V','S','D'];
      for(var md=0;md<7;md++) out+=text(623+md*67,220,miniDays[md],12,C.lightMuted,600);
      for(var mi=0;mi<35;mi++) {
        var mx=607+(mi%7)*67,my=233+Math.floor(mi/7)*64,mdate=new Date(Date.UTC(2026,7,31+mi));
        out+=rect(mx,my,67,64,C.lightSurface,0,C.lightBorder);
        out+=text(mx+8,my+18,mdate.getUTCDate(),12,mdate.getUTCMonth()===8?C.lightInk:C.lightMuted);
        if(mi===23&&s>=3.2) out+=rect(mx+6,my+27,55,26,C.lightBg,5,C.lightBorder)+text(mx+12,my+44,'Nota',11,C.brand,600);
      }
      var action=sub.action,progress=ease((s-1.2)/1.1);
      if(action&&s>1.2) out+=pointer(mix(subX+sub.width*subScale+45,subX+action.x*subScale,progress),mix(480,165+action.y*subScale,progress),s>2.7&&s<3.3?(s-2.7)/.6:0);
      if(s>3.2) out+=group(text(24,604,T('Confirmez l’ajout dans votre calendrier.'),14,C.lightMuted,600),ease((s-3.2)/.3));
    }

    if(step===1) {
      var gx=24,gy=210,cw=153.142857,rh=77;
      out+=text(24,170,T('Septembre 2026'),20,C.lightInk,700,true);
      out+=rect(856,149,236,28,C.lightSurface,8,C.lightBorder)+'<path d="M867 163l4 4 7-8" fill="none" stroke="'+C.brand+'" stroke-width="2" stroke-linecap="round"/>'+text(886,168,T('Demandes Nota'),13,C.lightMuted,600);
      var days=lang==='en'?['MON','TUE','WED','THU','FRI','SAT','SUN']:['LUN.','MAR.','MER.','JEU.','VEN.','SAM.','DIM.'];
      days.forEach(function(day,i) { out+=text(gx+i*cw+61,198,day,11,C.lightMuted,600); });
      out+='<defs><clipPath id="month"><rect x="'+gx+'" y="'+gy+'" width="1072" height="385" rx="12"/></clipPath></defs><g clip-path="url(#month)">';
      var selected;
      for(var i=0;i<35;i++) {
        var date=new Date(Date.UTC(2026,7,31+i)),iso=date.toISOString().slice(0,10),x=gx+(i%7)*cw,y=gy+Math.floor(i/7)*rh;
        out+=rect(x,y,cw,rh,i%7>4?C.lightBg:C.lightSurface,0,C.lightBorder)+text(x+10,y+16,date.getUTCDate(),12,date.getUTCMonth()===8?C.lightInk:C.lightMuted);
        var b=byDate[iso];
        if(b) {
          var isSelected=b.id===bid.id,arrival=isSelected?5.5:4.1+(i%4)*.25,alpha=ease((s-arrival)/.5);
          var st=D.serviceById(b.serviceId),eventY=y+27;
          out+=group(rect(x+6,eventY,cw-12,43,C.lightBg,7,isSelected?C.brand:C.lightBorder)+text(x+14,eventY+15,lang==='en'?st.nomCourtEn:st.nomCourt,11,C.lightMuted,600)+text(x+14,eventY+34,lang==='en'?D.moneyEn(b.montant):D.money(b.montant),15,C.lightInk,700),alpha);
          if(isSelected) selected={x:x+cw/2,y:eventY+19};
        }
      }
      out+='</g>'+rect(gx,gy,1072,385,'none',12,C.lightBorder);
      if(s>5.5&&s<7.7) out+=group(rect(727,149,115,28,C.lightSurface,8,C.lightBorder)+text(739,168,T('Nouvelle offre'),12,C.brand,600),ease((s-5.5)/.3));
      if(s>6.5&&s<8&&selected) {
        var p=ease((s-6.5)/.9);
        out+=pointer(mix(908,selected.x,p),mix(282,selected.y,p),s>7.5?(s-7.5)/.5:0);
      }
      if(s>=8) {
        var px=337,py=239;
        out+=rect(px,py,446,230,C.lightSurface,12,C.lightBorder)+text(px+22,py+34,service,20,C.lightInk,700,true)+text(px+22,py+63,T('Mercredi 23 septembre'),14,C.lightMuted)+text(px+22,py+107,amount,29,C.lightInk,700,true)+text(px+22,py+133,T('Demande Nota'),12,C.lightMuted);
        out+=rect(px+22,py+164,402,44,C.lightSurface,8,C.brand)+text(px+139,py+191,T('Ouvrir dans Nota'),15,C.brand,700);
        if(s>8.8) {
          var p2=ease((s-8.8)/.8);
          out+=pointer(mix(px+410,px+248,p2),mix(py+230,py+185,p2),s>9.8?(s-9.8)/.5:0);
        }
      }
    }

    if(step===2) {
      var confirm=B.captures[lang].confirm,confirmScale=1072/confirm.width,cx=24,cy=145;
      if(confirm.footer) {
        // Read the real captured content at a legible scale. The actual sticky
        // acceptance footer remains visible while the camera follows the file.
        var footerH=confirm.footer.height*confirmScale,readingH=462-footerH;
        var travel=Math.min(104,Math.max(0,confirm.footer.y-readingH/confirmScale));
        var pan=travel*ease((s-12.5)/.8);
        out+=shot('confirm',lang,cx,cy,confirmScale,readingH,pan,'reading');
        out+=shot('confirm',lang,cx,cy+readingH,confirmScale,footerH,confirm.footer.y,'footer');
      } else {
        confirmScale=Math.min(1072/confirm.width,462/confirm.height);cx=(W-confirm.width*confirmScale)/2;
        out+=shot('confirm',lang,cx,cy,confirmScale);
      }
      if(s>13.3&&confirm.action) {
        var p4=ease((s-13.3)/.9),tx=cx+confirm.action.x*confirmScale,ty=confirm.footer?cy+462-(confirm.height-confirm.action.y)*confirmScale:cy+confirm.action.y*confirmScale;
        out+=pointer(mix(tx+160,tx,p4),mix(ty-75,ty,p4),s>14.7?(s-14.7)/.6:0);
      }
    }

    // Opaque editorial cuts keep the information legible on every frame.
    // No white overlay, opacity fade or blank final frame before the loop.
    out+='</g>';
    return out+'</svg>';
  }
  root.NotaCalendarFilm={duration:duration,render:render,offers:offers};
})(typeof globalThis!=='undefined'?globalThis:this);
