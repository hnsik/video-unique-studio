import type { NextConfig } from "next";
const desktop = process.env.VUS_DESKTOP === "1";
const nextConfig: NextConfig = {
  ...(desktop
    ? {
        output: "export" as const,
        distDir: ".next-desktop",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
  reactStrictMode: true,
  ...(!desktop
    ? {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [
                { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
                { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
              ],
            },
          ];
        },
      }
    : {}),
};
export default nextConfig;
