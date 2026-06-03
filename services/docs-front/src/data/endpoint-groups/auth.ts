import type { RouteGroup } from "../endpoint-source";

const AUTH_CHALLENGE_EXAMPLE =
  "synapse-network.ai wants you to sign in with your Ethereum account:\n" +
  "0x1234567890abcdef1234567890abcdef12345678\n\n" +
  "Sign in to Synapse Network. This does not authorize a transaction or move funds.\n\n" +
  "URI: https://synapse-network.ai\n" +
  "Version: 1\n" +
  "Chain ID: 42161\n" +
  "Nonce: abc123\n" +
  "Issued At: 2026-05-30T13:25:02Z\n" +
  "Expiration Time: 2026-05-30T13:35:02Z";

const PROFILE_CHALLENGE_EXAMPLE =
  "Update Synapse account profile\n" +
  "Wallet: 0x1234567890abcdef1234567890abcdef12345678\n" +
  "Payload Hash: 3f8b2f...\n" +
  "Nonce: def456\n" +
  "Timestamp: 1711234600";

export const authRouteGroup: RouteGroup = {
  id: "api-auth",
  title: "Auth",
  description:
    "Wallet challenge, signature verification, and session lifecycle.",
  routes: [
    {
      id: "get-challenge",
      method: "GET",
      path: "/api/v1/auth/challenge",
      summary: "Get EIP-191 sign challenge",
      description:
        "Returns a time-limited SIWE-style EIP-191 message for the given wallet address. Sign the exact challenge string and submit it to /verify.",
      auth: "none",
      params: [
        {
          name: "address",
          in: "query",
          required: true,
          type: "string",
          description: "Owner wallet address (0x...)",
          example: "0x1234567890abcdef1234567890abcdef12345678",
        },
        {
          name: "chainId",
          in: "query",
          required: false,
          type: "integer",
          description:
            "Optional chain ID to bind into the SIWE-style message. Production Arbitrum One uses 42161.",
          example: "42161",
        },
      ],
      responseExample: {
        challenge: AUTH_CHALLENGE_EXAMPLE,
        domain: "synapse-network.ai",
      },
      agentMeta: {
        role: "owner",
        phase: "auth",
        note: "Step 1 of owner auth. Call with the owner wallet address to receive a time-limited SIWE-style message. Sign the exact challenge with ECDSA (EIP-191) and pass it to POST /auth/verify.",
        outputs: [
          {
            key: "challenge",
            desc: "Full message string to sign with the owner private key",
          },
          {
            key: "domain",
            desc: "Domain bound into the challenge message",
          },
        ],
        next: "Sign the challenge and submit to POST /api/v1/auth/verify",
      },
      errors: [
        {
          status: 400,
          code: "MISSING_ADDRESS",
          message: "address query param is required",
        },
        {
          status: 422,
          code: "INVALID_ADDRESS",
          message: "Not a valid 0x wallet address",
        },
      ],
    },
    {
      id: "post-verify",
      method: "POST",
      path: "/api/v1/auth/verify",
      summary: "Verify signature, return JWT",
      description:
        "Submit the EIP-191 signed challenge. Gateway verifies the signature and returns a 24-hour JWT.",
      auth: "none",
      bodyExample: {
        wallet_address: "0x1234567890abcdef1234567890abcdef12345678",
        message: AUTH_CHALLENGE_EXAMPLE,
        signature: "0x...",
      },
      responseExample: {
        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        token_type: "bearer",
        expires_in: 86400,
      },
      agentMeta: {
        role: "owner",
        phase: "auth",
        note: "Step 2 of owner auth. Submit wallet_address, the exact signed challenge message, and the signature. On success the gateway returns a 24-hour JWT. Store access_token — all owner-side calls require it as the Bearer token.",
        requires: "GET /auth/challenge must be called first",
        outputs: [
          {
            key: "access_token",
            desc: "JWT — Authorization: Bearer <access_token> on all JWT-required endpoints",
          },
        ],
        next: "Store the JWT. Call GET /balance, POST /agent/credentials, or GET /services",
      },
      errors: [
        {
          status: 401,
          code: "VERIFICATION_FAILED",
          message: "Signature does not match wallet address",
        },
        {
          status: 422,
          code: "CHALLENGE_EXPIRED",
          message: "Challenge expired — request a new one",
        },
      ],
    },
    {
      id: "get-me",
      method: "GET",
      path: "/api/v1/auth/me",
      summary: "Get current owner profile",
      description:
        "Returns the wallet-linked account profile: display name, email, and notification preferences.",
      auth: "jwt",
      responseExample: {
        wallet_address: "0x...",
        username: "owner-alias",
        email: "owner@example.com",
      },
      agentMeta: {
        role: "owner",
        phase: "auth",
        note: "Confirm authenticated identity. Use after auth to verify the JWT is valid and which wallet it is bound to.",
        requires: "Valid JWT from POST /auth/verify",
      },
      errors: [
        {
          status: 401,
          code: "UNAUTHORIZED",
          message: "Missing or expired JWT",
        },
      ],
    },
    {
      id: "post-profile-challenge",
      method: "POST",
      path: "/api/v1/auth/me/profile/challenge",
      summary: "Get profile-update challenge",
      description:
        "Generates a one-time signing challenge for updating the account profile (name, email, preferences).",
      auth: "jwt",
      responseExample: {
        challenge: PROFILE_CHALLENGE_EXAMPLE,
        expiresInSec: 600,
      },
      agentMeta: {
        role: "owner",
        phase: "manage",
        note: "Step 1 of a profile update. Generates a challenge that proves the owner wallet authorises the change. Required before PUT /auth/me/profile.",
        outputs: [
          {
            key: "challenge",
            desc: "Full profile-update message to sign before submitting the update",
          },
        ],
        next: "Sign the challenge and submit via PUT /api/v1/auth/me/profile",
      },
    },
    {
      id: "put-me-profile",
      method: "PUT",
      path: "/api/v1/auth/me/profile",
      summary: "Update account profile",
      description:
        "Submit wallet-signed proof to update account name, notification preferences, and email binding intent. New or changed email addresses are staged as pendingEmail until a verification code is confirmed. Submitting the current verified email cancels a pending change; submitting null removes the verified email.",
      auth: "jwt",
      bodyExample: {
        signature: "0x...",
        message: PROFILE_CHALLENGE_EXAMPLE,
        username: "new-alias",
        email: "new@example.com",
        notifications: true,
      },
      responseExample: {
        wallet_address: "0x...",
        username: "new-alias",
        email: "old@example.com",
        pendingEmail: "new@example.com",
        emailVerificationStatus: "pending",
        emailVerificationSendsRemaining: 4,
      },
      agentMeta: {
        role: "owner",
        phase: "manage",
        note: "Step 2 of profile update. Submits the signed challenge alongside new profile fields. Wallet signature prevents unauthorised profile changes.",
        requires:
          "Challenge from POST /auth/me/profile/challenge, signed by owner wallet",
      },
    },
    {
      id: "post-email-verify-code",
      method: "POST",
      path: "/api/v1/auth/email/verify-code",
      summary: "Verify pending email code",
      description:
        "Confirms the 6-digit code sent to a pending email address. Only after this succeeds does Gateway bind the email to the wallet account.",
      auth: "jwt",
      bodyExample: {
        email: "new@example.com",
        code: "123456",
      },
      responseExample: {
        profile: {
          walletAddress: "0x...",
          email: "new@example.com",
          emailVerified: true,
          pendingEmail: null,
        },
      },
      agentMeta: {
        role: "owner",
        phase: "manage",
        note: "Step 3 of email binding. Submit the code from the verification email. Codes expire after 10 minutes and lock after 5 bad attempts.",
        requires: "PUT /auth/me/profile must have staged a pendingEmail first",
      },
      errors: [
        {
          status: 400,
          code: "EMAIL_VERIFICATION_INVALID_CODE",
          message: "The code is incorrect or malformed",
        },
        {
          status: 400,
          code: "EMAIL_VERIFICATION_EXPIRED",
          message: "The code expired; request a new one",
        },
      ],
    },
    {
      id: "post-email-resend-code",
      method: "POST",
      path: "/api/v1/auth/email/resend-code",
      summary: "Resend pending email code",
      description:
        "Generates a fresh 6-digit verification code for the current pending email. Each wallet can send at most 5 verification emails per UTC day.",
      auth: "jwt",
      bodyExample: {
        email: "new@example.com",
      },
      responseExample: {
        profile: {
          walletAddress: "0x...",
          pendingEmail: "new@example.com",
          emailVerificationStatus: "pending",
          emailVerificationSendsRemaining: 3,
        },
      },
      agentMeta: {
        role: "owner",
        phase: "manage",
        note: "Use when a user did not receive the current code. Resending invalidates the old code.",
        requires: "A matching pendingEmail on the authenticated wallet",
      },
      errors: [
        {
          status: 429,
          code: "EMAIL_VERIFICATION_DAILY_LIMIT_REACHED",
          message: "Daily email verification limit reached",
        },
      ],
    },
    {
      id: "post-logout",
      method: "POST",
      path: "/api/v1/auth/logout",
      summary: "Revoke current JWT",
      description: "Invalidates the current session token server-side.",
      auth: "jwt",
      responseExample: { message: "Logged out" },
      agentMeta: {
        role: "owner",
        phase: "auth",
        note: "Invalidate the JWT when the session ends. After this call the token cannot be used for any further requests.",
        requires: "Valid JWT",
      },
    },
  ],
};
