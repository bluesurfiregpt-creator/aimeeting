import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import AuthHeader from "@/components/AuthHeader";
import Toaster from "@/components/Toaster";
import VersionBadge from "@/components/VersionBadge";

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
        <VersionBadge />
        {/* v25-bug-fix #1: 自动注入 Cowork suite,登录后 F12 即可 runCoworkSuite() */}
        <Script
          src="/cowork_suite.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
