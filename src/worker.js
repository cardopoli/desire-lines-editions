// Desire Lines Editions - Cloudflare Worker in front of the static site.
// Only two paths reach this code (see run_worker_first in wrangler.jsonc); everything else is served as files.
//
//   /dropbox?u=<Dropbox share link>  - fetches a PUBLIC Dropbox share link and hands it to the reader
//                                      (Dropbox doesn't let other sites load its files directly).
//                                      Only dropbox.com links are accepted, so nobody can use this to fetch
//                                      anything else.
//   /files/<name>                    - serves a file from Cloudflare's own storage (R2), once a bucket is
//                                      connected as FILES in wrangler.jsonc. Until then it answers 404.

const DROPBOX_HOSTS = new Set(['www.dropbox.com', 'dropbox.com', 'dl.dropbox.com', 'dl.dropboxusercontent.com']);
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

function headersFrom(upstream, name) {
  const h = new Headers();
  for (const k of PASS) { const v = upstream.headers.get(k); if (v) h.set(k, v); }
  if (/\.pdf$/i.test(name)) h.set('content-type', 'application/pdf');
  h.set('accept-ranges', 'bytes');
  h.set('cache-control', 'public, max-age=3600');
  h.set('content-disposition', `inline; filename="${name.replace(/"/g, '')}"`);
  h.set('x-content-type-options', 'nosniff');
  return h;
}

async function dropbox(request, url) {
  let link;
  try { link = new URL(url.searchParams.get('u') || ''); } catch { return new Response('Not a link', { status: 400 }); }
  if (link.protocol !== 'https:' || !DROPBOX_HOSTS.has(link.hostname)) return new Response('Only Dropbox links', { status: 400 });
  link.searchParams.set('dl', '1');            // the file itself, not Dropbox's preview page
  link.searchParams.delete('raw');
  const name = decodeURIComponent(link.pathname.split('/').pop() || 'file.pdf');
  const range = request.headers.get('range');
  const upstream = await fetch(link.toString(), {
    headers: range ? { range } : {},
    redirect: 'follow',
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!upstream.ok && upstream.status !== 206) return new Response('Dropbox said ' + upstream.status + '. Is the link shared as "anyone with the link"?', { status: 502 });
  const type = upstream.headers.get('content-type') || '';
  if (type.includes('text/html')) return new Response('Dropbox returned a web page, not the file. Check the link is a file share link.', { status: 502 });
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: headersFrom(upstream, name) });
}

async function r2(request, env, url) {
  if (!env.FILES) return new Response('File storage is not connected yet', { status: 404 });
  const key = decodeURIComponent(url.pathname.replace(/^\/files\//, ''));
  const range = request.headers.get('range');
  const obj = await env.FILES.get(key, range ? { range: request.headers } : {});
  if (!obj) return new Response('Not found', { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('accept-ranges', 'bytes');
  h.set('cache-control', 'public, max-age=3600');
  if (/\.pdf$/i.test(key)) h.set('content-type', 'application/pdf');
  let status = 200;
  if (range && obj.range) {
    const { offset = 0, length = obj.size - offset } = obj.range;
    h.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set('content-length', String(length));
    status = 206;
  } else h.set('content-length', String(obj.size));
  return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Read only', { status: 405 });
    try {
      if (url.pathname === '/dropbox') return await dropbox(request, url);
      if (url.pathname.startsWith('/files/')) return await r2(request, env, url);
    } catch (e) {
      return new Response('Could not fetch the file: ' + e.message, { status: 502 });
    }
    return env.ASSETS.fetch(request);
  },
};
