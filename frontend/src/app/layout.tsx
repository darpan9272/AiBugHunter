import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/app-shell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Bug Hunt — Autonomous Security Console",
  description: "Autonomous, multi-agent bug bounty reconnaissance and triage. Developed by Darpan Raiyani",
  other: {
    developer: "Darpan Raiyani",
    "developer:title": "Full-stack Developer & Cybersecurity Specialist",
    "developer:website": "https://darpanraiyani.co.uk",
    "developer:email": "kashtbhanjaninfotech@gmail.com",
    "developer:phone": "+44 7887 138594",
    "developer:linkedin": "linkedin.com/in/darpan0699",
    "developer:github": "github.com/darpan9272"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1220",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
