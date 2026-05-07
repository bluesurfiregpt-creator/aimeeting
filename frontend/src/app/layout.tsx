import "./globals.css";
import type { Metadata } from "next";
import AuthHeader from "@/components/AuthHeader";
import Toaster from "@/components/Toaster";

export const metadata: Metadata = {
  title: "Aimeeting · AI 会议",
  description: "组织决策智能系统",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="font-sans antialiased">
        <AuthHeader />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
