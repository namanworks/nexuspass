import { Inter } from "next/font/google";
import Navbar from "../components/Navbar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "NexusPass - Regulated Secondary Ticketing",
  description: "Secure, real-time ticket booking and regulated resale marketplace.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-background text-foreground antialiased selection:bg-primary/30`}>
        <Navbar />
        <main className="min-h-screen flex flex-col">
          <div className="flex-grow">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
