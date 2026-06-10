import { redirect } from "next/navigation";

export default function Page() {
  // Sign-up and sign-in share one passwordless form now, so /register just
  // sends people to /login (signInWithOtp creates the account on first code).
  redirect("/login");
}
