import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Q&A Generator",
  description: "Generate question/answer tables for EvoIndexer retrievers from documents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
