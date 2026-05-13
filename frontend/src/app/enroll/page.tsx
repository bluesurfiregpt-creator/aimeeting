// v26.5-WS: 声纹库 已合并到 /me/profile/voiceprints. 老 URL 自动跳转.
import { redirect } from "next/navigation";
export default function RedirectEnroll() {
  redirect("/me/profile/voiceprints");
}
