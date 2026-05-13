// v26.5-WS: /admin/* 老入口 已合并到 /me/profile/* (我的工作站).
// 这里作为透传 layout,实际 redirect 由 page.tsx 干 (client redirect 保 hash/query).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
