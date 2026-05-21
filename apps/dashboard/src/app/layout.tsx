import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/ui/Sidebar";

export const metadata: Metadata = {
  title: "AgentOps Radar",
  description: "AI Agent Observability and Evaluation Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 ml-56 p-6">{children}</main>
      </body>
    </html>
  );
}
