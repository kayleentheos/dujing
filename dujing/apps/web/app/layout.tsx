import type { Metadata, Viewport } from "next";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/reader.css";
import "./styles/app.css";

export const metadata: Metadata = {
  title: "读经 · Learn Chinese through Scripture",
  description: "Read the Gospel of John in the Chinese Union Version, with word lookup, pinyin, English on demand, and your own vocabulary.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f4efe4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Noto+Serif+SC:wght@400;500;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;1,8..60,400&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
