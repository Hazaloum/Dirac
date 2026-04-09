import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "COMIX BD Intelligence",
  description: "Pharmaceutical business development intelligence platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="light">
      <body className={`${outfit.variable} font-sans antialiased bg-surface-50 text-surface-900`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
