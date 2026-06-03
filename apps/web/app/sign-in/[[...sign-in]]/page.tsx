import { redirect } from "next/navigation";

import { AuthPageFallback, hasAuth0RuntimeConfig } from "../../auth-runtime";

export default function SignInPage() {
  if (hasAuth0RuntimeConfig()) {
    redirect("/auth/login");
  }

  return <AuthPageFallback mode="sign-in" />;
}
