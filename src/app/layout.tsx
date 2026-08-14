import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const pixelFont = localFont({
  src: "./fonts/PressStart2P-Regular.ttf",
  variable: "--font-pixel",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CyberSnake / 电子蛇战争",
  description: "在限时竞速中，与会思考的 AI 蛇一决高下",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${pixelFont.variable} dark h-full`}>
      <body className="min-h-full bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
