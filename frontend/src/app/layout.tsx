import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import AppLogo from "@/components/AppLogo";
import AuthHeader from "@/components/AuthHeader";
import ChromeGate from "@/components/ChromeGate";
import ManualLink from "@/components/ManualLink";
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
  // suppressHydrationWarning: /m 子树的 MobileShell 通过 inline <script> 在
  // hydration 之前 给 <html> 加 .mobile-viewport-locked class (P20.3 锁 iOS
  // 弹性滚动), 这是 故意 的 server/client 不一致 — 跟 next-themes / theme-flash
  // 防护 同一模式. React 19 + Next 15 会把它 视为 hydration error (整树重渲),
  // 加 suppressHydrationWarning 让 React 仅 跳过 <html> 自身的 属性 校验.
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ChromeGate>
          <AppLogo />
          <ManualLink />
          <AuthHeader />
        </ChromeGate>
        {children}
        <Toaster />
        <ChromeGate>
          <VersionBadge />
        </ChromeGate>
        {/* v25-bug-fix #1: 自动注入 Cowork suite,登录后 F12 即可 runCoworkSuite() */}
        <Script
          src="/cowork_suite.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
