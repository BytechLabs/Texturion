import { redirect } from "next/navigation";

/** `/join` → signup alias (DESIGN.md G3 URL map). */
export default function JoinPage() {
  redirect("/signup");
}
