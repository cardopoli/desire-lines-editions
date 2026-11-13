// Silent PDF reader. PDF.js is pinned. Pages fill the screen; the few labels
// fade away when you stop moving. Neighbouring pages are drawn in advance so
// turning is instant.
const PDFJS_ROOT = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/';
const IDLE_MS = 2200, MARGIN = 0.04, ZOOM = 2.5, MAX_ZOOM = 8, CACHE_MAX = 10;

export function normaliseSource(raw, base) {
  const url = new URL(String(raw || '').trim(), base);
  if (!String(raw || '').trim() || !['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid PDF address.');
  if (url.hostname === 'www.dropbox.com' || url.hostname === 'dropbox.com') {
    if (url.pathname.startsWith('/scl/fo/')) throw new Error('Please use a link to a PDF file, rather than a Dropbox folder.');
    url.hostname = 'dl.dropboxusercontent.com';
    url.searchParams.delete('raw');
    url.searchParams.set('dl', '1');
  }
  return url.href;
}
export function clampPage(page, total) { return Math.max(1, Math.min(total, Math.trunc(Number(page)) || 1)); }
// Laid out like a printed book: the cover (first page) and back cover (last
// page) always stand alone; everything between pairs up 2-3, 4-5 ...
export function visiblePages(page, total, spread) {
  let first = clampPage(page, total);
  if (!spread || first === 1 || first === total) return [first];
  if (first % 2 === 1) first--;
  return first + 1 < total ? [first, first + 1] : [first];
}
export function nextPage(page, total, spread) { const v = visiblePages(page, total, spread); return v.at(-1) === total ? v[0] : clampPage(v.at(-1) + 1, total); }
export function previousPage(page, total, spread) { const first = visiblePages(page, total, spread)[0]; return visiblePages(Math.max(1, first - 1), total, spread)[0]; }
export function pageFromHash(hash) { const m = /^#page=(\d+)$/.exec(hash); return m ? Number(m[1]) : 1; }

async function startReader(root) {
  const $ = id => document.getElementById(id);
  const prevBtn = $('pdf-prev'), nextBtn = $('pdf-next'), zoomOutBtn = $('pdf-zoom-out'), zoomInBtn = $('pdf-zoom-in');
  const stage = $('pdf-stage'), holder = $('pdf-pages'), count = $('pdf-count'), status = $('pdf-status'), full = $('pdf-fullscreen'), viewBtn = $('pdf-view');
  let doc, current = pageFromHash(location.hash), zoom = 1, generation = 0, idleTimer, resizeTimer;
  const zoomedIn = () => zoom > 1.01;
  const sizes = new Map();          // page number -> unscaled viewport {width,height}
  const cache = new Map();          // "page@scale" -> Promise<canvas>
  // Spreads by default (the PDFs are designed as spreads). Landscape always shows
  // spreads; in portrait the reader can switch to single pages, remembered per device.
  const VIEW_KEY = 'pdf-reader-view';
  let view = 'spread';
  try { if (localStorage.getItem(VIEW_KEY) === 'page') view = 'page'; } catch {}
  const vw = () => document.documentElement.clientWidth || innerWidth;
  const vh = () => document.documentElement.clientHeight || innerHeight;
  // how far the reader has pinched in (1 = not zoomed); used to redraw pages sharp
  const pinch = () => Math.max(1, Math.min((window.visualViewport && visualViewport.scale) || 1, 4));
  const landscape = () => vw() / vh() > 1.1;
  const wide = () => landscape() || view === 'spread';
  const labelView = () => { if (viewBtn) { viewBtn.textContent = view === 'spread' ? 'Single' : 'Spread'; viewBtn.setAttribute('aria-label', view === 'spread' ? 'Show one page at a time' : 'Show two-page spreads'); } };

  // ---- quiet furniture -------------------------------------------------------
  const touchUI = matchMedia('(hover: none)');
  // desktop: labels fade after a moment. phones: controls stay until you tap the page to hide them
  const wake = () => { root.classList.remove('idle'); clearTimeout(idleTimer); if (!touchUI.matches) idleTimer = setTimeout(() => root.classList.add('idle'), IDLE_MS); };
  const hush = () => { clearTimeout(idleTimer); root.classList.add('idle'); };

  // ---- drawing ---------------------------------------------------------------
  async function size(n) {
    if (!sizes.has(n)) { const p = await doc.getPage(n), v = p.getViewport({ scale: 1 }); sizes.set(n, { width: v.width, height: v.height }); }
    return sizes.get(n);
  }
  async function scaleFor(numbers) {
    const views = await Promise.all(numbers.map(size));
    const w = views.reduce((s, v) => s + v.width, 0), h = Math.max(...views.map(v => v.height));
    const fit = Math.min(vw() * (1 - MARGIN * 2) / w, vh() * (1 - MARGIN * 3) / h);
    return Math.max(0.1, fit * zoom);
  }
  function draw(n, scale, boost = 1) {
    const key = n + '@' + scale.toFixed(4), big = boost > 1 || zoomedIn();
    if (!big && cache.has(key)) { const hit = cache.get(key); cache.delete(key); cache.set(key, hit); return hit; }
    const job = (async () => {
      const page = await doc.getPage(n), css = page.getViewport({ scale });
      // enough pixels for the screen and the current pinch, within what phones allow per canvas
      const ratio = Math.min((devicePixelRatio || 1) * boost, Math.sqrt((touchUI.matches ? 8e6 : 16e6) / (css.width * css.height)));
      const view = page.getViewport({ scale: scale * ratio });
      const c = document.createElement('canvas');
      // round DOWN so no pixel sits half outside the page (that sliver showed as a pale line)
      c.width = Math.floor(view.width); c.height = Math.floor(view.height);
      c.style.width = (c.width / ratio) + 'px'; c.style.height = (c.height / ratio) + 'px';
      c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Page ' + n);
      await page.render({ canvasContext: c.getContext('2d'), viewport: view }).promise;
      if (big) c.dataset.boosted = '1';
      return c;
    })();
    if (big) return job;
    cache.set(key, job);
    job.catch(() => cache.delete(key));
    while (cache.size > CACHE_MAX) {
      const [oldKey, old] = cache.entries().next().value; cache.delete(oldKey);
      old.then(c => { if (!c.isConnected) c.width = c.height = 0; }).catch(() => {});
    }
    return job;
  }
  async function prepare(first, boost = 1) {
    const numbers = visiblePages(first, doc.numPages, wide()), scale = await scaleFor(numbers);
    return Promise.all(numbers.map(n => draw(n, scale, boost)));
  }

  async function show(focus, sharpen = false) {
    if (!doc) return;
    const version = ++generation, spread = wide(), boost = pinch();
    const numbers = visiblePages(current, doc.numPages, spread);
    current = numbers[0];
    try {
      const canvases = await prepare(current, boost);
      if (version !== generation) return;
      const old = [...holder.querySelectorAll('canvas[data-boosted]')];
      holder.replaceChildren(...canvases);
      holder.style.transform = holder.style.transformOrigin = '';   // drop the pinch preview now the sharp page is in
      old.forEach(c => { if (!c.isConnected) c.width = c.height = 0; });   // free big pinch-zoom canvases
      holder.classList.remove('waiting');
      if (sharpen) return;   // same page, just redrawn sharper: leave scroll and position alone
      if (zoomedIn() && focus) {
        // keep the point under the fingers (or the click) where it was
        stage.scrollLeft = holder.offsetLeft + focus.fx * holder.offsetWidth - focus.sx;
        stage.scrollTop = holder.offsetTop + focus.fy * holder.offsetHeight - focus.sy;
      } else { stage.scrollLeft = stage.scrollTop = 0; }
      const label = (numbers.length > 1 ? numbers.join('-') : numbers[0]) + ' / ' + doc.numPages;
      count.textContent = (numbers.length > 1 ? numbers.join('-') : numbers[0]) + '/' + doc.numPages + (zoomedIn() ? ' ' + (Math.round(zoom * 10) / 10) + '×' : '');
      if (prevBtn) { prevBtn.disabled = current === 1; nextBtn.disabled = numbers.at(-1) === doc.numPages; }
      if (zoomOutBtn) { zoomOutBtn.disabled = !zoomedIn(); zoomInBtn.disabled = zoom >= MAX_ZOOM; } status.textContent = 'Page ' + label;
      history.replaceState(null, '', '#page=' + current);
      // quietly get the neighbours ready
      if (!zoomedIn()) {
        const ahead = nextPage(current, doc.numPages, spread), behind = previousPage(current, doc.numPages, spread);
        setTimeout(() => { if (version === generation) { prepare(ahead).catch(() => {}); if (behind !== current) prepare(behind).catch(() => {}); } }, 120);
      }
    } catch (error) {
      if (version === generation) console.warn('PDF page could not be drawn', error);
    }
  }

  function turn(direction) {
    if (!doc) return;
    const spread = wide(), target = direction > 0 ? nextPage(current, doc.numPages, spread) : previousPage(current, doc.numPages, spread);
    if (target === current) return;
    zoom = 1; stage.classList.remove('zoomed');
    current = target; show();
  }
  // zoom to z (1 = whole page fits) keeping screen point (sx, sy) fixed; `box` = page rect before any preview
  function setZoom(z, sx = vw() / 2, sy = vh() / 2, box = holder.getBoundingClientRect()) {
    if (!doc) return;
    z = Math.max(1, Math.min(MAX_ZOOM, z));
    const clamp01 = v => Math.max(0, Math.min(1, v));
    const focus = { fx: box.width ? clamp01((sx - box.left) / box.width) : .5, fy: box.height ? clamp01((sy - box.top) / box.height) : .5, sx, sy };
    zoom = z < 1.03 ? 1 : z;
    stage.classList.toggle('zoomed', zoomedIn()); if (zoomedIn()) hush();
    show(focus);
  }
  function toggleZoom(event) { setZoom(zoomedIn() ? 1 : ZOOM, event?.clientX, event?.clientY); }
  // live preview while pinching or wheel-zooming: scale what is there, redraw sharp when the gesture ends
  function preview(k, sx, sy, box) { holder.style.transformOrigin = `${sx - box.left}px ${sy - box.top}px`; holder.style.transform = `scale(${k})`; }

  // ---- input -----------------------------------------------------------------
  const zone = x => x < innerWidth * 0.38 ? 'prev' : x > innerWidth * 0.62 ? 'next' : 'mid';
  const touch = matchMedia('(hover: none)');
  let quietUntil = 0;   // swallow the click a touch gesture leaves behind
  stage.addEventListener('mousemove', e => { stage.dataset.zone = zoomedIn() ? '' : zone(e.clientX); });
  stage.addEventListener('click', e => {
    if (pinch() > 1.05 || Date.now() < quietUntil) return;
    if (touch.matches) { root.classList.contains('idle') ? wake() : hush(); return; }   // phones: a tap shows / hides the controls
    if (zoomedIn()) { toggleZoom(); return; }
    const z = zone(e.clientX);
    if (z === 'prev') turn(-1);
    else if (z === 'next') turn(1);
    else if (touch.matches) { root.classList.contains('idle') ? wake() : hush(); }
    else toggleZoom(e);
  });
  // ---- touch: swipe to turn, pinch to zoom (up to 8x), double-tap to zoom in / out
  let start = null, gesture = null, lastTap = null;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  stage.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      gesture = { d0: dist(a, b) || 1, sx: (a.clientX + b.clientX) / 2, sy: (a.clientY + b.clientY) / 2, z0: zoom, k: 1, box: holder.getBoundingClientRect() };
      start = null; return;
    }
    if (e.touches.length === 1 && !gesture) start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (!gesture || e.touches.length < 2) return;
    e.preventDefault();
    const [a, b] = e.touches, z = Math.max(1, Math.min(MAX_ZOOM, gesture.z0 * dist(a, b) / gesture.d0));
    gesture.k = z / gesture.z0;
    preview(gesture.k, gesture.sx, gesture.sy, gesture.box);
  }, { passive: false });
  stage.addEventListener('touchend', e => {
    if (gesture) {
      if (e.touches.length < 2) {
        const g = gesture; gesture = null; quietUntil = Date.now() + 400;
        if (Math.abs(g.k - 1) > 0.02) setZoom(g.z0 * g.k, g.sx, g.sy, g.box); else holder.style.transform = '';
      }
      return;
    }
    if (!start || !e.changedTouches.length) return;
    const t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y, quick = Date.now() - start.t < 260;
    start = null;
    if (!zoomedIn() && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) { e.preventDefault(); turn(dx < 0 ? 1 : -1); return; }
    if (quick && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const now = Date.now();
      // double-tap: zoom in where you tapped (middle of the screen) or back out (anywhere, when zoomed)
      if (lastTap && now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 40 && (zoomedIn() || zone(t.clientX) === 'mid')) {
        lastTap = null; quietUntil = now + 400; e.preventDefault();
        setZoom(zoomedIn() ? 1 : ZOOM, t.clientX, t.clientY);
      } else lastTap = { x: t.clientX, y: t.clientY, t: now };
    }
  });
  // ---- the visible buttons
  const tap = (el, fn) => el && el.addEventListener('click', e => { e.stopPropagation(); fn(); wake(); });
  tap(prevBtn, () => turn(-1)); tap(nextBtn, () => turn(1));
  tap(zoomInBtn, () => setZoom(zoom * 2)); tap(zoomOutBtn, () => setZoom(zoom / 2));
  // iPhone Safari runs its own pinch zoom on top of ours unless told not to
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, e => e.preventDefault(), { passive: false });
  // ---- trackpad pinch / ctrl + scroll on desktop
  let wheel = null, wheelTimer;
  stage.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (!wheel) wheel = { z0: zoom, k: 1, sx: e.clientX, sy: e.clientY, box: holder.getBoundingClientRect() };
    wheel.k = Math.max(1 / wheel.z0, Math.min(MAX_ZOOM / wheel.z0, wheel.k * Math.exp(-e.deltaY * 0.01)));
    preview(wheel.k, wheel.sx, wheel.sy, wheel.box);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { const w = wheel; wheel = null; setZoom(w.z0 * w.k, w.sx, w.sy, w.box); }, 180);
  }, { passive: false });
  addEventListener('mousemove', () => { if (!touch.matches) wake(); }, { passive: true });
  if (viewBtn) {
    labelView();
    viewBtn.addEventListener('click', e => {
      e.stopPropagation();
      view = view === 'spread' ? 'page' : 'spread';
      try { localStorage.setItem(VIEW_KEY, view); } catch {}
      labelView(); zoom = 1; stage.classList.remove('zoomed'); show(); wake();
    });
  }
  root.addEventListener('keydown', e => {
    if (!doc || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); turn(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); turn(-1); }
    else if (k === 'Home' || k === 'End') { e.preventDefault(); zoom = 1; stage.classList.remove('zoomed'); current = k === 'Home' ? 1 : doc.numPages; show(); }
    else if (k === 'z' || k === 'Z') toggleZoom();
    else if (k === '+' || k === '=') setZoom(zoom * 1.5);
    else if (k === '-' || k === '_') setZoom(zoom / 1.5);
    else if ((k === 'f' || k === 'F') && !full.hidden) full.click();
    else if (k === 'Escape' && zoomedIn()) setZoom(1);
    else return;
    wake();
  });
  let laidOut = vw() + 'x' + vh(), drawnBoost = 1, pinchTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { const now = vw() + 'x' + vh(); if (now === laidOut) return; laidOut = now; cache.clear(); show(); }, 160); });
  if (window.visualViewport) visualViewport.addEventListener('resize', () => {
    clearTimeout(pinchTimer);
    pinchTimer = setTimeout(() => { const b = pinch(); if (Math.abs(b - drawnBoost) < 0.2) return; drawnBoost = b; show(null, true); }, 250);
  });
  addEventListener('hashchange', () => { const p = pageFromHash(location.hash); if (doc && p !== current) { current = p; show(); } });

  if (root.requestFullscreen && document.fullscreenEnabled) {
    full.hidden = false;
    full.addEventListener('click', e => { e.stopPropagation(); document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); });
    document.addEventListener('fullscreenchange', () => { full.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; root.focus(); });
  }

  // ---- open ------------------------------------------------------------------
  root.focus({ preventScroll: true });
  wake();
  try {
    const source = normaliseSource(root.dataset.pdfUrl, location.href);
    $('pdf-original').href = source;
    const pdfjs = await import(PDFJS_ROOT + 'build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_ROOT + 'build/pdf.worker.min.mjs';
    doc = await pdfjs.getDocument({ url: source, isEvalSupported: false, disableAutoFetch: true, disableStream: true,
      cMapUrl: PDFJS_ROOT + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_ROOT + 'standard_fonts/', wasmUrl: PDFJS_ROOT + 'wasm/' }).promise;
    current = clampPage(current, doc.numPages);
    await show();
  } catch (error) {
    console.warn(error);
    root.classList.add('failed'); count.textContent = '';
  }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('pdf-reader');
  if (root) startReader(root);
}
