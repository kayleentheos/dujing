import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@dujing/core", "@dujing/data"],
  reactStrictMode: true,
};
export default config;
