import {
  acceptInvitationRequestSchema,
  type AddDocumentRequest,
  addDocumentRequestSchema,
  appealRequestSchema,
  type BadgeDto,
  badgeSchema,
  type BadgeType,
  type DocumentUpload,
  documentUploadSchema,
  type VerificationCaseDto,
  verificationCaseSchema,
  type VerificationErrorReason,
  verificationErrorReasonSchema,
  type VerificationLabels,
  verificationLabelsSchema,
  type AuthErrorReason,
  authErrorReasonSchema,
  type BranchDto,
  branchRequestSchema,
  branchSchema,
  createdInvitationSchema,
  type CreatedInvitation,
  type CreateInvitationRequest,
  createInvitationRequestSchema,
  type CreateOrganizationRequest,
  entitlementErrorReasonSchema,
  type EntitlementErrorReason,
  type EntitlementsResponse,
  entitlementsResponseSchema,
  createOrganizationRequestSchema,
  type HealthResponse,
  type InvitationDto,
  invitationSchema,
  type MemberDto,
  memberSchema,
  type MyOrganization,
  myOrganizationSchema,
  type OrganizationErrorReason,
  organizationErrorReasonSchema,
  type Role,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
  healthResponseSchema,
  type MeResponse,
  meResponseSchema,
  type UpdateMeRequest,
  updateMeRequestSchema,
} from "@fleettrust/types";
import { z } from "zod";

export interface ApiClientOptions {
  /** Absolute API origin, e.g. `https://api.example.com`. A trailing slash is ignored. */
  baseUrl: string;
  /** Injected for tests and non-standard runtimes. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Abort requests that take longer than this. Defaults to 15 seconds. */
  timeoutMs?: number;
  /**
   * Current Firebase ID token, or null when signed out. Called before every authenticated
   * request; pass `() => auth.currentUser?.getIdToken() ?? null` (Firebase refreshes it).
   */
  getIdToken?: () => Promise<string | null> | string | null;
  /** Firebase App Check token for the X-Firebase-AppCheck header (required in production). */
  getAppCheckToken?: () => Promise<string | null> | string | null;
}

export type ApiErrorReason =
  AuthErrorReason | OrganizationErrorReason | EntitlementErrorReason | VerificationErrorReason;

/** Raised for non-2xx responses, network failures and responses that don't match the contract. */
export class ApiError extends Error {
  readonly status: number | undefined;
  readonly code: "http_error" | "network_error" | "invalid_response";
  /**
   * Machine-readable reason, e.g. `expired_token`, `profile_incomplete` (auth) or
   * `last_owner`, `invitation_expired` (organizations).
   */
  readonly reason: ApiErrorReason | undefined;
  /** Seconds to wait before retrying (429 responses). */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    code: ApiError["code"],
    status?: number,
    options?: { cause?: unknown; reason?: ApiErrorReason; retryAfterSeconds?: number },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.reason = options?.reason;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }

  /** True when signing in again (or refreshing the token) may fix the error. */
  get requiresSignIn(): boolean {
    return this.status === 401;
  }
}

export interface ApiClient {
  /** Liveness check (no sign-in needed). */
  health(): Promise<HealthResponse>;
  /** The signed-in user's profile; the first call after sign-in creates the account. */
  me(): Promise<MeResponse>;
  /** Update the profile. `displayName: null` clears it. Validated client-side first. */
  updateMe(update: UpdateMeRequest): Promise<MeResponse>;
  /** "Sign out everywhere": revokes every session of the signed-in user. */
  revokeAllSessions(): Promise<void>;

  /** Organizations the signed-in user belongs to, with their role (the org switcher). */
  myOrganizations(): Promise<MyOrganization[]>;
  /** Creates an organization with the caller as owner. */
  createOrganization(request: CreateOrganizationRequest): Promise<MyOrganization>;
  getOrganization(orgId: string): Promise<MyOrganization>;
  renameOrganization(orgId: string, name: string): Promise<MyOrganization>;
  listBranches(orgId: string): Promise<BranchDto[]>;
  createBranch(orgId: string, name: string): Promise<BranchDto>;
  renameBranch(orgId: string, branchId: string, name: string): Promise<BranchDto>;
  deleteBranch(orgId: string, branchId: string): Promise<void>;
  listMembers(orgId: string): Promise<MemberDto[]>;
  updateMember(
    orgId: string,
    membershipId: string,
    change: { role?: Role; branchId?: string | null },
  ): Promise<MemberDto>;
  /** Removes a member; pass your own membership ID to leave the organization. */
  removeMember(orgId: string, membershipId: string): Promise<void>;
  listInvitations(orgId: string): Promise<InvitationDto[]>;
  /** The returned token is shown once; share `acceptPath` with the invitee. */
  createInvitation(orgId: string, request: CreateInvitationRequest): Promise<CreatedInvitation>;
  revokeInvitation(orgId: string, invitationId: string): Promise<void>;
  /** Accept as the signed-in user (their verified email must match the invitation). */
  acceptInvitation(token: string): Promise<MyOrganization>;

  /** The signed-in user's plan and usage meters. */
  myEntitlements(): Promise<EntitlementsResponse>;
  /** An organization's plan, limits and usage meters (any member). */
  organizationEntitlements(orgId: string): Promise<EntitlementsResponse>;

  /**
   * Verification: open a case (driver: personal; business/location: pass orgId), add each
   * document (then PUT the bytes to `upload.url` with `upload.headers`), complete it, submit.
   */
  openVerificationCase(badgeType: BadgeType, orgId?: string): Promise<VerificationCaseDto>;
  verificationCases(orgId?: string): Promise<VerificationCaseDto[]>;
  verificationCase(caseId: string): Promise<VerificationCaseDto>;
  addVerificationDocument(caseId: string, document: AddDocumentRequest): Promise<DocumentUpload>;
  /** Call after the PUT succeeds: the file is checked, scanned and encrypted. */
  completeVerificationDocument(caseId: string, documentId: string): Promise<VerificationCaseDto>;
  submitVerificationCase(caseId: string): Promise<VerificationCaseDto>;
  withdrawVerificationCase(caseId: string): Promise<void>;
  appealVerificationCase(caseId: string, statement: string): Promise<VerificationCaseDto>;
  appealBadge(badgeId: string, statement: string): Promise<BadgeDto>;
  badges(orgId?: string): Promise<BadgeDto[]>;
  /** Public trust labels: "verified" or "unverified" per badge type. */
  verificationLabels(subject: {
    type: "user" | "organization";
    id: string;
  }): Promise<VerificationLabels>;
}

const casePath = (caseId: string, ...rest: string[]) =>
  ["/v1/verification/cases", encodeURIComponent(caseId), ...rest.map(encodeURIComponent)].join("/");

const orgPath = (orgId: string, ...rest: string[]) =>
  ["/v1/orgs", orgId, ...rest]
    .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
    .join("/");

const errorBodySchema = z
  .object({
    reason: z
      .union([
        authErrorReasonSchema,
        organizationErrorReasonSchema,
        entitlementErrorReasonSchema,
        verificationErrorReasonSchema,
      ])
      .optional(),
    message: z.unknown().optional(),
  })
  .loose();

interface RequestSpec<TSchema extends z.ZodType | undefined> {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  schema: TSchema;
  body?: unknown;
  authenticated: boolean;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function headersFor(
    authenticated: boolean,
    hasBody: boolean,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (hasBody) headers["Content-Type"] = "application/json";
    if (authenticated) {
      const token = await options.getIdToken?.();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const appCheck = await options.getAppCheckToken?.();
      if (appCheck) headers["X-Firebase-AppCheck"] = appCheck;
    }
    return headers;
  }

  async function send<TSchema extends z.ZodType | undefined>(
    spec: RequestSpec<TSchema>,
  ): Promise<TSchema extends z.ZodType ? z.output<TSchema> : undefined> {
    // AbortController + setTimeout instead of AbortSignal.timeout(), which not every
    // React Native JS engine provides.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    let body: unknown;
    try {
      response = await fetchImpl(`${baseUrl}${spec.path}`, {
        method: spec.method,
        headers: await headersFor(spec.authenticated, spec.body !== undefined),
        ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorBody = errorBodySchema.safeParse(await response.json().catch(() => ({})));
        const retryAfter = Number(response.headers.get("Retry-After"));
        throw new ApiError(
          `Request to ${spec.path} failed with status ${String(response.status)}`,
          "http_error",
          response.status,
          {
            ...(errorBody.success && errorBody.data.reason
              ? { reason: errorBody.data.reason }
              : {}),
            ...(Number.isFinite(retryAfter) && retryAfter > 0
              ? { retryAfterSeconds: retryAfter }
              : {}),
          },
        );
      }
      if (response.status === 204 || spec.schema === undefined) {
        return undefined as TSchema extends z.ZodType ? z.output<TSchema> : undefined;
      }
      const { status } = response;
      body = await response.json().catch((cause: unknown) => {
        throw new ApiError(
          `Response from ${spec.path} was not valid JSON`,
          "invalid_response",
          status,
          {
            cause,
          },
        );
      });
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(`Request to ${spec.path} failed`, "network_error", undefined, { cause });
    } finally {
      clearTimeout(timer);
    }

    const parsed = spec.schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        `Response from ${spec.path} did not match the expected shape`,
        "invalid_response",
        response.status,
        { cause: parsed.error },
      );
    }
    return parsed.data as TSchema extends z.ZodType ? z.output<TSchema> : undefined;
  }

  return {
    health: () =>
      send({ method: "GET", path: "/health", schema: healthResponseSchema, authenticated: false }),
    me: () =>
      send({ method: "GET", path: "/v1/me", schema: meResponseSchema, authenticated: true }),
    // async so invalid input rejects (like every other method) instead of throwing synchronously.
    updateMe: async (update) =>
      send({
        method: "PATCH",
        path: "/v1/me",
        schema: meResponseSchema,
        body: updateMeRequestSchema.parse(update),
        authenticated: true,
      }),
    revokeAllSessions: () =>
      send({
        method: "POST",
        path: "/v1/me/sessions/revoke",
        schema: undefined,
        authenticated: true,
      }),

    myOrganizations: () =>
      send({
        method: "GET",
        path: "/v1/orgs",
        schema: z.array(myOrganizationSchema),
        authenticated: true,
      }),
    createOrganization: async (request) =>
      send({
        method: "POST",
        path: "/v1/orgs",
        schema: myOrganizationSchema,
        body: createOrganizationRequestSchema.parse(request),
        authenticated: true,
      }),
    getOrganization: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId),
        schema: myOrganizationSchema,
        authenticated: true,
      }),
    renameOrganization: async (orgId, name) =>
      send({
        method: "PATCH",
        path: orgPath(orgId),
        schema: myOrganizationSchema,
        body: updateOrganizationRequestSchema.parse({ name }),
        authenticated: true,
      }),
    listBranches: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "branches"),
        schema: z.array(branchSchema),
        authenticated: true,
      }),
    createBranch: async (orgId, name) =>
      send({
        method: "POST",
        path: orgPath(orgId, "branches"),
        schema: branchSchema,
        body: branchRequestSchema.parse({ name }),
        authenticated: true,
      }),
    renameBranch: async (orgId, branchId, name) =>
      send({
        method: "PATCH",
        path: orgPath(orgId, "branches", branchId),
        schema: branchSchema,
        body: branchRequestSchema.parse({ name }),
        authenticated: true,
      }),
    deleteBranch: (orgId, branchId) =>
      send({
        method: "DELETE",
        path: orgPath(orgId, "branches", branchId),
        schema: undefined,
        authenticated: true,
      }),
    listMembers: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "members"),
        schema: z.array(memberSchema),
        authenticated: true,
      }),
    updateMember: async (orgId, membershipId, change) =>
      send({
        method: "PATCH",
        path: orgPath(orgId, "members", membershipId),
        schema: memberSchema,
        body: updateMemberRequestSchema.parse(change),
        authenticated: true,
      }),
    removeMember: (orgId, membershipId) =>
      send({
        method: "DELETE",
        path: orgPath(orgId, "members", membershipId),
        schema: undefined,
        authenticated: true,
      }),
    listInvitations: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "invitations"),
        schema: z.array(invitationSchema),
        authenticated: true,
      }),
    createInvitation: async (orgId, request) =>
      send({
        method: "POST",
        path: orgPath(orgId, "invitations"),
        schema: createdInvitationSchema,
        body: createInvitationRequestSchema.parse(request),
        authenticated: true,
      }),
    revokeInvitation: (orgId, invitationId) =>
      send({
        method: "DELETE",
        path: orgPath(orgId, "invitations", invitationId),
        schema: undefined,
        authenticated: true,
      }),
    myEntitlements: () =>
      send({
        method: "GET",
        path: "/v1/me/entitlements",
        schema: entitlementsResponseSchema,
        authenticated: true,
      }),
    organizationEntitlements: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "entitlements"),
        schema: entitlementsResponseSchema,
        authenticated: true,
      }),
    openVerificationCase: (badgeType, orgId) =>
      send({
        method: "POST",
        path:
          orgId === undefined
            ? "/v1/me/verification/cases"
            : orgPath(orgId, "verification", "cases"),
        schema: verificationCaseSchema,
        body: { badgeType },
        authenticated: true,
      }),
    verificationCases: (orgId) =>
      send({
        method: "GET",
        path:
          orgId === undefined
            ? "/v1/me/verification/cases"
            : orgPath(orgId, "verification", "cases"),
        schema: z.array(verificationCaseSchema),
        authenticated: true,
      }),
    verificationCase: (caseId) =>
      send({
        method: "GET",
        path: casePath(caseId),
        schema: verificationCaseSchema,
        authenticated: true,
      }),
    addVerificationDocument: async (caseId, document) =>
      send({
        method: "POST",
        path: casePath(caseId, "documents"),
        schema: documentUploadSchema,
        body: addDocumentRequestSchema.parse(document),
        authenticated: true,
      }),
    completeVerificationDocument: (caseId, documentId) =>
      send({
        method: "POST",
        path: casePath(caseId, "documents", documentId, "complete"),
        schema: verificationCaseSchema,
        authenticated: true,
      }),
    submitVerificationCase: (caseId) =>
      send({
        method: "POST",
        path: casePath(caseId, "submit"),
        schema: verificationCaseSchema,
        authenticated: true,
      }),
    withdrawVerificationCase: (caseId) =>
      send({
        method: "POST",
        path: casePath(caseId, "withdraw"),
        schema: undefined,
        authenticated: true,
      }),
    appealVerificationCase: async (caseId, statement) =>
      send({
        method: "POST",
        path: casePath(caseId, "appeal"),
        schema: verificationCaseSchema,
        body: appealRequestSchema.parse({ statement }),
        authenticated: true,
      }),
    appealBadge: async (badgeId, statement) =>
      send({
        method: "POST",
        path: `/v1/verification/badges/${encodeURIComponent(badgeId)}/appeal`,
        schema: badgeSchema,
        body: appealRequestSchema.parse({ statement }),
        authenticated: true,
      }),
    badges: (orgId) =>
      send({
        method: "GET",
        path:
          orgId === undefined
            ? "/v1/me/verification/badges"
            : orgPath(orgId, "verification", "badges"),
        schema: z.array(badgeSchema),
        authenticated: true,
      }),
    verificationLabels: (subject) =>
      send({
        method: "GET",
        path: `/v1/verification/labels/${subject.type === "user" ? "users" : "organizations"}/${encodeURIComponent(subject.id)}`,
        schema: verificationLabelsSchema,
        authenticated: true,
      }),
    acceptInvitation: async (token) =>
      send({
        method: "POST",
        path: "/v1/invitations/accept",
        schema: myOrganizationSchema,
        body: acceptInvitationRequestSchema.parse({ token }),
        authenticated: true,
      }),
  };
}
