// v26.5-WS: 已合并到 /me/profile/audit. 老 URL 自动跳转.
import { redirect } from "next/navigation";
export default function Redirect_audit() {
  redirect("/me/profile/audit");
}
