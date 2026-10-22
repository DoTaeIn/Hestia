export { createHestiaEngine, type HestiaEngine, type SearchRecord, type WorkspaceRecord, type MemberRecord, type NotificationRecord } from "./client.ts";
export { EngineError, type EngineErrorCode, type EngineResult } from "./result.ts";
export * from "./domain.ts";
export * from "./document.ts";
export { selectWorkspace, type WorkspaceSelection } from "./workspaces.ts";
export { createSupabaseAuthAdapter, type Identity, type IdentityProvider, type AuthAdapter, type OAuthProvider } from "./auth.ts";
export type { ProfileRecord, ProfileInput } from "./profiles.ts";

export type { CustomRole, WorkspaceMember, RoleInput, SecurityEvent } from "./access.ts";

export { createSupabaseSecurityAdapter, type SecurityAdapter, type SecurityFactor, type AssuranceStatus, type TotpEnrollment } from "./security.ts";
