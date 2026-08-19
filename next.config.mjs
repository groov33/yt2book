/** @type {import('next').NextConfig} */
const nextConfig = {
  // puppeteer-core and @sparticuz/chromium ship native binaries / large
  // binary blobs that must NOT be processed by Next's JS bundler -- they
  // need to be required at runtime as-is inside the serverless function.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "youtubei.js"],
};

export default nextConfig;
