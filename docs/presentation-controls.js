/* Shared, dependency-free presentation controls. Labels remain accessible. */
window.NotaPresentation = (() => {
  const paths = {
    previous:'M14 5 7 12l7 7M7 12h13', next:'m10 5 7 7-7 7M4 12h13',
    replay:'M4 10a8 8 0 1 1 1 7M4 4v6h6',
    pause:'M8 5v14M16 5v14', play:'m7 4 12 8-12 8Z',
    stop:'M6 6h12v12H6Z', fullscreen:'M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    exit:'M4 9h5V4M20 9h-5V4M15 20v-5h5M9 20v-5H4',
    info:'M12 11v6M12 7v.1M4 4h16v16H4Z',
    detail:'M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1',
    transcript:'M4 5h16M4 10h16M4 15h10M4 20h10',
    download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
    motionOff:'M4 4l16 16M8 11v8M16 5v6'
  };
  const icon = name => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
  function set(button, label, name) {
    button.innerHTML = icon(name); button.setAttribute('aria-label', label); button.title = label;
    button.classList.add('presentation-icon');
  }
  return {set, icon};
})();
