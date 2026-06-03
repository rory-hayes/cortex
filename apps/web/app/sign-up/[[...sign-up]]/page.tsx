import { redirect } from "next/navigation";

import { AuthPageFallback, hasAuth0RuntimeConfig } from "../../auth-runtime";

export default function SignUpPage() {
  if (hasAuth0RuntimeConfig()) {
    redirect("/auth/login?screen_hint=signup");
  }

  return <AuthPageFallback mode="sign-up" />;
}
