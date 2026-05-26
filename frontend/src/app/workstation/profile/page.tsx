import { PlaceholderPane } from "@/components/web/workstation";

// R5.C: 用户卡 (姓名 / email / role / workspace) + 声纹库
export default function ProfilePane() {
  return (
    <PlaceholderPane
      title="身份信息"
      sub="你的工作空间、所在部门与领域 — AI 在会议中会基于这些上下文回答"
      icon="users"
    />
  );
}
