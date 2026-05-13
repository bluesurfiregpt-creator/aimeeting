// v26.5-WS: 已合并到 /me/profile/agents. 老 URL 自动跳转.
import { redirect } from "next/navigation";
export default function Redirect_agents() {
  redirect("/me/profile/agents");
}
