import { redirect } from "next/navigation";

/** The account page moved into the signed-in area; old links keep working. */
export default function AccountRedirect() {
  redirect("/app/account");
}
