import type { Metadata, Viewport } from "next";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/source-serif-4/opsz-italic.css";
import "@fontsource-variable/source-sans-3/wght.css";
import "./tokens.css";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";
import { PlayerProvider } from "@/components/player/PlayerProvider";

export const metadata: Metadata = {
  title: { default: "Neolibrary", template: "%s · Neolibrary" },
  description: "A private library for independent study.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3ede1" },
    { media: "(prefers-color-scheme: dark)", color: "#1b282f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Read aloud goes on from page to page (M14 step 6a); it plays nothing until a reader opens Listen. */}
        <PlayerProvider>{children}</PlayerProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
