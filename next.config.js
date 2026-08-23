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
    ];
  },
}

module.exports = nextConfig
