import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import AppFrame from "@/components/AppFrame";

export const metadata: Metadata = {
  title: "Curie",
  description: "Visit logging for COMIX medical reps",
  appleWebApp: { capable: true, title: "Curie", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0c5c4c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppFrame>{children}</AppFrame>
        </AuthProvider>
      </body>
    </html>
  );
}
