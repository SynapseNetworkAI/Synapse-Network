"use client";

import { AuthProtocolShell } from "@/components/auth-protocol-shell";
import { LoginForm } from "@/features/auth/login-form";
import {
  buildLoginRailDescription,
  buildLoginRailFacts,
} from "@/features/auth/login-presenters";
import { useLoginController } from "@/features/auth/use-login-controller";

export function LoginWorkspace() {
  const controller = useLoginController();

  return (
    <AuthProtocolShell
      eyebrow="System Authorization"
      title="System Authorization"
      versionLabel="Gateway Control Plane v4.0.8"
      statusLabel="NODE_ACTIVE :: ENCRYPTED_LINK"
      railTitle="管理员登录控制台。"
      railDescription={buildLoginRailDescription(controller.security)}
      railFacts={buildLoginRailFacts(controller.security)}
      layout="centered"
      panelMaxW="460px"
    >
      <LoginForm controller={controller} />
    </AuthProtocolShell>
  );
}
