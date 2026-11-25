export {
  APP_CHECK_VERIFIER,
  type AppCheckVerifier,
  AUTH_VERIFIER,
  AuthenticationError,
  type AuthVerifier,
  type VerifiedIdentity,
} from "./auth-verifier.js";
export {
  AllowSuspended,
  type AuthContext,
  type AuthenticatedRequest,
  CheckRevoked,
  CurrentAuth,
  CurrentUser,
  Public,
  RequireDisplayName,
  RequireRecentLogin,
} from "./decorators.js";
export { IdentityModule } from "./identity.module.js";
export {
  adminMfaRequired,
  Irreversible,
  IrreversibleGuard,
  MfaNotRequired,
  PlatformRoleGuard,
  PlatformRoleRequired,
  type StaffRequest,
} from "./platform-role.js";
export { UsersService } from "./users.service.js";
