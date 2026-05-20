import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { MoodAwareBackground } from "./_components/MoodAwareBackground";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lullaby — a personalized lullaby for your child",
  description:
    "Generate a 3–5 minute personalized lullaby in a voice you choose, delivered as an MP3 and a short share video.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&display=block"
        />
      </head>
      <body
        className={`${inter.variable} ${playfair.variable} font-body antialiased`}
      >
        <MoodAwareBackground />
        {children}
      </body>
    </html>
  );
}
