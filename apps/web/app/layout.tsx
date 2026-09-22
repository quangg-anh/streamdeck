import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "StreamFX", description: "Interactive effects for live streams" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Instrument+Serif:ital@1&display=swap" rel="stylesheet" />
    </head>
    <body style={{ background: "#000", color: "#fff" }}>{children}</body>
  </html>;
}
