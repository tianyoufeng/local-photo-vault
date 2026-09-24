import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LocalPhotoVault",
  description: "本地照片管理应用 — 原图无损 · 局域网访问",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body>{children}</body>
    </html>
  );
}
