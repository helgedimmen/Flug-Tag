import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flug-Tag",
  description:
    "Tagg fly som flyr over deg, fang dem for laget ditt, og erobre flyplassene — et sanntids kart-spill bygget på flydata.",
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="no">
      <body>{children}</body>
    </html>
  );
}
