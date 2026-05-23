import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nimblehack — Weekend Signal Agent",
  description: "Autonomous open-web monitoring for the Monday open",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
