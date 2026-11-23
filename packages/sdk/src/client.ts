import {
  type CreateServiceRequest,
  createAttachmentSchema,
  createServiceRequestSchema,
  declineSchema,
  evidenceSchema,
  type InquiryDto,
  inquirySchema,
  reasonSchema,
  type RequestErrorReason,
  requestErrorReasonSchema,
  type ServiceRequestDto,
  serviceRequestSchema,
  submitQuoteSchema,
  createdShareLinkSchema,
  createListRequestSchema,
  createShareLinkRequestSchema,
  joinListRequestSchema,
  memberRoleRequestSchema,
  type ListErrorReason,
  listErrorReasonSchema,
  listItemRequestSchema,
  type RouteSearchRequest,
  type RouteSearchResponse,
  routeSearchRequestSchema,
  routeSearchResponseSchema,
  type SavedListDto,
  savedListSchema,
  type SavedListSummary,
  savedListSummarySchema,
  shareLinkSchema,
  updateListRequestSchema,
  type GeocodeResult,
  geocodeQuerySchema,
  geocodeResultSchema,
  type MapConfig,
  mapConfigSchema,
  type ProviderSearchPage,
  providerSearchPageSchema,
  type SearchProvidersQuery,
  searchErrorReasonSchema,
  searchProvidersQuerySchema,
  type BranchHoursDto,
  branchHoursRequestSchema,
  branchHoursSchema,
  type CatalogErrorReason,
  catalogErrorReasonSchema,
  type HoursExceptionRequest,
  hoursExceptionRequestSchema,
  localDateSchema,
  type OfferingDto,
  type OfferingRequest,
  offeringRequestSchema,
  offeringSchema,
  acceptInvitationRequestSchema,
  addMediaRequestSchema,
  branchLocationRequestSchema,
  type ProviderErrorReason,
  providerErrorReasonSchema,
  type ProviderProfileDto,
  providerProfileSchema,
  type PublicProviderProfile,
  publicProviderProfileSchema,
  type UpdateProviderProfileRequest,
  updateProviderProfileRequestSchema,
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

/** Search query string values (validated with `searchProvidersQuerySchema` before sending). */
export type SearchQueryParams = Partial<
  Record<keyof SearchProvidersQuery, string | number | boolean>
>;

export type ApiErrorReason =
  | AuthErrorReason
  | OrganizationErrorReason
  | EntitlementErrorReason
  | VerificationErrorReason
  | ProviderErrorReason
  | CatalogErrorReason
  | "invalid_cursor"
  | ListErrorReason
  | "insufficient_role"
  | RequestErrorReason
  | "quota_exceeded";

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
  /** Provider setup wizard: the saved draft with per-step completeness. */
  providerProfile(orgId: string): Promise<ProviderProfileDto>;
  /** Save any subset of fields; the wizard resumes from the saved draft. */
  updateProviderProfile(
    orgId: string,
    change: UpdateProviderProfileRequest,
  ): Promise<ProviderProfileDto>;
  updateBranchLocation(
    orgId: string,
    branchId: string,
    change: z.input<typeof branchLocationRequestSchema>,
  ): Promise<BranchDto>;
  previewProviderProfile(orgId: string): Promise<{
    visitor: PublicProviderProfile;
    signedIn: PublicProviderProfile;
    issues: { path: string; message: string }[];
  }>;
  /** 422 `profile_incomplete` with `issues` when something is missing. */
  publishProviderProfile(orgId: string): Promise<ProviderProfileDto>;
  unpublishProviderProfile(orgId: string): Promise<ProviderProfileDto>;
  /** Then PUT the image to `upload.url` and call completeProfileMedia. */
  addProfileMedia(
    orgId: string,
    media: z.input<typeof addMediaRequestSchema>,
  ): Promise<{
    mediaId: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
  }>;
  completeProfileMedia(orgId: string, mediaId: string): Promise<{ id: string; url: string }>;
  removeProfileMedia(orgId: string, mediaId: string): Promise<void>;
  /** Service catalog (draft): published with the profile. Prices are indicative only. */
  offerings(orgId: string): Promise<OfferingDto[]>;
  createOffering(orgId: string, offering: OfferingRequest): Promise<OfferingDto>;
  /** Replaces the whole offering. */
  replaceOffering(
    orgId: string,
    offeringId: string,
    offering: OfferingRequest,
  ): Promise<OfferingDto>;
  deleteOffering(orgId: string, offeringId: string): Promise<void>;
  /** Opening hours in the branch's local time, with open-now status. Live (no republish). */
  branchHours(orgId: string, branchId: string): Promise<BranchHoursDto>;
  saveBranchHours(
    orgId: string,
    branchId: string,
    hours: z.input<typeof branchHoursRequestSchema>,
  ): Promise<BranchHoursDto>;
  /** Holiday or special day for a local date (YYYY-MM-DD). */
  saveHoursException(
    orgId: string,
    branchId: string,
    date: string,
    exception: HoursExceptionRequest,
  ): Promise<BranchHoursDto>;
  removeHoursException(orgId: string, branchId: string, date: string): Promise<void>;
  /**
   * Nearby (lat/lng) or map-viewport (bbox) provider search, ranked by relevance. Visitors get
   * approximate locations; pass `signedIn: true` for exact ones. Follow `nextCursor` to page.
   */
  searchProviders(
    query: SearchQueryParams,
    options?: { signedIn?: boolean },
  ): Promise<ProviderSearchPage>;
  /** Place-name lookup through the map adapter (search near the result). */
  geocode(query: string, options?: { country?: string; limit?: number }): Promise<GeocodeResult[]>;
  mapConfig(): Promise<MapConfig>;
  /**
   * Providers along a route (signed in). Check `mode`: `waypoints` means routing was
   * unavailable and results are point searches around the stops. Always show `disclaimer`.
   */
  searchRoute(request: RouteSearchRequest): Promise<RouteSearchResponse>;
  favorites(): Promise<SavedListDto>;
  addFavorite(organizationId: string): Promise<SavedListDto>;
  removeFavorite(organizationId: string): Promise<void>;
  /** Favorites first, then own lists, then lists shared with the caller. */
  lists(): Promise<SavedListSummary[]>;
  createList(list: z.input<typeof createListRequestSchema>): Promise<SavedListDto>;
  list(listId: string): Promise<SavedListDto>;
  updateList(
    listId: string,
    change: z.input<typeof updateListRequestSchema>,
  ): Promise<SavedListDto>;
  deleteList(listId: string): Promise<void>;
  /** Adds a provider (or updates its note). Owner or editor. */
  putListItem(listId: string, organizationId: string, note?: string | null): Promise<SavedListDto>;
  removeListItem(listId: string, organizationId: string): Promise<void>;
  /** Owner only. The token is returned once: build the invite from `joinPath`. */
  createShareLink(
    listId: string,
    options?: z.input<typeof createShareLinkRequestSchema>,
  ): Promise<z.infer<typeof createdShareLinkSchema>>;
  shareLinks(listId: string): Promise<z.infer<typeof shareLinkSchema>[]>;
  revokeShareLink(listId: string, linkId: string): Promise<void>;
  joinList(token: string): Promise<SavedListSummary>;
  setListMemberRole(listId: string, userId: string, role: "viewer" | "editor"): Promise<void>;
  /** Owner removes a member, or a member leaves by passing their own user ID. */
  removeListMember(listId: string, userId: string): Promise<void>;
  /**
   * Service requests (requester side). Pass `orgId` to act for a fleet; omit it for a personal
   * request. Reuse the same `clientRequestId` when retrying: it never consumes quota twice.
   */
  createServiceRequest(
    request: CreateServiceRequest,
    options?: RequesterOptions,
  ): Promise<ServiceRequestDto>;
  serviceRequests(options?: RequesterOptions): Promise<ServiceRequestDto[]>;
  serviceRequest(requestId: string, options?: RequesterOptions): Promise<ServiceRequestDto>;
  /** Records which quote was accepted. Informational only: payment is arranged outside FleetTrust. */
  acceptQuote(
    requestId: string,
    quoteId: string,
    options?: RequesterOptions,
  ): Promise<ServiceRequestDto>;
  cancelServiceRequest(
    requestId: string,
    reason: string,
    options?: RequesterOptions,
  ): Promise<ServiceRequestDto>;
  completeServiceRequest(requestId: string, options?: RequesterOptions): Promise<ServiceRequestDto>;
  addRequestEvidence(
    requestId: string,
    evidence: z.input<typeof evidenceSchema>,
    options?: RequesterOptions,
  ): Promise<ServiceRequestDto>;
  /** Then PUT the photo to `upload.url` and call completeRequestAttachment. */
  createRequestAttachment(file: z.input<typeof createAttachmentSchema>): Promise<{
    attachmentId: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
  }>;
  completeRequestAttachment(attachmentId: string): Promise<{ id: string; status: "available" }>;
  /** Provider inquiry inbox. */
  inquiries(orgId: string): Promise<InquiryDto[]>;
  /** Opening an inquiry marks it viewed. */
  inquiry(orgId: string, recipientId: string): Promise<InquiryDto>;
  submitQuote(
    orgId: string,
    recipientId: string,
    quote: z.input<typeof submitQuoteSchema>,
  ): Promise<InquiryDto>;
  withdrawQuote(orgId: string, recipientId: string, quoteId: string): Promise<InquiryDto>;
  declineInquiry(orgId: string, recipientId: string, reason?: string | null): Promise<InquiryDto>;
  /** The accepted provider cancels the agreement; the request reopens. */
  cancelInquiry(orgId: string, recipientId: string, reason: string): Promise<InquiryDto>;
  completeInquiry(orgId: string, recipientId: string): Promise<InquiryDto>;
  addInquiryEvidence(
    orgId: string,
    recipientId: string,
    evidence: z.input<typeof evidenceSchema>,
  ): Promise<InquiryDto>;
  /** A published provider. Signed-in callers get contact details and exact locations. */
  provider(slug: string, options?: { signedIn?: boolean }): Promise<PublicProviderProfile>;

  /** Public trust labels: "verified" or "unverified" per badge type. */
  verificationLabels(subject: {
    type: "user" | "organization";
    id: string;
  }): Promise<VerificationLabels>;
}

const casePath = (caseId: string, ...rest: string[]) =>
  ["/v1/verification/cases", encodeURIComponent(caseId), ...rest.map(encodeURIComponent)].join("/");

/** Requester routes: a fleet's when `orgId` is given, otherwise the caller's own. */
export interface RequesterOptions {
  orgId?: string;
}

const requestsPath = (options: RequesterOptions | undefined, ...rest: string[]) =>
  options?.orgId
    ? orgPath(options.orgId, "service-requests", ...rest)
    : ["/v1/me/service-requests", ...rest]
        .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
        .join("/");

const meListPath = (listId: string, ...rest: string[]) =>
  ["/v1/me/lists", listId, ...rest]
    .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
    .join("/");

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
        providerErrorReasonSchema,
        catalogErrorReasonSchema,
        searchErrorReasonSchema,
        listErrorReasonSchema,
        z.literal("insufficient_role"),
        requestErrorReasonSchema,
        z.literal("quota_exceeded"),
      ])
      .optional(),
    message: z.unknown().optional(),
  })
  .loose();

interface RequestSpec<TSchema extends z.ZodType | undefined> {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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
    providerProfile: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "provider-profile"),
        schema: providerProfileSchema,
        authenticated: true,
      }),
    updateProviderProfile: async (orgId, change) =>
      send({
        method: "PATCH",
        path: orgPath(orgId, "provider-profile"),
        schema: providerProfileSchema,
        body: updateProviderProfileRequestSchema.parse(change),
        authenticated: true,
      }),
    updateBranchLocation: async (orgId, branchId, change) =>
      send({
        method: "PATCH",
        path: orgPath(orgId, "provider-profile", "branches", branchId),
        schema: branchSchema,
        body: branchLocationRequestSchema.parse(change),
        authenticated: true,
      }),
    previewProviderProfile: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "provider-profile", "preview"),
        schema: z.object({
          visitor: publicProviderProfileSchema,
          signedIn: publicProviderProfileSchema,
          issues: z.array(z.object({ path: z.string(), message: z.string() })),
        }),
        authenticated: true,
      }),
    publishProviderProfile: (orgId) =>
      send({
        method: "POST",
        path: orgPath(orgId, "provider-profile", "publish"),
        schema: providerProfileSchema,
        authenticated: true,
      }),
    unpublishProviderProfile: (orgId) =>
      send({
        method: "POST",
        path: orgPath(orgId, "provider-profile", "unpublish"),
        schema: providerProfileSchema,
        authenticated: true,
      }),
    addProfileMedia: async (orgId, media) =>
      send({
        method: "POST",
        path: orgPath(orgId, "provider-profile", "media"),
        schema: z.object({
          mediaId: z.uuid(),
          upload: z.object({
            url: z.string(),
            method: z.literal("PUT"),
            headers: z.record(z.string(), z.string()),
            expiresAt: z.iso.datetime(),
          }),
        }),
        body: addMediaRequestSchema.parse(media),
        authenticated: true,
      }),
    completeProfileMedia: (orgId, mediaId) =>
      send({
        method: "POST",
        path: orgPath(orgId, "provider-profile", "media", mediaId, "complete"),
        schema: z.object({ id: z.uuid(), url: z.string() }),
        authenticated: true,
      }),
    removeProfileMedia: (orgId, mediaId) =>
      send({
        method: "DELETE",
        path: orgPath(orgId, "provider-profile", "media", mediaId),
        schema: undefined,
        authenticated: true,
      }),
    offerings: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "provider-profile", "offerings"),
        schema: z.array(offeringSchema),
        authenticated: true,
      }),
    createOffering: async (orgId, offering) =>
      send({
        method: "POST",
        path: orgPath(orgId, "provider-profile", "offerings"),
        schema: offeringSchema,
        body: offeringRequestSchema.parse(offering),
        authenticated: true,
      }),
    replaceOffering: async (orgId, offeringId, offering) =>
      send({
        method: "PUT",
        path: orgPath(orgId, "provider-profile", "offerings", offeringId),
        schema: offeringSchema,
        body: offeringRequestSchema.parse(offering),
        authenticated: true,
      }),
    deleteOffering: (orgId, offeringId) =>
      send({
        method: "DELETE",
        path: orgPath(orgId, "provider-profile", "offerings", offeringId),
        schema: undefined,
        authenticated: true,
      }),
    branchHours: (orgId, branchId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "provider-profile", "branches", branchId, "hours"),
        schema: branchHoursSchema,
        authenticated: true,
      }),
    saveBranchHours: async (orgId, branchId, hours) =>
      send({
        method: "PUT",
        path: orgPath(orgId, "provider-profile", "branches", branchId, "hours"),
        schema: branchHoursSchema,
        body: branchHoursRequestSchema.parse(hours),
        authenticated: true,
      }),
    saveHoursException: async (orgId, branchId, date, exception) =>
      send({
        method: "PUT",
        path: orgPath(
          orgId,
          "provider-profile",
          "branches",
          branchId,
          "hours",
          "exceptions",
          localDateSchema.parse(date),
        ),
        schema: branchHoursSchema,
        body: hoursExceptionRequestSchema.parse(exception),
        authenticated: true,
      }),
    removeHoursException: async (orgId, branchId, date) =>
      send({
        method: "DELETE",
        path: orgPath(
          orgId,
          "provider-profile",
          "branches",
          branchId,
          "hours",
          "exceptions",
          localDateSchema.parse(date),
        ),
        schema: undefined,
        authenticated: true,
      }),
    searchProviders: async (query, options) => {
      // Validate locally (same schema as the API), then send the original string form.
      searchProvidersQuerySchema.parse(query);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        params.set(key, String(value));
      }
      const signedIn = options?.signedIn === true;
      return send({
        method: "GET",
        path: `/v1/search/providers${signedIn ? "/full" : ""}?${params.toString()}`,
        schema: providerSearchPageSchema,
        authenticated: signedIn,
      });
    },
    geocode: async (q, options) => {
      const parsed = geocodeQuerySchema.parse({ q, ...options });
      const params = new URLSearchParams({ q: parsed.q, limit: String(parsed.limit) });
      if (parsed.country) params.set("country", parsed.country);
      return send({
        method: "GET",
        path: `/v1/geo/geocode?${params.toString()}`,
        schema: z.array(geocodeResultSchema),
        authenticated: false,
      });
    },
    mapConfig: () =>
      send({
        method: "GET",
        path: "/v1/geo/map-config",
        schema: mapConfigSchema,
        authenticated: false,
      }),
    searchRoute: async (request) =>
      send({
        method: "POST",
        path: "/v1/search/route",
        schema: routeSearchResponseSchema,
        body: routeSearchRequestSchema.parse(request),
        authenticated: true,
      }),
    favorites: () =>
      send({
        method: "GET",
        path: "/v1/me/favorites",
        schema: savedListSchema,
        authenticated: true,
      }),
    addFavorite: (organizationId) =>
      send({
        method: "PUT",
        path: `/v1/me/favorites/${encodeURIComponent(organizationId)}`,
        schema: savedListSchema,
        authenticated: true,
      }),
    removeFavorite: (organizationId) =>
      send({
        method: "DELETE",
        path: `/v1/me/favorites/${encodeURIComponent(organizationId)}`,
        schema: undefined,
        authenticated: true,
      }),
    lists: () =>
      send({
        method: "GET",
        path: "/v1/me/lists",
        schema: z.array(savedListSummarySchema),
        authenticated: true,
      }),
    createList: async (list) =>
      send({
        method: "POST",
        path: "/v1/me/lists",
        schema: savedListSchema,
        body: createListRequestSchema.parse(list),
        authenticated: true,
      }),
    list: (listId) =>
      send({
        method: "GET",
        path: meListPath(listId),
        schema: savedListSchema,
        authenticated: true,
      }),
    updateList: async (listId, change) =>
      send({
        method: "PATCH",
        path: meListPath(listId),
        schema: savedListSchema,
        body: updateListRequestSchema.parse(change),
        authenticated: true,
      }),
    deleteList: (listId) =>
      send({ method: "DELETE", path: meListPath(listId), schema: undefined, authenticated: true }),
    putListItem: async (listId, organizationId, note = null) =>
      send({
        method: "PUT",
        path: meListPath(listId, "items", organizationId),
        schema: savedListSchema,
        body: listItemRequestSchema.parse({ note }),
        authenticated: true,
      }),
    removeListItem: (listId, organizationId) =>
      send({
        method: "DELETE",
        path: meListPath(listId, "items", organizationId),
        schema: undefined,
        authenticated: true,
      }),
    createShareLink: async (listId, options) =>
      send({
        method: "POST",
        path: meListPath(listId, "share-links"),
        schema: createdShareLinkSchema,
        body: createShareLinkRequestSchema.parse(options ?? {}),
        authenticated: true,
      }),
    shareLinks: (listId) =>
      send({
        method: "GET",
        path: meListPath(listId, "share-links"),
        schema: z.array(shareLinkSchema),
        authenticated: true,
      }),
    revokeShareLink: (listId, linkId) =>
      send({
        method: "DELETE",
        path: meListPath(listId, "share-links", linkId),
        schema: undefined,
        authenticated: true,
      }),
    joinList: async (token) =>
      send({
        method: "POST",
        path: "/v1/lists/join",
        schema: savedListSummarySchema,
        body: joinListRequestSchema.parse({ token }),
        authenticated: true,
      }),
    setListMemberRole: async (listId, userId, role) =>
      send({
        method: "PATCH",
        path: meListPath(listId, "members", userId),
        schema: undefined,
        body: memberRoleRequestSchema.parse({ role }),
        authenticated: true,
      }),
    removeListMember: (listId, userId) =>
      send({
        method: "DELETE",
        path: meListPath(listId, "members", userId),
        schema: undefined,
        authenticated: true,
      }),
    createServiceRequest: async (request, options) =>
      send({
        method: "POST",
        path: requestsPath(options),
        schema: serviceRequestSchema,
        body: createServiceRequestSchema.parse(request),
        authenticated: true,
      }),
    serviceRequests: (options) =>
      send({
        method: "GET",
        path: requestsPath(options),
        schema: z.array(serviceRequestSchema),
        authenticated: true,
      }),
    serviceRequest: (requestId, options) =>
      send({
        method: "GET",
        path: requestsPath(options, requestId),
        schema: serviceRequestSchema,
        authenticated: true,
      }),
    acceptQuote: (requestId, quoteId, options) =>
      send({
        method: "POST",
        path: requestsPath(options, requestId, "quotes", quoteId, "accept"),
        schema: serviceRequestSchema,
        authenticated: true,
      }),
    cancelServiceRequest: async (requestId, reason, options) =>
      send({
        method: "POST",
        path: requestsPath(options, requestId, "cancel"),
        schema: serviceRequestSchema,
        body: reasonSchema.parse({ reason }),
        authenticated: true,
      }),
    completeServiceRequest: (requestId, options) =>
      send({
        method: "POST",
        path: requestsPath(options, requestId, "complete"),
        schema: serviceRequestSchema,
        authenticated: true,
      }),
    addRequestEvidence: async (requestId, evidence, options) =>
      send({
        method: "POST",
        path: requestsPath(options, requestId, "evidence"),
        schema: serviceRequestSchema,
        body: evidenceSchema.parse(evidence),
        authenticated: true,
      }),
    createRequestAttachment: async (file) =>
      send({
        method: "POST",
        path: "/v1/service-request-attachments",
        schema: z.object({
          attachmentId: z.uuid(),
          upload: z.object({
            url: z.string(),
            method: z.literal("PUT"),
            headers: z.record(z.string(), z.string()),
            expiresAt: z.iso.datetime(),
          }),
        }),
        body: createAttachmentSchema.parse(file),
        authenticated: true,
      }),
    completeRequestAttachment: (attachmentId) =>
      send({
        method: "POST",
        path: `/v1/service-request-attachments/${encodeURIComponent(attachmentId)}/complete`,
        schema: z.object({ id: z.uuid(), status: z.literal("available") }),
        authenticated: true,
      }),
    inquiries: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "inquiries"),
        schema: z.array(inquirySchema),
        authenticated: true,
      }),
    inquiry: (orgId, recipientId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "inquiries", recipientId),
        schema: inquirySchema,
        authenticated: true,
      }),
    submitQuote: async (orgId, recipientId, quote) =>
      send({
        method: "POST",
        path: orgPath(orgId, "inquiries", recipientId, "quotes"),
        schema: inquirySchema,
        body: submitQuoteSchema.parse(quote),
        authenticated: true,
      }),
    withdrawQuote: (orgId, recipientId, quoteId) =>
      send({
        method: "POST",
        path: orgPath(orgId, "inquiries", recipientId, "quotes", quoteId, "withdraw"),
        schema: inquirySchema,
        authenticated: true,
      }),
    declineInquiry: async (orgId, recipientId, reason = null) =>
      send({
        method: "POST",
        path: orgPath(orgId, "inquiries", recipientId, "decline"),
        schema: inquirySchema,
        body: declineSchema.parse({ reason }),
        authenticated: true,
      }),
    cancelInquiry: async (orgId, recipientId, reason) =>
      send({
        method: "POST",
        path: orgPath(orgId, "inquiries", recipientId, "cancel"),
        schema: inquirySchema,
        body: reasonSchema.parse({ reason }),
        authenticated: true,
      }),
    completeInquiry: (orgId, recipientId) =>
      send({
        method: "POST",
        path: orgPath(orgId, "inquiries", recipientId, "complete"),
        schema: inquirySchema,
        authenticated: true,
      }),
    addInquiryEvidence: async (orgId, recipientId, evidence) =>
      send({
        method: "POST",
        path: orgPath(orgId, "inquiries", recipientId, "evidence"),
        schema: inquirySchema,
        body: evidenceSchema.parse(evidence),
        authenticated: true,
      }),
    provider: (slug, options) =>
      send({
        method: "GET",
        path: `/v1/providers/${encodeURIComponent(slug)}${options?.signedIn ? "/full" : ""}`,
        schema: publicProviderProfileSchema,
        authenticated: options?.signedIn === true,
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
