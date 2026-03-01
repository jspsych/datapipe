/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  bundlePagesRouterDependencies: true,
  turbopack: {
    root: __dirname,
  },
}

module.exports = nextConfig
