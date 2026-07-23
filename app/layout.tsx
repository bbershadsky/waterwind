import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waterwind — Marine conditions",
  description: "A compact marine weather board for the next few hours.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
