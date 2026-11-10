// ==========================================
// Cloudflare Pages Middleware
// Server-side route protection & access control
// Runs BEFORE any static asset is served
// ==========================================

// Static asset extensions that should always be served directly
const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|json|webp|avif)$/i;

// Paths that are publicly accessible without authentication
const PUBLIC_PATHS = [
    '/login',
    '/login.html',
];

// Paths that should be served as static assets (directories)
const STATIC_DIRS = [
    '/css/',
    '/js/',
    '/images/',
    '/src/',
];

// Paths that are handled by Cloudflare Pages Functions (API routes)
// These have their own auth checks in the function handlers
const API_FUNCTION_PATHS = [
    '/api/auth',
    '/api/cfdb',
    '/api/proxy',
];

export async function onRequest(context) {
    const { request, next } = context;
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. Always allow static asset files (by extension)
    if (STATIC_EXTENSIONS.test(pathname)) {
        return next();
    }

    // 2. Always allow public paths (login page)
    if (PUBLIC_PATHS.some(p => pathname === p || pathname === p + '/')) {
        return next();
    }

    // 3. Always allow static directories (css, js, images, src)
    if (STATIC_DIRS.some(dir => pathname.startsWith(dir))) {
        return next();
    }

    // 4. Allow legitimate API function routes (they have their own auth)
    if (API_FUNCTION_PATHS.some(p => pathname === p || pathname === p + '/')) {
        return next();
    }

    // 5. BLOCK: Bare /api path or any unknown /api/* sub-paths
    //    These are NOT valid function routes and should NOT fall through
    //    to serve index.html as an SPA fallback
    if (pathname === '/api' || pathname === '/api/') {
        return new Response(
            JSON.stringify({ error: 'Bad Gateway. Invalid API endpoint.' }),
            {
                status: 502,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }

    // Block unknown /api/* sub-paths that don't match any function
    if (pathname.startsWith('/api/')) {
        const knownEndpoint = API_FUNCTION_PATHS.some(p => pathname === p || pathname === p + '/');
        if (!knownEndpoint) {
            return new Response(
                JSON.stringify({ error: 'Not Found. Invalid API endpoint.' }),
                {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }
    }

    // 6. For all other page routes (/, /index, /form, etc.):
    //    These are protected pages. Since auth tokens are in sessionStorage
    //    (client-side), we can't verify them server-side here.
    //    The auth.js script in <head> handles client-side redirection.
    //    But we add a server-side fallback: if the request has no Referer
    //    and no session indicators, we could redirect — however, the most
    //    robust approach is to let auth.js handle it for legitimate pages
    //    and just ensure no junk routes leak through.

    // Allow known app pages to proceed (auth.js will guard them client-side)
    const KNOWN_APP_PAGES = ['/', '/index', '/index.html', '/form', '/form.html'];
    if (KNOWN_APP_PAGES.some(p => pathname === p || pathname === p + '/')) {
        return next();
    }

    // 7. Any other unknown path: redirect to login
    return Response.redirect(new URL('/login', url.origin).toString(), 302);
}

