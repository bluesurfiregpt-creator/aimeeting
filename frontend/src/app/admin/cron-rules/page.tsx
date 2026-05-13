// v26.5-WS: 已合并到 /me/profile/cron. 老 URL 自动跳转.
import { redirect } from "next/navigation";
export default function Redirect_cron_rules() {
  redirect("/me/profile/cron");
}
