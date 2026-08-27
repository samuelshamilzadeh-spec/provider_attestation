// Domain wall: on the Yeled V'Yalda partner domain, only the /yvy/* surface is
// reachable. This stops a YVY staff member from stripping "/yvy/intake" off the
// URL and landing on the unrelated Stand Out Care clinician form (index.html,
// app.js, /api/submit). Any other hostname (the main domain, the vercel.app
// preview URL, etc.) is unaffected — this only gates partners.premierassist.com.
export const config = { matcher: '/:path*' };

const YVY_HOST = 'partners.premierassist.com';
// style.css and disqualify.js are shared by both the Stand Out and YVY pages;
// everything else the YVY pages need lives under /yvy/ or /api/yvy/.
const SHARED_PATHS = new Set(['/style.css', '/disqualify.js']);

export default function middleware(request) {
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  if (host !== YVY_HOST) return; // not the partner domain — no restriction

  const path = new URL(request.url).pathname;

  if (path === '/') {
    return Response.redirect(new URL('/yvy/intake', request.url), 307);
  }
  if (path.startsWith('/yvy/') || path.startsWith('/api/yvy/') || SHARED_PATHS.has(path)) {
    return; // allowed — continue to normal routing
  }
  return new Response('Not found', { status: 404 });
}
