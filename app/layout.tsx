import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ripplewise",
  description: "Hear the conversation before it becomes the headline.",
};

// Runs before paint so the saved theme never flashes the wrong palette.
const themeScript = `try{var t=localStorage.getItem("rw-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
