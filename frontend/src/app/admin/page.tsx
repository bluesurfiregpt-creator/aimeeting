// v26.5-WS: /admin/* 合并到 /me/profile/* (我的工作站).
import { redirect } from "next/navigation";
export default function AdminIndex() {
  redirect("/me/profile/agents");
}
