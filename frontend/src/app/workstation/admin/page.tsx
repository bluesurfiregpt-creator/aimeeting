import { PlaceholderPane } from "@/components/web/workstation";

// R5.C: 暗红警告 banner + 8 行租户表 (跨 workspace, system_owner 才看到)
export default function AdminPane() {
  return (
    <PlaceholderPane
      title="平台超管"
      sub="跨 workspace 配额 · 用户 · 模型 — 仅 system_owner 可见"
      icon="gear"
    />
  );
}
