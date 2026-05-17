import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Pharma BD Intelligence",
  description: "Pharmaceutical business development intelligence platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="light">
      <body className={`${inter.variable} font-sans antialiased bg-surface-50 text-surface-900`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
