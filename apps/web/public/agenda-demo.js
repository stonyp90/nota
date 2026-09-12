/* Silent inline clips: pause offscreen, respect reduced motion and user intent. */
(function () {
  'use strict';
  var lang=window.NotaI18N&&window.NotaI18N.lang()==='en'?'en':'fr';
  var T=window.NotaI18N?window.NotaI18N.t:function(s){return s;};
  var motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('.nc-calendar-teaser').forEach(function(figure){
    var video=figure.querySelector('video'),button=figure.querySelector('.nc-calendar-play');
    var inView=false,loaded=false,userPaused=false,failed=false;
    video.muted=true;
    video.poster=video.getAttribute('data-poster-'+lang);
    function label(){if(button)button.textContent=T(failed?'Réessayer l’animation':video.paused?'Lire l’animation':'Mettre en pause');}
    function play(){
      if(!loaded){video.src=video.getAttribute('data-film-'+lang);loaded=true;}
      if(failed){video.load();failed=false;}
      var result=video.play();
      if(result&&result.catch)result.catch(function(error){
        if(error.name!=='AbortError'&&error.name!=='NotAllowedError')failed=true;
        label();
      });
    }
    function update(){
      if(inView&&!document.hidden&&!motion.matches&&!userPaused)play();else video.pause();
    }
    video.addEventListener('play',label);
    video.addEventListener('pause',label);
    video.addEventListener('error',function(){failed=true;label();});
    if(button)button.addEventListener('click',function(){
      if(failed||video.paused){userPaused=false;play();}else{userPaused=true;video.pause();}
    });
    document.addEventListener('visibilitychange',update);
    motion.addEventListener('change',update);
    if(window.IntersectionObserver){
      new IntersectionObserver(function(entries){inView=entries[0].isIntersecting&&entries[0].intersectionRatio>=.1;update();},{threshold:.1}).observe(video);
    }else{inView=true;update();}
    label();
  });
})();
