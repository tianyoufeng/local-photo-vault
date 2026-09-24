/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 产物由 Tauri 以 sidecar 方式拉起，
  // 手机浏览器通过 http://<局域网IP>:8787 访问同一服务
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
