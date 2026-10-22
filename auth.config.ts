import type { OAuthProvider } from "./engine/auth.ts";

/** Host app policy only. The engine does not import this file. */
export const authConfig = {
  loginPath: "/login",
  callbackPath: "/auth/callback",
  emailLink: process.env.NEXT_PUBLIC_AUTH_EMAIL_LINK !== "false",
  password: process.env.NEXT_PUBLIC_AUTH_PASSWORD === "true",
  oauthProviders: [...new Set((process.env.NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS || (process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "true" ? "google" : ""))
    .split(",").map(value => value.trim()).filter(Boolean))].map(provider => ({
      id: provider as OAuthProvider,
      label: ({ google: "Google", github: "GitHub", azure: "Microsoft", keycloak: "SSO" } as Record<string, string>)[provider] || provider,
    })),
};
