/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  bundlePagesRouterDependencies: true,
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    // /api-docs moved to /docs/api. A server-side redirect is safe for this
    // route specifically because nothing links to a fragment on it
    // (pages/index.js's one internal link is bare /api-docs) -- unlike /faq,
    // which needs the client-side shim in pages/faq.js because a redirect
    // here would silently drop any #item-N fragment. See docs IA plan §2.6.
    return [
      {
        source: "/api-docs",
        destination: "/docs/api",
        permanent: true,
      },
      // /privacy moved into the docs section as /docs/privacy. Its section
      // anchor ids are unchanged, and browsers carry a URL fragment through a
      // redirect whose Location has none, so deep links like
      // /privacy#for-your-irb (pasted into IRB protocols) still land on the
      // right heading -- no client-side shim needed here.
      {
        source: "/privacy",
        destination: "/docs/privacy",
        permanent: true,
      },
    ];
  },
}

module.exports = nextConfig
