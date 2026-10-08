import type { Metadata, Viewport } from "next";
import "@fontsource-variable/familjen-grotesk";
import { BRAND } from "@/lib/brand";
import { Providers } from "./providers";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
const TITLE = `${BRAND.name}: earn the trading fees of Robinhood Stock Tokens`;
const DESCRIPTION =
  "Deposit USDG into a stock’s Pool and earn the fees traders pay to swap it on Uniswap v4, in a range kept around Chainlink’s price. One deposit across every Pool with the Basket, or borrow against your Pool shares.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  icons: { icon: "/icon.svg" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/", siteName: BRAND.name, images: [{ url: "/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8eeea" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1f1d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
