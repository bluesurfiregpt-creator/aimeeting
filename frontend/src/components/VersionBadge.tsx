/**
 * Bottom-left build-version badge.
 *
 * Why: 用户经常 deploy 完打开页面,不确定看到的是不是新版本(浏览器
 * 缓存 / Service Worker / CDN 缓存常迷惑视觉).这个小徽章直接显示
 * 「这个 JS bundle 是哪个时间点构建的」,扫一眼就知道 fresh 不 fresh.
 *
 * 注入链路(static 替换,运行时无开销):
 *   deploy.sh → export BUILD_VERSION=$(TZ=Asia/Shanghai date ...)
 *   → docker compose --build-arg → frontend/Dockerfile 的 ENV
 *   → next build 时 process.env.NEXT_PUBLIC_BUILD_VERSION 被字面量替换
 *
 * 没设环境变量时(本地 npm run dev)显示 'dev'.
 */

const VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION || "dev";

export default function VersionBadge() {
  return (
    <div
      data-testid="version-badge"
      data-build-version={VERSION}
      className="fixed bottom-2 left-2 z-10 select-none rounded-md border border-ink-700 bg-ink-900/80 px-2 py-0.5 font-mono text-[10px] text-zinc-500 backdrop-blur-sm transition-colors hover:text-zinc-300"
      title="构建时间 (用来确认你看到的是不是最新部署的版本)"
    >
      v{VERSION}
    </div>
  );
}
