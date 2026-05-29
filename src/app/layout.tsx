import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "motion sports backend",
  description: "motion sports KI-Berater — headless backend",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
