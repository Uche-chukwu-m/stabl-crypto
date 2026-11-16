import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", display: "swap" });
const loraItalic = Lora({ subsets: ["latin"], style: "italic", variable: "--font-lora-italic", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Stabl", template: "%s | Stabl" },
  description: "Steady pay for uneven income. Stabl sets money aside in good stretches and gives it back fast in slow ones.",
  applicationName: "Stabl",
  appleWebApp: { capable: true, title: "Stabl", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F1EEE3" },
    { media: "(prefers-color-scheme: dark)", color: "#16241D" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable} ${loraItalic.variable}`}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
