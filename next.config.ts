import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 云托管镜像用精简产物：只带运行时依赖，入口是 server.js
  output: "standalone",
  // /about 运行时会读 docs/DESIGN.md，standalone 默认不会打进去
  outputFileTracingIncludes: {
    "/about": ["./docs/**/*"],
  },
};

export default nextConfig;
