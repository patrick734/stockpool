/** Static export: `npm run build` writes a plain site to /out that any host can serve. */
const nextConfig = {
  output: "export",
  // Pages are exported as folder/index.html so links resolve on any static host.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default nextConfig;
