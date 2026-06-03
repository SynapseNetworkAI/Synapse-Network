import { Suspense } from "react";
import OAuthAuthorizeContent from "@/components/oauth/OAuthAuthorizeContent";

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <OAuthAuthorizeContent />
    </Suspense>
  );
}
