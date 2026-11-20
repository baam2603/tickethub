import type { Metadata } from "next";
import "./fonts.css";
import { PwaRegistrar } from "@/shared/ui/pwa-registrar";
import { SessionProvider } from "@/features/identity";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mua vé hòa nhạc, thể thao và sân khấu trên tickethub!",
  description:
    "Khám phá và đặt vé chính thức các đêm nhạc, liveshow, kịch sân khấu và giải đấu thể thao trên toàn quốc.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body
        className="min-h-screen bg-white text-[#141d23] font-sans antialiased selection:bg-emerald-500/15 selection:text-emerald-700"
        suppressHydrationWarning
      >
        <PwaRegistrar />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
