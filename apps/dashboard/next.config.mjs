/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-host Docker image (issue #266): standalone output bundles only the
  // traced production dependencies instead of full node_modules.
  output: "standalone"
};

export default nextConfig;
