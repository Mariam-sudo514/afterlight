/* eslint-disable @next/next/no-page-custom-font -- This App Router root layout loads the existing journal fonts for every page. */
import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./editorial.css";
import "./blog.css";
export const metadata: Metadata = {
  title: {
    default: "AFTERLIGHT — True Crime Journal",
    template: "%s | AFTERLIGHT",
  },
  description:
    "Crimes. People. The search for truth. / Преступления. Люди. Поиск правды.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const lang = (await headers()).get("x-afterlight-locale");
  return (
    <html lang={lang === "en" ? "en" : "ru"} className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;550;600;650;700&family=Libre+Caslon+Display&family=Prata&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
