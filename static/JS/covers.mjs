// Draw page 1 of each PDF as its cover, only when it scrolls into view.
// <div class="cover" data-pdf="/downloads/x.pdf"></div> - skipped when it already holds an <img>.
const ROOT = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/';
const boxes = [...document.querySelectorAll('.cover[data-pdf]')].filter(b => !b.querySelector('img') && b.dataset.pdf);
let lib;
const load = async () => lib ??= import(ROOT + 'build/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = ROOT + 'build/pdf.worker.min.mjs'; return m; });
async function draw(box) {
  try {
    const pdfjs = await load();
    const doc = await pdfjs.getDocument({ url: new URL(box.dataset.pdf, location.href).href, isEvalSupported: false, disableAutoFetch: true, disableStream: true, wasmUrl: ROOT + 'wasm/', standardFontDataUrl: ROOT + 'standard_fonts/' }).promise;
    const page = await doc.getPage(1), base = page.getViewport({ scale: 1 });
    const scale = Math.min(box.clientWidth / base.width, box.clientHeight / base.height) * Math.min(devicePixelRatio || 1, 2);
    const view = page.getViewport({ scale }), c = document.createElement('canvas');
    c.width = Math.floor(view.width); c.height = Math.floor(view.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: view }).promise;
    c.setAttribute('aria-hidden', 'true');
    box.append(c); requestAnimationFrame(() => c.classList.add('ready'));
    doc.destroy();
  } catch (e) { console.warn('Cover could not be drawn', e); }
}
const watch = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { watch.unobserve(e.target); draw(e.target); } }), { rootMargin: '200px' });
boxes.forEach(b => watch.observe(b));
