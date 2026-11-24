import {
  type ApplicationDto,
  applicationSchema,
  applicationStatusRequestSchema,
  applyRequestSchema,
  type ApplyRequest,
  createFleetIncidentSchema,
  type CreateFleetIncident,
  dashboardQuerySchema,
  type ExpenseDto,
  expenseQuerySchema,
  expenseRequestSchema,
  type ExpenseRequest,
  expenseSchema,
  type FleetDashboardDto,
  fleetDashboardSchema,
  type FleetErrorReason,
  fleetErrorReasonSchema,
  type FleetIncidentDto,
  fleetIncidentQuerySchema,
  fleetIncidentSchema,
  type JobDto,
  type JobErrorReason,
  jobErrorReasonSchema,
  jobListQuerySchema,
  jobRequestSchema,
  type JobRequest,
  jobSchema,
  preferredByCountSchema,
  type PreferredProviderDto,
  preferredProviderRequestSchema,
  type PreferredProviderRequest,
  preferredProviderSchema,
  type PublicJob,
  publicJobListSchema,
  publicJobQuerySchema,
  publicJobSchema,
  updateFleetIncidentSchema,
  updatePreferredProviderSchema,
  answerPartInquirySchema,
  type AnswerPartInquiry,
  createPartInquirySchema,
  type CreatePartInquiry,
  createPartRequestSchema,
  type CreatePartRequest,
  createReferralSchema,
  type CreateReferral,
  type PartDto,
  type PartInquiryDto,
  partInquiryQuerySchema,
  partInquirySchema,
  partListQuerySchema,
  partRequestSchema,
  type PartRequest,
  partSchema,
  partSearchQuerySchema,
  type PartSearchResult,
  partSearchResultSchema,
  type PartsErrorReason,
  partsErrorReasonSchema,
  type PublicPart,
  publicPartSchema,
  type ReferralConsent,
  referralConsentSchema,
  type ReferralDto,
  type ReferralErrorReason,
  referralErrorReasonSchema,
  referralListQuerySchema,
  referralSchema,
  stockRequestSchema,
  analyticsQuerySchema,
  type AppointmentDto,
  appointmentQuerySchema,
  appointmentSchema,
  appointmentStatusRequestSchema,
  createAppointmentSchema,
  createTaskSchema,
  type CrmErrorReason,
  crmErrorReasonSchema,
  type CrmInquiryDto,
  crmInquirySchema,
  type CrmQuoteDto,
  crmQuoteSchema,
  type CrmTaskDto,
  crmTaskSchema,
  type CustomerAppointmentDto,
  customerAppointmentSchema,
  inquiryNoteRequestSchema,
  type PipelineDto,
  pipelineQuerySchema,
  pipelineSchema,
  type ProviderAnalyticsDto,
  providerAnalyticsSchema,
  quoteListQuerySchema,
  type ResponseStatusDto,
  responseStatusSchema,
  slotQuerySchema,
  type SlotsDto,
  slotsSchema,
  staffAvailabilityRequestSchema,
  type StaffMemberDto,
  staffMemberSchema,
  taskQuerySchema,
  timeOffRequestSchema,
  updateAppointmentSchema,
  updateInquiryCrmSchema,
  updateTaskSchema,
  completeScheduleSchema,
  type CreatedDocumentShare,
  createdDocumentShareSchema,
  createDocumentShareSchema,
  createServiceRecordSchema,
  createVehicleDocumentSchema,
  type CreateVehicle,
  createVehicleSchema,
  type DocumentShareDto,
  documentShareSchema,
  type MaintenanceScheduleDto,
  maintenanceScheduleSchema,
  providerServiceRecordSchema,
  type ScheduleInput,
  scheduleSchema,
  type ServiceHistory,
  serviceHistorySchema,
  type ServiceRecordDto,
  serviceRecordSchema,
  updateVehicleDocumentSchema,
  updateVehicleSchema,
  type VehicleDocumentDto,
  vehicleDocumentSchema,
  type VehicleDto,
  type VehicleErrorReason,
  vehicleErrorReasonSchema,
  vehicleSchema,
  type CreateIncident,
  createIncidentSchema,
  emergencyAssistSettingsSchema,
  type EmergencyErrorReason,
  emergencyErrorReasonSchema,
  type EmergencyGuidance,
  emergencyGuidanceSchema,
  type IncidentDto,
  incidentSchema,
  type ProviderAlertDto,
  providerAlertSchema,
  type TrustedContactDto,
  trustedContactSchema,
  type ConversationDto,
  conversationSchema,
  createMessageAttachmentSchema,
  type InboxDto,
  inboxSchema,
  type MessageDto,
  type MessagePage,
  messagePageSchema,
  messageSchema,
  type MessagingErrorReason,
  messagingErrorReasonSchema,
  type MessagingPreferences,
  messagingPreferencesSchema,
  registerDeviceSchema,
  reportMessageSchema,
  type SendMessage,
  sendMessageSchema,
  updateMessagingPreferencesSchema,
  type BlockedUserDto,
  blockedUserSchema,
  type CommunityErrorReason,
  communityErrorReasonSchema,
  createGroupSchema,
  type FriendDto,
  friendSchema,
  type FriendRequestDto,
  friendRequestSchema,
  type GroupDto,
  groupSchema,
  type GroupMemberDto,
  groupMemberSchema,
  type GroupPage,
  groupPageSchema,
  type GroupRole,
  moderationErrorReasonSchema,
  type ModerationErrorReason,
  type PersonDto,
  personSchema,
  type PersonProfile,
  personProfileSchema,
  type ReportTargetType,
  type SearchGroupsQuery,
  searchGroupsQuerySchema,
  type SendFriendRequestResult,
  sendFriendRequestResultSchema,
  type SocialSettings,
  socialSettingsSchema,
  updateGroupSchema,
  updateSocialSettingsSchema,
  type ArticleCommentDto,
  articleCommentSchema,
  type ArticleErrorReason,
  articleErrorReasonSchema,
  type ArticlePage,
  articlePageSchema,
  type ArticleSummary,
  articleSummarySchema,
  type CommentList,
  commentListSchema,
  createArticleImageSchema,
  createArticleSchema,
  createCommentSchema,
  createReportSchema,
  type ModerationCase,
  moderationCaseSchema,
  type ModerationQueueItem,
  moderationQueueItemSchema,
  type MyArticle,
  myArticleSchema,
  type PublicArticle,
  publicArticleSchema,
  type SearchArticlesQuery,
  searchArticlesQuerySchema,
  updateArticleSchema,
  updateCommentSchema,
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

/** Article search query string values (validated with `searchArticlesQuerySchema`). */
export type ArticleQueryParams = Partial<Record<keyof SearchArticlesQuery, string | number>>;

/** Group search query string values (validated with `searchGroupsQuerySchema`). */
export type GroupQueryParams = Partial<Record<keyof SearchGroupsQuery, string | number>>;

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
  | ArticleErrorReason
  | ModerationErrorReason
  | CommunityErrorReason
  | MessagingErrorReason
  | EmergencyErrorReason
  | VehicleErrorReason
  | CrmErrorReason
  | PartsErrorReason
  | ReferralErrorReason
  | FleetErrorReason
  | JobErrorReason
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

  /** Public knowledge hub: published articles, newest first or by relevance when `q` is set. */
  searchArticles(query?: ArticleQueryParams): Promise<ArticlePage>;
  article(slug: string): Promise<PublicArticle>;
  articleComments(slug: string): Promise<CommentList>;
  /** Saves a draft (no quota). */
  createArticle(article: z.input<typeof createArticleSchema>): Promise<MyArticle>;
  myArticles(): Promise<MyArticle[]>;
  myArticle(articleId: string): Promise<MyArticle>;
  updateArticle(articleId: string, change: z.input<typeof updateArticleSchema>): Promise<MyArticle>;
  /** First publication uses one articles.daily unit. New accounts go to moderation first. */
  publishArticle(articleId: string): Promise<MyArticle>;
  unpublishArticle(articleId: string): Promise<MyArticle>;
  deleteArticle(articleId: string): Promise<void>;
  /** Then PUT the image to `upload.url` and call completeArticleImage. */
  createArticleImage(file: z.input<typeof createArticleImageSchema>): Promise<{
    imageId: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
  }>;
  completeArticleImage(imageId: string): Promise<{ id: string; url: string }>;
  bookmarkArticle(articleId: string): Promise<void>;
  unbookmarkArticle(articleId: string): Promise<void>;
  bookmarkedArticles(): Promise<ArticleSummary[]>;
  addComment(
    articleId: string,
    comment: z.input<typeof createCommentSchema>,
  ): Promise<ArticleCommentDto>;
  editComment(commentId: string, body: string): Promise<ArticleCommentDto>;
  deleteComment(commentId: string): Promise<void>;
  /** Reports an article or comment to the trust and safety team. */
  report(report: z.input<typeof createReportSchema>): Promise<{ id: string; status: "open" }>;
  /** Trust and safety console (platform role trust_safety_moderator). */
  moderationQueue(): Promise<ModerationQueueItem[]>;
  moderationCase(targetType: ReportTargetType, targetId: string): Promise<ModerationCase>;
  /**
   * `reject` and `hide` need a reason (shown to the author). Articles and jobs: all decisions;
   * comments and groups: hide, restore, dismiss-reports; members: dismiss-reports (sanctions: Prompt 23).
   */
  moderate(
    targetType: ReportTargetType,
    targetId: string,
    decision: "approve" | "reject" | "hide" | "restore" | "dismiss-reports",
    reason?: string | null,
  ): Promise<ModerationCase>;
  socialSettings(): Promise<SocialSettings>;
  updateSocialSettings(change: z.input<typeof updateSocialSettingsSchema>): Promise<SocialSettings>;
  friends(): Promise<FriendDto[]>;
  unfriend(userId: string): Promise<void>;
  /**
   * Uses one friend_requests.daily unit only when a request is actually sent. If they already
   * asked you, this accepts their request instead (`outcome: "accepted"`).
   */
  sendFriendRequest(userId: string): Promise<SendFriendRequestResult>;
  friendRequests(direction?: "incoming" | "outgoing"): Promise<FriendRequestDto[]>;
  acceptFriendRequest(requestId: string): Promise<FriendDto>;
  declineFriendRequest(requestId: string): Promise<void>;
  cancelFriendRequest(requestId: string): Promise<void>;
  blockedUsers(): Promise<BlockedUserDto[]>;
  /** Ends the friendship and pending requests. The other person isn't told. */
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
  /** Members who opted in to search, by display name prefix (at least 2 characters). */
  searchPeople(q: string, limit?: number): Promise<PersonDto[]>;
  person(userId: string): Promise<PersonProfile>;
  personFriends(userId: string): Promise<FriendDto[]>;
  /** Public group directory. */
  searchGroups(query?: GroupQueryParams): Promise<GroupPage>;
  group(slug: string): Promise<GroupDto>;
  myGroups(): Promise<GroupDto[]>;
  /** Uses one groups.daily unit (the organization's for hosted groups). */
  createGroup(group: z.input<typeof createGroupSchema>): Promise<GroupDto>;
  updateGroup(groupId: string, change: z.input<typeof updateGroupSchema>): Promise<GroupDto>;
  archiveGroup(groupId: string): Promise<void>;
  joinGroup(groupId: string): Promise<GroupDto>;
  leaveGroup(groupId: string): Promise<void>;
  /** Active members (members only); pending and banned (owners and moderators). */
  groupMembers(
    groupId: string,
    status?: "active" | "pending" | "banned",
  ): Promise<GroupMemberDto[]>;
  approveGroupMember(groupId: string, userId: string): Promise<void>;
  rejectGroupMember(groupId: string, userId: string): Promise<void>;
  /** Owner only. Role "owner" hands over ownership. */
  setGroupRole(groupId: string, userId: string, role: GroupRole): Promise<void>;
  removeGroupMember(groupId: string, userId: string): Promise<void>;
  banFromGroup(groupId: string, userId: string): Promise<void>;
  unbanFromGroup(groupId: string, userId: string): Promise<void>;
  /** Your conversations, most recent first, with unread counts. */
  conversations(): Promise<ConversationDto[]>;
  conversation(conversationId: string): Promise<ConversationDto>;
  /** Finds or starts a direct conversation (blocks and their privacy setting apply). */
  openDirectConversation(userId: string): Promise<ConversationDto>;
  /** The conversation between the requester side and one recipient provider. */
  openRequestConversation(recipientId: string): Promise<ConversationDto>;
  openGroupConversation(groupId: string): Promise<ConversationDto>;
  /** `after`: replay forwards from a cursor; `before`: older history. */
  messages(
    conversationId: string,
    query?: { after?: number; before?: number; limit?: number },
  ): Promise<MessagePage>;
  /** Resending the same `clientMessageId` returns the original message. */
  sendMessage(conversationId: string, message: SendMessage): Promise<MessageDto>;
  deleteMessage(conversationId: string, messageId: string): Promise<MessageDto>;
  reportMessage(
    conversationId: string,
    messageId: string,
    report: z.input<typeof reportMessageSchema>,
  ): Promise<{ id: string; status: "open" }>;
  markConversationRead(conversationId: string, seq: number): Promise<{ lastReadSeq: number }>;
  muteConversation(conversationId: string, muted: boolean): Promise<ConversationDto>;
  /** Then PUT the file to `upload.url` and call completeMessageAttachment. */
  createMessageAttachment(
    conversationId: string,
    file: z.input<typeof createMessageAttachmentSchema>,
  ): Promise<{
    attachmentId: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
  }>;
  completeMessageAttachment(
    conversationId: string,
    attachmentId: string,
  ): Promise<{ id: string; status: "available" }>;
  /** Notifications plus unread counts. */
  inbox(): Promise<InboxDto>;
  markNotificationRead(notificationId: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  messagingPreferences(): Promise<MessagingPreferences>;
  updateMessagingPreferences(
    change: z.input<typeof updateMessagingPreferencesSchema>,
  ): Promise<MessagingPreferences>;
  /** Registers this app installation (Firebase Installation ID) for push. */
  registerDevice(device: z.input<typeof registerDeviceSchema>): Promise<void>;
  unregisterDevice(fid: string): Promise<void>;
  /** WebSocket URL for realtime delivery; send `{ type: "auth", token }` as the first frame. */
  realtimeUrl(): string;
  /** Official emergency guidance for the first screen (no sign-in needed). */
  emergencyGuidance(countryCode?: string): Promise<EmergencyGuidance>;
  trustedContacts(): Promise<TrustedContactDto[]>;
  /** The person must accept before they can be alerted. */
  inviteTrustedContact(userId: string, priority?: "primary" | "backup"): Promise<TrustedContactDto>;
  respondToTrustedContact(contactId: string, accept: boolean): Promise<TrustedContactDto>;
  /** As a contact: pause or resume alerts from this person. */
  muteTrustedContact(contactId: string, muted: boolean): Promise<TrustedContactDto>;
  setTrustedContactPriority(
    contactId: string,
    priority: "primary" | "backup",
  ): Promise<TrustedContactDto>;
  removeTrustedContact(contactId: string): Promise<void>;
  /**
   * Raises an emergency incident and alerts contacts at once. Never limited by plans or quotas.
   * Reuse `clientIncidentId` on retry.
   */
  raiseIncident(incident: CreateIncident): Promise<IncidentDto>;
  myIncidents(): Promise<IncidentDto[]>;
  incident(incidentId: string): Promise<IncidentDto>;
  updateIncidentLocation(
    incidentId: string,
    location: { lng: number; lat: number; accuracyM?: number | null },
  ): Promise<IncidentDto>;
  /** As a contact: "I've seen it" (stops escalation; it doesn't mean help is arranged). */
  acknowledgeIncident(incidentId: string): Promise<IncidentDto>;
  /** "I'm safe". */
  resolveIncident(incidentId: string): Promise<IncidentDto>;
  /** "False alarm". */
  cancelIncident(incidentId: string): Promise<IncidentDto>;
  /** Alerts where you are a trusted contact. */
  emergencyAlerts(): Promise<IncidentDto[]>;
  emergencyAssist(orgId: string): Promise<{ optedIn: boolean; radiusKm: number }>;
  setEmergencyAssist(
    orgId: string,
    settings: { optedIn: boolean; radiusKm?: number },
  ): Promise<{ optedIn: boolean; radiusKm: number }>;
  providerEmergencyAlerts(orgId: string): Promise<ProviderAlertDto[]>;
  offerEmergencyHelp(
    orgId: string,
    recipientId: string,
    message?: string | null,
  ): Promise<ProviderAlertDto>;
  /** Your personal vehicles and the fleet vehicles assigned to you. */
  myVehicles(): Promise<VehicleDto[]>;
  createVehicle(vehicle: CreateVehicle): Promise<VehicleDto>;
  fleetVehicles(orgId: string, options?: { archived?: boolean }): Promise<VehicleDto[]>;
  createFleetVehicle(orgId: string, vehicle: CreateVehicle): Promise<VehicleDto>;
  vehicle(vehicleId: string): Promise<VehicleDto>;
  updateVehicle(
    vehicleId: string,
    change: z.input<typeof updateVehicleSchema>,
  ): Promise<VehicleDto>;
  archiveVehicle(vehicleId: string): Promise<VehicleDto>;
  /** Readings only go up. */
  reportOdometer(vehicleId: string, odometerKm: number): Promise<VehicleDto>;
  assignDriver(vehicleId: string, userId: string): Promise<VehicleDto>;
  unassignDriver(vehicleId: string): Promise<VehicleDto>;
  /** Service history with its notice: records carry their source and are never verified. */
  serviceHistory(vehicleId: string): Promise<ServiceHistory>;
  addServiceRecord(
    vehicleId: string,
    record: z.input<typeof createServiceRecordSchema>,
  ): Promise<ServiceRecordDto>;
  deleteServiceRecord(vehicleId: string, recordId: string): Promise<void>;
  /** The accepted provider's record on a request with a linked vehicle. */
  addProviderServiceRecord(
    orgId: string,
    recipientId: string,
    record: z.input<typeof providerServiceRecordSchema>,
  ): Promise<ServiceRecordDto>;
  maintenanceSchedules(vehicleId: string): Promise<MaintenanceScheduleDto[]>;
  addMaintenanceSchedule(
    vehicleId: string,
    schedule: ScheduleInput,
  ): Promise<MaintenanceScheduleDto>;
  updateMaintenanceSchedule(
    vehicleId: string,
    scheduleId: string,
    schedule: ScheduleInput,
  ): Promise<MaintenanceScheduleDto>;
  removeMaintenanceSchedule(vehicleId: string, scheduleId: string): Promise<void>;
  completeMaintenance(
    vehicleId: string,
    scheduleId: string,
    done: z.input<typeof completeScheduleSchema>,
  ): Promise<MaintenanceScheduleDto>;
  vehicleDocuments(vehicleId: string): Promise<VehicleDocumentDto[]>;
  /** Then PUT the file to `upload.url` and call completeVehicleDocument. */
  createVehicleDocument(
    vehicleId: string,
    document: z.input<typeof createVehicleDocumentSchema>,
  ): Promise<{
    document: VehicleDocumentDto;
    upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
  }>;
  completeVehicleDocument(vehicleId: string, documentId: string): Promise<VehicleDocumentDto>;
  updateVehicleDocument(
    vehicleId: string,
    documentId: string,
    change: z.input<typeof updateVehicleDocumentSchema>,
  ): Promise<VehicleDocumentDto>;
  deleteVehicleDocument(vehicleId: string, documentId: string): Promise<void>;
  /** The token is shown once; anyone with the link can open it within its limits. */
  shareVehicleDocument(
    vehicleId: string,
    documentId: string,
    share: z.input<typeof createDocumentShareSchema>,
  ): Promise<CreatedDocumentShare>;
  documentShares(vehicleId: string, documentId: string): Promise<DocumentShareDto[]>;
  revokeDocumentShare(vehicleId: string, documentId: string, shareId: string): Promise<void>;

  // Provider CRM and appointments (Prompt 20, ADR-0027).
  /** Inquiry pipeline: stage counts and items, filtered by stage, assignee or priority. */
  crmPipeline(orgId: string, query?: z.input<typeof pipelineQuerySchema>): Promise<PipelineDto>;
  crmInquiry(orgId: string, recipientId: string): Promise<CrmInquiryDto>;
  /** Assign or prioritise. Staff can only claim, release, or prioritise their own. */
  updateCrmInquiry(
    orgId: string,
    recipientId: string,
    change: z.input<typeof updateInquiryCrmSchema>,
  ): Promise<CrmInquiryDto>;
  /** Internal note, never shown to the customer. */
  addInquiryNote(orgId: string, recipientId: string, body: string): Promise<CrmInquiryDto>;
  deleteInquiryNote(orgId: string, recipientId: string, noteId: string): Promise<void>;
  crmQuotes(orgId: string, query?: z.input<typeof quoteListQuerySchema>): Promise<CrmQuoteDto[]>;
  crmTasks(orgId: string, query?: z.input<typeof taskQuerySchema>): Promise<CrmTaskDto[]>;
  createCrmTask(orgId: string, task: z.input<typeof createTaskSchema>): Promise<CrmTaskDto>;
  updateCrmTask(
    orgId: string,
    taskId: string,
    change: z.input<typeof updateTaskSchema>,
  ): Promise<CrmTaskDto>;
  deleteCrmTask(orgId: string, taskId: string): Promise<void>;
  crmStaff(orgId: string): Promise<StaffMemberDto[]>;
  setStaffAvailability(
    orgId: string,
    userId: string,
    availability: z.input<typeof staffAvailabilityRequestSchema>,
  ): Promise<StaffMemberDto[]>;
  addStaffTimeOff(
    orgId: string,
    userId: string,
    timeOff: z.input<typeof timeOffRequestSchema>,
  ): Promise<StaffMemberDto[]>;
  removeStaffTimeOff(orgId: string, userId: string, timeOffId: string): Promise<void>;
  /** Free slots on a local date in the branch's timezone. */
  appointmentSlots(orgId: string, query: z.input<typeof slotQuerySchema>): Promise<SlotsDto>;
  appointments(
    orgId: string,
    query?: z.input<typeof appointmentQuerySchema>,
  ): Promise<AppointmentDto[]>;
  /** 409 `slot_unavailable` when the staff member is already booked (checked atomically). */
  bookAppointment(
    orgId: string,
    appointment: z.input<typeof createAppointmentSchema>,
  ): Promise<AppointmentDto>;
  appointment(orgId: string, appointmentId: string): Promise<AppointmentDto>;
  updateAppointment(
    orgId: string,
    appointmentId: string,
    change: z.input<typeof updateAppointmentSchema>,
  ): Promise<AppointmentDto>;
  setAppointmentStatus(
    orgId: string,
    appointmentId: string,
    status: z.input<typeof appointmentStatusRequestSchema>,
  ): Promise<AppointmentDto>;
  providerAnalytics(
    orgId: string,
    query?: z.input<typeof analyticsQuerySchema>,
  ): Promise<ProviderAnalyticsDto>;
  /** Appointments on service requests you raised. */
  myAppointments(): Promise<CustomerAppointmentDto[]>;
  /** Public: "Usually responds within …" for a published provider. */
  providerResponseStatus(slug: string): Promise<ResponseStatusDto>;

  // --- Parts (Prompt 21): listings and availability inquiries. No checkout. ---
  /** A provider's listings (branch-scoped members: their branch and organization-wide stock). */
  parts(orgId: string, query?: z.input<typeof partListQuerySchema>): Promise<PartDto[]>;
  part(orgId: string, partId: string): Promise<PartDto>;
  /** `parts.manage`. Sets the initial stock and its confirmation time. */
  createPart(orgId: string, part: CreatePartRequest): Promise<PartDto>;
  replacePart(orgId: string, partId: string, part: PartRequest): Promise<PartDto>;
  deletePart(orgId: string, partId: string): Promise<void>;
  /** Records a stock check (also "still in stock"); counter staff at the stock's branch may call it. */
  confirmPartStock(
    orgId: string,
    partId: string,
    stock: z.input<typeof stockRequestSchema>,
  ): Promise<PartDto>;
  receivedPartInquiries(
    orgId: string,
    query?: z.input<typeof partInquiryQuerySchema>,
  ): Promise<PartInquiryDto[]>;
  /** Answer, or correct an answer. Also confirms the listing's stock. */
  answerPartInquiry(
    orgId: string,
    inquiryId: string,
    answer: AnswerPartInquiry,
  ): Promise<PartInquiryDto>;
  /** Public search. `signedIn` gives exact distances and allows `vehicleId`. */
  searchParts(
    query?: z.input<typeof partSearchQuerySchema>,
    options?: { signedIn?: boolean },
  ): Promise<PartSearchResult>;
  publicPart(partId: string): Promise<PublicPart>;
  /** Ask whether a part is available, for yourself or (`orgId`) for your fleet. */
  askAboutPart(inquiry: CreatePartInquiry, options?: { orgId?: string }): Promise<PartInquiryDto>;
  myPartInquiries(
    query?: z.input<typeof partInquiryQuerySchema>,
    options?: { orgId?: string },
  ): Promise<PartInquiryDto[]>;
  closePartInquiry(inquiryId: string, options?: { orgId?: string }): Promise<PartInquiryDto>;

  // --- Referrals (Prompt 21): consent first, relationship disclosed, audited. ---
  /** Suggest another provider for an inquiry you received. It sees nothing until the customer consents. */
  referProvider(orgId: string, recipientId: string, referral: CreateReferral): Promise<ReferralDto>;
  /** Sent referrals, or received ones (only those the customer consented to). */
  providerReferrals(
    orgId: string,
    query?: z.input<typeof referralListQuerySchema>,
  ): Promise<ReferralDto[]>;
  providerReferral(orgId: string, referralId: string): Promise<ReferralDto>;
  withdrawReferral(orgId: string, referralId: string): Promise<ReferralDto>;
  /** Referrals on your request (`orgId`: a fleet's request). */
  requestReferrals(requestId: string, options?: { orgId?: string }): Promise<ReferralDto[]>;
  /** Explicit consent: `consent: true` is required. */
  consentToReferral(
    requestId: string,
    referralId: string,
    consent: ReferralConsent,
    options?: { orgId?: string },
  ): Promise<ReferralDto>;
  declineReferral(
    requestId: string,
    referralId: string,
    options?: { orgId?: string },
  ): Promise<ReferralDto>;

  // --- Fleet operations (Prompt 22). Spending is user-entered, never a verified payment. ---
  /** Managers (`vehicles.manage`); branch-scoped managers see their branch. */
  fleetDashboard(
    orgId: string,
    query?: z.input<typeof dashboardQuerySchema>,
  ): Promise<FleetDashboardDto>;
  fleetIncidents(
    orgId: string,
    query?: z.input<typeof fleetIncidentQuerySchema>,
  ): Promise<FleetIncidentDto[]>;
  /** Managers, or the driver assigned to the vehicle. */
  reportFleetIncident(orgId: string, incident: CreateFleetIncident): Promise<FleetIncidentDto>;
  updateFleetIncident(
    orgId: string,
    incidentId: string,
    change: z.input<typeof updateFleetIncidentSchema>,
  ): Promise<FleetIncidentDto>;
  fleetExpenses(orgId: string, query?: z.input<typeof expenseQuerySchema>): Promise<ExpenseDto[]>;
  addFleetExpense(orgId: string, expense: ExpenseRequest): Promise<ExpenseDto>;
  replaceFleetExpense(
    orgId: string,
    expenseId: string,
    expense: ExpenseRequest,
  ): Promise<ExpenseDto>;
  deleteFleetExpense(orgId: string, expenseId: string): Promise<void>;
  preferredProviders(orgId: string): Promise<PreferredProviderDto[]>;
  addPreferredProvider(
    orgId: string,
    entry: PreferredProviderRequest,
  ): Promise<PreferredProviderDto[]>;
  updatePreferredProvider(
    orgId: string,
    entryId: string,
    change: z.input<typeof updatePreferredProviderSchema>,
  ): Promise<PreferredProviderDto[]>;
  removePreferredProvider(orgId: string, entryId: string): Promise<void>;
  /** A provider's own count of fleets that prefer it. */
  preferredByCount(orgId: string): Promise<{ fleets: number }>;

  // --- Jobs (Prompt 22) ---
  employerJobs(orgId: string, query?: z.input<typeof jobListQuerySchema>): Promise<JobDto[]>;
  employerJob(orgId: string, jobId: string): Promise<JobDto>;
  createJob(orgId: string, job: JobRequest): Promise<JobDto>;
  updateJob(orgId: string, jobId: string, job: JobRequest): Promise<JobDto>;
  /** Live at once for verified employers without scam signs; otherwise `pending_moderation`. */
  publishJob(orgId: string, jobId: string): Promise<JobDto>;
  closeJob(orgId: string, jobId: string): Promise<JobDto>;
  deleteJob(orgId: string, jobId: string): Promise<void>;
  jobApplications(orgId: string, jobId: string): Promise<ApplicationDto[]>;
  setApplicationStatus(
    orgId: string,
    applicationId: string,
    status: z.input<typeof applicationStatusRequestSchema>["status"],
  ): Promise<ApplicationDto>;
  /** Public board (no sign-in). */
  jobs(
    query?: z.input<typeof publicJobQuerySchema>,
  ): Promise<{ items: PublicJob[]; nextOffset: number | null }>;
  job(jobId: string): Promise<PublicJob>;
  applyForJob(jobId: string, application: ApplyRequest): Promise<ApplicationDto>;
  myApplications(): Promise<ApplicationDto[]>;
  withdrawApplication(applicationId: string): Promise<ApplicationDto>;
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

const articlePath = (articleId: string, ...rest: string[]) =>
  ["/v1/me/articles", articleId, ...rest]
    .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
    .join("/");

/** A requester's path: personal (`/v1/me/…`) or a fleet's (`/v1/orgs/:orgId/…`). */
const requesterPath = (orgId: string | undefined, ...rest: string[]) =>
  orgId === undefined
    ? ["/v1/me", ...rest.map(encodeURIComponent)].join("/")
    : orgPath(orgId, ...rest);

const crmPath = (orgId: string, ...rest: string[]) =>
  ["/v1/orgs", orgId, "crm", ...rest]
    .map((p, i) => (i === 0 ? p : encodeURIComponent(p)))
    .join("/");

/** Validates a query object locally, then renders it as a query string. */
function queryString(schema: z.ZodType, query: object | undefined): string {
  if (query === undefined) return "";
  schema.parse(query);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs === "" ? "" : `?${qs}`;
}

const vehiclePath = (...parts: string[]) =>
  ["/v1/vehicles", ...parts.map(encodeURIComponent)].join("/");

const incidentPath = (incidentId: string, ...rest: string[]) =>
  ["/v1/emergency/incidents", incidentId, ...rest]
    .map((p, i) => (i === 0 ? p : encodeURIComponent(p)))
    .join("/");

const conversationPath = (conversationId: string, ...rest: string[]) =>
  ["/v1/conversations", conversationId, ...rest]
    .map((p, i) => (i === 0 ? p : encodeURIComponent(p)))
    .join("/");

const groupPath = (...parts: string[]) =>
  ["/v1/groups", ...parts.map(encodeURIComponent)].join("/");

const MODERATION_SEGMENT: Record<ReportTargetType, string> = {
  article: "articles",
  article_comment: "comments",
  group: "groups",
  user: "users",
  message: "messages",
  job: "jobs",
};

const moderationPath = (targetType: ReportTargetType, targetId: string, ...rest: string[]) =>
  [
    "/v1/moderation",
    MODERATION_SEGMENT[targetType],
    encodeURIComponent(targetId),
    ...rest.map(encodeURIComponent),
  ].join("/");

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
        articleErrorReasonSchema,
        moderationErrorReasonSchema,
        communityErrorReasonSchema,
        messagingErrorReasonSchema,
        emergencyErrorReasonSchema,
        vehicleErrorReasonSchema,
        crmErrorReasonSchema,
        partsErrorReasonSchema,
        referralErrorReasonSchema,
        fleetErrorReasonSchema,
        jobErrorReasonSchema,
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
    searchArticles: async (query = {}) => {
      searchArticlesQuerySchema.parse(query);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        params.set(key, String(value));
      }
      const qs = params.toString();
      return send({
        method: "GET",
        path: `/v1/articles${qs === "" ? "" : `?${qs}`}`,
        schema: articlePageSchema,
        authenticated: false,
      });
    },
    article: (slug) =>
      send({
        method: "GET",
        path: `/v1/articles/${encodeURIComponent(slug)}`,
        schema: publicArticleSchema,
        authenticated: false,
      }),
    articleComments: (slug) =>
      send({
        method: "GET",
        path: `/v1/articles/${encodeURIComponent(slug)}/comments`,
        schema: commentListSchema,
        authenticated: false,
      }),
    createArticle: async (article) =>
      send({
        method: "POST",
        path: "/v1/me/articles",
        schema: myArticleSchema,
        body: createArticleSchema.parse(article),
        authenticated: true,
      }),
    myArticles: () =>
      send({
        method: "GET",
        path: "/v1/me/articles",
        schema: z.array(myArticleSchema),
        authenticated: true,
      }),
    myArticle: (articleId) =>
      send({
        method: "GET",
        path: articlePath(articleId),
        schema: myArticleSchema,
        authenticated: true,
      }),
    updateArticle: async (articleId, change) =>
      send({
        method: "PATCH",
        path: articlePath(articleId),
        schema: myArticleSchema,
        body: updateArticleSchema.parse(change),
        authenticated: true,
      }),
    publishArticle: (articleId) =>
      send({
        method: "POST",
        path: articlePath(articleId, "publish"),
        schema: myArticleSchema,
        authenticated: true,
      }),
    unpublishArticle: (articleId) =>
      send({
        method: "POST",
        path: articlePath(articleId, "unpublish"),
        schema: myArticleSchema,
        authenticated: true,
      }),
    deleteArticle: (articleId) =>
      send({
        method: "DELETE",
        path: articlePath(articleId),
        schema: undefined,
        authenticated: true,
      }),
    createArticleImage: async (file) =>
      send({
        method: "POST",
        path: "/v1/article-images",
        schema: z.object({
          imageId: z.uuid(),
          upload: z.object({
            url: z.string(),
            method: z.literal("PUT"),
            headers: z.record(z.string(), z.string()),
            expiresAt: z.iso.datetime(),
          }),
        }),
        body: createArticleImageSchema.parse(file),
        authenticated: true,
      }),
    completeArticleImage: (imageId) =>
      send({
        method: "POST",
        path: `/v1/article-images/${encodeURIComponent(imageId)}/complete`,
        schema: z.object({ id: z.uuid(), url: z.string() }),
        authenticated: true,
      }),
    bookmarkArticle: (articleId) =>
      send({
        method: "PUT",
        path: `/v1/me/bookmarks/articles/${encodeURIComponent(articleId)}`,
        schema: undefined,
        authenticated: true,
      }),
    unbookmarkArticle: (articleId) =>
      send({
        method: "DELETE",
        path: `/v1/me/bookmarks/articles/${encodeURIComponent(articleId)}`,
        schema: undefined,
        authenticated: true,
      }),
    bookmarkedArticles: () =>
      send({
        method: "GET",
        path: "/v1/me/bookmarks/articles",
        schema: z.array(articleSummarySchema),
        authenticated: true,
      }),
    addComment: async (articleId, comment) =>
      send({
        method: "POST",
        path: `/v1/articles/${encodeURIComponent(articleId)}/comments`,
        schema: articleCommentSchema,
        body: createCommentSchema.parse(comment),
        authenticated: true,
      }),
    editComment: async (commentId, body) =>
      send({
        method: "PATCH",
        path: `/v1/article-comments/${encodeURIComponent(commentId)}`,
        schema: articleCommentSchema,
        body: updateCommentSchema.parse({ body }),
        authenticated: true,
      }),
    deleteComment: (commentId) =>
      send({
        method: "DELETE",
        path: `/v1/article-comments/${encodeURIComponent(commentId)}`,
        schema: undefined,
        authenticated: true,
      }),
    report: async (report) =>
      send({
        method: "POST",
        path: "/v1/reports",
        schema: z.object({ id: z.uuid(), status: z.literal("open") }),
        body: createReportSchema.parse(report),
        authenticated: true,
      }),
    moderationQueue: () =>
      send({
        method: "GET",
        path: "/v1/moderation/queue",
        schema: z.array(moderationQueueItemSchema),
        authenticated: true,
      }),
    moderationCase: (targetType, targetId) =>
      send({
        method: "GET",
        path: moderationPath(targetType, targetId),
        schema: moderationCaseSchema,
        authenticated: true,
      }),
    moderate: (targetType, targetId, decision, reason = null) =>
      send({
        method: "POST",
        path: moderationPath(targetType, targetId, decision),
        schema: moderationCaseSchema,
        body: { reason },
        authenticated: true,
      }),
    socialSettings: () =>
      send({
        method: "GET",
        path: "/v1/me/social-settings",
        schema: socialSettingsSchema,
        authenticated: true,
      }),
    updateSocialSettings: async (change) =>
      send({
        method: "PATCH",
        path: "/v1/me/social-settings",
        schema: socialSettingsSchema,
        body: updateSocialSettingsSchema.parse(change),
        authenticated: true,
      }),
    friends: () =>
      send({
        method: "GET",
        path: "/v1/me/friends",
        schema: z.array(friendSchema),
        authenticated: true,
      }),
    unfriend: (userId) =>
      send({
        method: "DELETE",
        path: `/v1/me/friends/${encodeURIComponent(userId)}`,
        schema: undefined,
        authenticated: true,
      }),
    sendFriendRequest: async (userId) =>
      send({
        method: "POST",
        path: "/v1/me/friend-requests",
        schema: sendFriendRequestResultSchema,
        body: { userId: z.uuid().parse(userId) },
        authenticated: true,
      }),
    friendRequests: (direction = "incoming") =>
      send({
        method: "GET",
        path: `/v1/me/friend-requests?direction=${direction}`,
        schema: z.array(friendRequestSchema),
        authenticated: true,
      }),
    acceptFriendRequest: (requestId) =>
      send({
        method: "POST",
        path: `/v1/me/friend-requests/${encodeURIComponent(requestId)}/accept`,
        schema: friendSchema,
        authenticated: true,
      }),
    declineFriendRequest: (requestId) =>
      send({
        method: "POST",
        path: `/v1/me/friend-requests/${encodeURIComponent(requestId)}/decline`,
        schema: undefined,
        authenticated: true,
      }),
    cancelFriendRequest: (requestId) =>
      send({
        method: "POST",
        path: `/v1/me/friend-requests/${encodeURIComponent(requestId)}/cancel`,
        schema: undefined,
        authenticated: true,
      }),
    blockedUsers: () =>
      send({
        method: "GET",
        path: "/v1/me/blocks",
        schema: z.array(blockedUserSchema),
        authenticated: true,
      }),
    blockUser: (userId) =>
      send({
        method: "PUT",
        path: `/v1/me/blocks/${encodeURIComponent(userId)}`,
        schema: undefined,
        authenticated: true,
      }),
    unblockUser: (userId) =>
      send({
        method: "DELETE",
        path: `/v1/me/blocks/${encodeURIComponent(userId)}`,
        schema: undefined,
        authenticated: true,
      }),
    searchPeople: (q, limit = 20) =>
      send({
        method: "GET",
        path: `/v1/people?${new URLSearchParams({ q, limit: String(limit) }).toString()}`,
        schema: z.array(personSchema),
        authenticated: true,
      }),
    person: (userId) =>
      send({
        method: "GET",
        path: `/v1/people/${encodeURIComponent(userId)}`,
        schema: personProfileSchema,
        authenticated: true,
      }),
    personFriends: (userId) =>
      send({
        method: "GET",
        path: `/v1/people/${encodeURIComponent(userId)}/friends`,
        schema: z.array(friendSchema),
        authenticated: true,
      }),
    searchGroups: async (query = {}) => {
      searchGroupsQuerySchema.parse(query);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) params.set(key, String(value));
      const qs = params.toString();
      return send({
        method: "GET",
        path: `/v1/groups${qs === "" ? "" : `?${qs}`}`,
        schema: groupPageSchema,
        authenticated: false,
      });
    },
    group: (slug) =>
      send({ method: "GET", path: groupPath(slug), schema: groupSchema, authenticated: false }),
    myGroups: () =>
      send({
        method: "GET",
        path: "/v1/me/groups",
        schema: z.array(groupSchema),
        authenticated: true,
      }),
    createGroup: async (group) =>
      send({
        method: "POST",
        path: "/v1/groups",
        schema: groupSchema,
        body: createGroupSchema.parse(group),
        authenticated: true,
      }),
    updateGroup: async (groupId, change) =>
      send({
        method: "PATCH",
        path: groupPath(groupId),
        schema: groupSchema,
        body: updateGroupSchema.parse(change),
        authenticated: true,
      }),
    archiveGroup: (groupId) =>
      send({
        method: "POST",
        path: groupPath(groupId, "archive"),
        schema: undefined,
        authenticated: true,
      }),
    joinGroup: (groupId) =>
      send({
        method: "POST",
        path: groupPath(groupId, "join"),
        schema: groupSchema,
        authenticated: true,
      }),
    leaveGroup: (groupId) =>
      send({
        method: "POST",
        path: groupPath(groupId, "leave"),
        schema: undefined,
        authenticated: true,
      }),
    groupMembers: (groupId, status = "active") =>
      send({
        method: "GET",
        path: `${groupPath(groupId, "members")}?status=${status}`,
        schema: z.array(groupMemberSchema),
        authenticated: true,
      }),
    approveGroupMember: (groupId, userId) =>
      send({
        method: "POST",
        path: groupPath(groupId, "members", userId, "approve"),
        schema: undefined,
        authenticated: true,
      }),
    rejectGroupMember: (groupId, userId) =>
      send({
        method: "POST",
        path: groupPath(groupId, "members", userId, "reject"),
        schema: undefined,
        authenticated: true,
      }),
    setGroupRole: (groupId, userId, role) =>
      send({
        method: "PATCH",
        path: groupPath(groupId, "members", userId),
        schema: undefined,
        body: { role },
        authenticated: true,
      }),
    removeGroupMember: (groupId, userId) =>
      send({
        method: "DELETE",
        path: groupPath(groupId, "members", userId),
        schema: undefined,
        authenticated: true,
      }),
    banFromGroup: (groupId, userId) =>
      send({
        method: "PUT",
        path: groupPath(groupId, "bans", userId),
        schema: undefined,
        authenticated: true,
      }),
    unbanFromGroup: (groupId, userId) =>
      send({
        method: "DELETE",
        path: groupPath(groupId, "bans", userId),
        schema: undefined,
        authenticated: true,
      }),
    conversations: () =>
      send({
        method: "GET",
        path: "/v1/conversations",
        schema: z.array(conversationSchema),
        authenticated: true,
      }),
    conversation: (conversationId) =>
      send({
        method: "GET",
        path: conversationPath(conversationId),
        schema: conversationSchema,
        authenticated: true,
      }),
    openDirectConversation: async (userId) =>
      send({
        method: "POST",
        path: "/v1/conversations/direct",
        schema: conversationSchema,
        body: { userId: z.uuid().parse(userId) },
        authenticated: true,
      }),
    openRequestConversation: async (recipientId) =>
      send({
        method: "POST",
        path: "/v1/conversations/request",
        schema: conversationSchema,
        body: { recipientId: z.uuid().parse(recipientId) },
        authenticated: true,
      }),
    openGroupConversation: async (groupId) =>
      send({
        method: "POST",
        path: "/v1/conversations/group",
        schema: conversationSchema,
        body: { groupId: z.uuid().parse(groupId) },
        authenticated: true,
      }),
    messages: (conversationId, query = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) params.set(key, String(value));
      const qs = params.toString();
      return send({
        method: "GET",
        path: `${conversationPath(conversationId, "messages")}${qs === "" ? "" : `?${qs}`}`,
        schema: messagePageSchema,
        authenticated: true,
      });
    },
    sendMessage: async (conversationId, message) =>
      send({
        method: "POST",
        path: conversationPath(conversationId, "messages"),
        schema: messageSchema,
        body: sendMessageSchema.parse(message),
        authenticated: true,
      }),
    deleteMessage: (conversationId, messageId) =>
      send({
        method: "DELETE",
        path: conversationPath(conversationId, "messages", messageId),
        schema: messageSchema,
        authenticated: true,
      }),
    reportMessage: async (conversationId, messageId, report) =>
      send({
        method: "POST",
        path: conversationPath(conversationId, "messages", messageId, "report"),
        schema: z.object({ id: z.uuid(), status: z.literal("open") }),
        body: reportMessageSchema.parse(report),
        authenticated: true,
      }),
    markConversationRead: (conversationId, seq) =>
      send({
        method: "POST",
        path: conversationPath(conversationId, "read"),
        schema: z.object({ lastReadSeq: z.number().int() }),
        body: { seq },
        authenticated: true,
      }),
    muteConversation: (conversationId, muted) =>
      send({
        method: "PATCH",
        path: conversationPath(conversationId),
        schema: conversationSchema,
        body: { muted },
        authenticated: true,
      }),
    createMessageAttachment: async (conversationId, file) =>
      send({
        method: "POST",
        path: conversationPath(conversationId, "attachments"),
        schema: z.object({
          attachmentId: z.uuid(),
          upload: z.object({
            url: z.string(),
            method: z.literal("PUT"),
            headers: z.record(z.string(), z.string()),
            expiresAt: z.iso.datetime(),
          }),
        }),
        body: createMessageAttachmentSchema.parse(file),
        authenticated: true,
      }),
    completeMessageAttachment: (conversationId, attachmentId) =>
      send({
        method: "POST",
        path: conversationPath(conversationId, "attachments", attachmentId, "complete"),
        schema: z.object({ id: z.uuid(), status: z.literal("available") }),
        authenticated: true,
      }),
    inbox: () =>
      send({ method: "GET", path: "/v1/me/inbox", schema: inboxSchema, authenticated: true }),
    markNotificationRead: (notificationId) =>
      send({
        method: "POST",
        path: `/v1/me/notifications/${encodeURIComponent(notificationId)}/read`,
        schema: undefined,
        authenticated: true,
      }),
    markAllNotificationsRead: () =>
      send({
        method: "POST",
        path: "/v1/me/notifications/read-all",
        schema: undefined,
        authenticated: true,
      }),
    messagingPreferences: () =>
      send({
        method: "GET",
        path: "/v1/me/messaging-preferences",
        schema: messagingPreferencesSchema,
        authenticated: true,
      }),
    updateMessagingPreferences: async (change) =>
      send({
        method: "PATCH",
        path: "/v1/me/messaging-preferences",
        schema: messagingPreferencesSchema,
        body: updateMessagingPreferencesSchema.parse(change),
        authenticated: true,
      }),
    registerDevice: async (device) =>
      send({
        method: "PUT",
        path: "/v1/me/devices",
        schema: undefined,
        body: registerDeviceSchema.parse(device),
        authenticated: true,
      }),
    unregisterDevice: (fid) =>
      send({
        method: "POST",
        path: "/v1/me/devices/unregister",
        schema: undefined,
        body: { fid },
        authenticated: true,
      }),
    realtimeUrl: () => `${baseUrl.replace(/^http/, "ws")}/v1/realtime`,
    emergencyGuidance: (countryCode) =>
      send({
        method: "GET",
        path: `/v1/emergency/guidance${countryCode === undefined ? "" : `?country=${encodeURIComponent(countryCode)}`}`,
        schema: emergencyGuidanceSchema,
        authenticated: false,
      }),
    trustedContacts: () =>
      send({
        method: "GET",
        path: "/v1/me/trusted-contacts",
        schema: z.array(trustedContactSchema),
        authenticated: true,
      }),
    inviteTrustedContact: async (userId, priority = "primary") =>
      send({
        method: "POST",
        path: "/v1/me/trusted-contacts",
        schema: trustedContactSchema,
        body: { userId: z.uuid().parse(userId), priority },
        authenticated: true,
      }),
    respondToTrustedContact: (contactId, accept) =>
      send({
        method: "POST",
        path: `/v1/me/trusted-contacts/${encodeURIComponent(contactId)}/${accept ? "accept" : "decline"}`,
        schema: trustedContactSchema,
        authenticated: true,
      }),
    muteTrustedContact: (contactId, muted) =>
      send({
        method: "POST",
        path: `/v1/me/trusted-contacts/${encodeURIComponent(contactId)}/mute`,
        schema: trustedContactSchema,
        body: { muted },
        authenticated: true,
      }),
    setTrustedContactPriority: (contactId, priority) =>
      send({
        method: "PATCH",
        path: `/v1/me/trusted-contacts/${encodeURIComponent(contactId)}`,
        schema: trustedContactSchema,
        body: { priority },
        authenticated: true,
      }),
    removeTrustedContact: (contactId) =>
      send({
        method: "DELETE",
        path: `/v1/me/trusted-contacts/${encodeURIComponent(contactId)}`,
        schema: undefined,
        authenticated: true,
      }),
    raiseIncident: async (incident) =>
      send({
        method: "POST",
        path: "/v1/emergency/incidents",
        schema: incidentSchema,
        body: createIncidentSchema.parse(incident),
        authenticated: true,
      }),
    myIncidents: () =>
      send({
        method: "GET",
        path: "/v1/emergency/incidents",
        schema: z.array(incidentSchema),
        authenticated: true,
      }),
    incident: (incidentId) =>
      send({
        method: "GET",
        path: incidentPath(incidentId),
        schema: incidentSchema,
        authenticated: true,
      }),
    updateIncidentLocation: (incidentId, location) =>
      send({
        method: "POST",
        path: incidentPath(incidentId, "location"),
        schema: incidentSchema,
        body: { location: { accuracyM: null, ...location } },
        authenticated: true,
      }),
    acknowledgeIncident: (incidentId) =>
      send({
        method: "POST",
        path: incidentPath(incidentId, "acknowledge"),
        schema: incidentSchema,
        authenticated: true,
      }),
    resolveIncident: (incidentId) =>
      send({
        method: "POST",
        path: incidentPath(incidentId, "resolve"),
        schema: incidentSchema,
        body: {},
        authenticated: true,
      }),
    cancelIncident: (incidentId) =>
      send({
        method: "POST",
        path: incidentPath(incidentId, "cancel"),
        schema: incidentSchema,
        body: {},
        authenticated: true,
      }),
    emergencyAlerts: () =>
      send({
        method: "GET",
        path: "/v1/emergency/alerts",
        schema: z.array(incidentSchema),
        authenticated: true,
      }),
    emergencyAssist: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "emergency-assist"),
        schema: z.object({ optedIn: z.boolean(), radiusKm: z.number().int() }),
        authenticated: true,
      }),
    setEmergencyAssist: async (orgId, settings) =>
      send({
        method: "PUT",
        path: orgPath(orgId, "emergency-assist"),
        schema: z.object({ optedIn: z.boolean(), radiusKm: z.number().int() }),
        body: emergencyAssistSettingsSchema.parse(settings),
        authenticated: true,
      }),
    providerEmergencyAlerts: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "emergency-alerts"),
        schema: z.array(providerAlertSchema),
        authenticated: true,
      }),
    offerEmergencyHelp: (orgId, recipientId, message = null) =>
      send({
        method: "POST",
        path: orgPath(orgId, "emergency-alerts", recipientId, "offer"),
        schema: providerAlertSchema,
        body: { message },
        authenticated: true,
      }),
    myVehicles: () =>
      send({
        method: "GET",
        path: "/v1/me/vehicles",
        schema: z.array(vehicleSchema),
        authenticated: true,
      }),
    createVehicle: async (vehicle) =>
      send({
        method: "POST",
        path: "/v1/me/vehicles",
        schema: vehicleSchema,
        body: createVehicleSchema.parse(vehicle),
        authenticated: true,
      }),
    fleetVehicles: (orgId, options) =>
      send({
        method: "GET",
        path: `${orgPath(orgId, "vehicles")}${options?.archived === true ? "?archived=true" : ""}`,
        schema: z.array(vehicleSchema),
        authenticated: true,
      }),
    createFleetVehicle: async (orgId, vehicle) =>
      send({
        method: "POST",
        path: orgPath(orgId, "vehicles"),
        schema: vehicleSchema,
        body: createVehicleSchema.parse(vehicle),
        authenticated: true,
      }),
    vehicle: (vehicleId) =>
      send({
        method: "GET",
        path: vehiclePath(vehicleId),
        schema: vehicleSchema,
        authenticated: true,
      }),
    updateVehicle: async (vehicleId, change) =>
      send({
        method: "PATCH",
        path: vehiclePath(vehicleId),
        schema: vehicleSchema,
        body: updateVehicleSchema.parse(change),
        authenticated: true,
      }),
    archiveVehicle: (vehicleId) =>
      send({
        method: "POST",
        path: vehiclePath(vehicleId, "archive"),
        schema: vehicleSchema,
        authenticated: true,
      }),
    reportOdometer: (vehicleId, odometerKm) =>
      send({
        method: "POST",
        path: vehiclePath(vehicleId, "odometer"),
        schema: vehicleSchema,
        body: { odometerKm },
        authenticated: true,
      }),
    assignDriver: async (vehicleId, userId) =>
      send({
        method: "PUT",
        path: vehiclePath(vehicleId, "driver"),
        schema: vehicleSchema,
        body: { userId: z.uuid().parse(userId) },
        authenticated: true,
      }),
    unassignDriver: (vehicleId) =>
      send({
        method: "DELETE",
        path: vehiclePath(vehicleId, "driver"),
        schema: vehicleSchema,
        authenticated: true,
      }),
    serviceHistory: (vehicleId) =>
      send({
        method: "GET",
        path: vehiclePath(vehicleId, "service-records"),
        schema: serviceHistorySchema,
        authenticated: true,
      }),
    addServiceRecord: async (vehicleId, record) =>
      send({
        method: "POST",
        path: vehiclePath(vehicleId, "service-records"),
        schema: serviceRecordSchema,
        body: createServiceRecordSchema.parse(record),
        authenticated: true,
      }),
    deleteServiceRecord: (vehicleId, recordId) =>
      send({
        method: "DELETE",
        path: vehiclePath(vehicleId, "service-records", recordId),
        schema: undefined,
        authenticated: true,
      }),
    addProviderServiceRecord: async (orgId, recipientId, record) =>
      send({
        method: "POST",
        path: orgPath(orgId, "inquiries", recipientId, "service-record"),
        schema: serviceRecordSchema,
        body: providerServiceRecordSchema.parse(record),
        authenticated: true,
      }),
    maintenanceSchedules: (vehicleId) =>
      send({
        method: "GET",
        path: vehiclePath(vehicleId, "schedules"),
        schema: z.array(maintenanceScheduleSchema),
        authenticated: true,
      }),
    addMaintenanceSchedule: async (vehicleId, schedule) =>
      send({
        method: "POST",
        path: vehiclePath(vehicleId, "schedules"),
        schema: maintenanceScheduleSchema,
        body: scheduleSchema.parse(schedule),
        authenticated: true,
      }),
    updateMaintenanceSchedule: async (vehicleId, scheduleId, schedule) =>
      send({
        method: "PUT",
        path: vehiclePath(vehicleId, "schedules", scheduleId),
        schema: maintenanceScheduleSchema,
        body: scheduleSchema.parse(schedule),
        authenticated: true,
      }),
    removeMaintenanceSchedule: (vehicleId, scheduleId) =>
      send({
        method: "DELETE",
        path: vehiclePath(vehicleId, "schedules", scheduleId),
        schema: undefined,
        authenticated: true,
      }),
    completeMaintenance: async (vehicleId, scheduleId, done) =>
      send({
        method: "POST",
        path: vehiclePath(vehicleId, "schedules", scheduleId, "complete"),
        schema: maintenanceScheduleSchema,
        body: completeScheduleSchema.parse(done),
        authenticated: true,
      }),
    vehicleDocuments: (vehicleId) =>
      send({
        method: "GET",
        path: vehiclePath(vehicleId, "documents"),
        schema: z.array(vehicleDocumentSchema),
        authenticated: true,
      }),
    createVehicleDocument: async (vehicleId, document) =>
      send({
        method: "POST",
        path: vehiclePath(vehicleId, "documents"),
        schema: z.object({
          document: vehicleDocumentSchema,
          upload: z.object({
            url: z.string(),
            method: z.literal("PUT"),
            headers: z.record(z.string(), z.string()),
            expiresAt: z.iso.datetime(),
          }),
        }),
        body: createVehicleDocumentSchema.parse(document),
        authenticated: true,
      }),
    completeVehicleDocument: (vehicleId, documentId) =>
      send({
        method: "POST",
        path: vehiclePath(vehicleId, "documents", documentId, "complete"),
        schema: vehicleDocumentSchema,
        authenticated: true,
      }),
    updateVehicleDocument: async (vehicleId, documentId, change) =>
      send({
        method: "PATCH",
        path: vehiclePath(vehicleId, "documents", documentId),
        schema: vehicleDocumentSchema,
        body: updateVehicleDocumentSchema.parse(change),
        authenticated: true,
      }),
    deleteVehicleDocument: (vehicleId, documentId) =>
      send({
        method: "DELETE",
        path: vehiclePath(vehicleId, "documents", documentId),
        schema: undefined,
        authenticated: true,
      }),
    shareVehicleDocument: async (vehicleId, documentId, share) =>
      send({
        method: "POST",
        path: vehiclePath(vehicleId, "documents", documentId, "shares"),
        schema: createdDocumentShareSchema,
        body: createDocumentShareSchema.parse(share),
        authenticated: true,
      }),
    documentShares: (vehicleId, documentId) =>
      send({
        method: "GET",
        path: vehiclePath(vehicleId, "documents", documentId, "shares"),
        schema: z.array(documentShareSchema),
        authenticated: true,
      }),
    revokeDocumentShare: (vehicleId, documentId, shareId) =>
      send({
        method: "DELETE",
        path: vehiclePath(vehicleId, "documents", documentId, "shares", shareId),
        schema: undefined,
        authenticated: true,
      }),
    crmPipeline: (orgId, query) =>
      send({
        method: "GET",
        path: `${crmPath(orgId, "pipeline")}${queryString(pipelineQuerySchema, query)}`,
        schema: pipelineSchema,
        authenticated: true,
      }),
    crmInquiry: (orgId, recipientId) =>
      send({
        method: "GET",
        path: crmPath(orgId, "inquiries", recipientId),
        schema: crmInquirySchema,
        authenticated: true,
      }),
    updateCrmInquiry: async (orgId, recipientId, change) =>
      send({
        method: "PATCH",
        path: crmPath(orgId, "inquiries", recipientId),
        schema: crmInquirySchema,
        body: updateInquiryCrmSchema.parse(change),
        authenticated: true,
      }),
    addInquiryNote: async (orgId, recipientId, body) =>
      send({
        method: "POST",
        path: crmPath(orgId, "inquiries", recipientId, "notes"),
        schema: crmInquirySchema,
        body: inquiryNoteRequestSchema.parse({ body }),
        authenticated: true,
      }),
    deleteInquiryNote: (orgId, recipientId, noteId) =>
      send({
        method: "DELETE",
        path: crmPath(orgId, "inquiries", recipientId, "notes", noteId),
        schema: undefined,
        authenticated: true,
      }),
    crmQuotes: (orgId, query) =>
      send({
        method: "GET",
        path: `${crmPath(orgId, "quotes")}${queryString(quoteListQuerySchema, query)}`,
        schema: z.array(crmQuoteSchema),
        authenticated: true,
      }),
    crmTasks: (orgId, query) =>
      send({
        method: "GET",
        path: `${crmPath(orgId, "tasks")}${queryString(taskQuerySchema, query)}`,
        schema: z.array(crmTaskSchema),
        authenticated: true,
      }),
    createCrmTask: async (orgId, task) =>
      send({
        method: "POST",
        path: crmPath(orgId, "tasks"),
        schema: crmTaskSchema,
        body: createTaskSchema.parse(task),
        authenticated: true,
      }),
    updateCrmTask: async (orgId, taskId, change) =>
      send({
        method: "PATCH",
        path: crmPath(orgId, "tasks", taskId),
        schema: crmTaskSchema,
        body: updateTaskSchema.parse(change),
        authenticated: true,
      }),
    deleteCrmTask: (orgId, taskId) =>
      send({
        method: "DELETE",
        path: crmPath(orgId, "tasks", taskId),
        schema: undefined,
        authenticated: true,
      }),
    crmStaff: (orgId) =>
      send({
        method: "GET",
        path: crmPath(orgId, "staff"),
        schema: z.array(staffMemberSchema),
        authenticated: true,
      }),
    setStaffAvailability: async (orgId, userId, availability) =>
      send({
        method: "PUT",
        path: crmPath(orgId, "staff", userId, "availability"),
        schema: z.array(staffMemberSchema),
        body: staffAvailabilityRequestSchema.parse(availability),
        authenticated: true,
      }),
    addStaffTimeOff: async (orgId, userId, timeOff) =>
      send({
        method: "POST",
        path: crmPath(orgId, "staff", userId, "time-off"),
        schema: z.array(staffMemberSchema),
        body: timeOffRequestSchema.parse(timeOff),
        authenticated: true,
      }),
    removeStaffTimeOff: (orgId, userId, timeOffId) =>
      send({
        method: "DELETE",
        path: crmPath(orgId, "staff", userId, "time-off", timeOffId),
        schema: undefined,
        authenticated: true,
      }),
    appointmentSlots: async (orgId, query) =>
      send({
        method: "GET",
        path: `${crmPath(orgId, "slots")}${queryString(slotQuerySchema, query)}`,
        schema: slotsSchema,
        authenticated: true,
      }),
    appointments: (orgId, query) =>
      send({
        method: "GET",
        path: `${crmPath(orgId, "appointments")}${queryString(appointmentQuerySchema, query)}`,
        schema: z.array(appointmentSchema),
        authenticated: true,
      }),
    bookAppointment: async (orgId, appointment) =>
      send({
        method: "POST",
        path: crmPath(orgId, "appointments"),
        schema: appointmentSchema,
        body: createAppointmentSchema.parse(appointment),
        authenticated: true,
      }),
    appointment: (orgId, appointmentId) =>
      send({
        method: "GET",
        path: crmPath(orgId, "appointments", appointmentId),
        schema: appointmentSchema,
        authenticated: true,
      }),
    updateAppointment: async (orgId, appointmentId, change) =>
      send({
        method: "PATCH",
        path: crmPath(orgId, "appointments", appointmentId),
        schema: appointmentSchema,
        body: updateAppointmentSchema.parse(change),
        authenticated: true,
      }),
    setAppointmentStatus: async (orgId, appointmentId, status) =>
      send({
        method: "POST",
        path: crmPath(orgId, "appointments", appointmentId, "status"),
        schema: appointmentSchema,
        body: appointmentStatusRequestSchema.parse(status),
        authenticated: true,
      }),
    providerAnalytics: (orgId, query) =>
      send({
        method: "GET",
        path: `${crmPath(orgId, "analytics")}${queryString(analyticsQuerySchema, query)}`,
        schema: providerAnalyticsSchema,
        authenticated: true,
      }),
    myAppointments: () =>
      send({
        method: "GET",
        path: "/v1/me/appointments",
        schema: z.array(customerAppointmentSchema),
        authenticated: true,
      }),
    providerResponseStatus: (slug) =>
      send({
        method: "GET",
        path: `/v1/providers/${encodeURIComponent(slug)}/response-status`,
        schema: responseStatusSchema,
        authenticated: false,
      }),
    parts: (orgId, query) =>
      send({
        method: "GET",
        path: `${orgPath(orgId, "parts")}${queryString(partListQuerySchema, query)}`,
        schema: z.array(partSchema),
        authenticated: true,
      }),
    part: (orgId, partId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "parts", partId),
        schema: partSchema,
        authenticated: true,
      }),
    createPart: async (orgId, part) =>
      send({
        method: "POST",
        path: orgPath(orgId, "parts"),
        schema: partSchema,
        body: createPartRequestSchema.parse(part),
        authenticated: true,
      }),
    replacePart: async (orgId, partId, part) =>
      send({
        method: "PUT",
        path: orgPath(orgId, "parts", partId),
        schema: partSchema,
        body: partRequestSchema.parse(part),
        authenticated: true,
      }),
    deletePart: (orgId, partId) =>
      send({
        method: "DELETE",
        path: orgPath(orgId, "parts", partId),
        schema: undefined,
        authenticated: true,
      }),
    confirmPartStock: async (orgId, partId, stock) =>
      send({
        method: "PUT",
        path: orgPath(orgId, "parts", partId, "stock"),
        schema: partSchema,
        body: stockRequestSchema.parse(stock),
        authenticated: true,
      }),
    receivedPartInquiries: (orgId, query) =>
      send({
        method: "GET",
        path: `${orgPath(orgId, "received-part-inquiries")}${queryString(partInquiryQuerySchema, query)}`,
        schema: z.array(partInquirySchema),
        authenticated: true,
      }),
    answerPartInquiry: async (orgId, inquiryId, answer) =>
      send({
        method: "POST",
        path: orgPath(orgId, "received-part-inquiries", inquiryId, "answer"),
        schema: partInquirySchema,
        body: answerPartInquirySchema.parse(answer),
        authenticated: true,
      }),
    searchParts: (query, options) =>
      send({
        method: "GET",
        path: `/v1/parts${options?.signedIn ? "/full" : ""}${queryString(partSearchQuerySchema, query)}`,
        schema: partSearchResultSchema,
        authenticated: options?.signedIn === true,
      }),
    publicPart: (partId) =>
      send({
        method: "GET",
        path: `/v1/parts/${encodeURIComponent(partId)}`,
        schema: publicPartSchema,
        authenticated: false,
      }),
    askAboutPart: async (inquiry, options) =>
      send({
        method: "POST",
        path: requesterPath(options?.orgId, "part-inquiries"),
        schema: partInquirySchema,
        body: createPartInquirySchema.parse(inquiry),
        authenticated: true,
      }),
    myPartInquiries: (query, options) =>
      send({
        method: "GET",
        path: `${requesterPath(options?.orgId, "part-inquiries")}${queryString(partInquiryQuerySchema, query)}`,
        schema: z.array(partInquirySchema),
        authenticated: true,
      }),
    closePartInquiry: (inquiryId, options) =>
      send({
        method: "POST",
        path: requesterPath(options?.orgId, "part-inquiries", inquiryId, "close"),
        schema: partInquirySchema,
        authenticated: true,
      }),
    referProvider: async (orgId, recipientId, referral) =>
      send({
        method: "POST",
        path: orgPath(orgId, "inquiries", recipientId, "referrals"),
        schema: referralSchema,
        body: createReferralSchema.parse(referral),
        authenticated: true,
      }),
    providerReferrals: (orgId, query) =>
      send({
        method: "GET",
        path: `${orgPath(orgId, "referrals")}${queryString(referralListQuerySchema, query)}`,
        schema: z.array(referralSchema),
        authenticated: true,
      }),
    providerReferral: (orgId, referralId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "referrals", referralId),
        schema: referralSchema,
        authenticated: true,
      }),
    withdrawReferral: (orgId, referralId) =>
      send({
        method: "POST",
        path: orgPath(orgId, "referrals", referralId, "withdraw"),
        schema: referralSchema,
        authenticated: true,
      }),
    requestReferrals: (requestId, options) =>
      send({
        method: "GET",
        path: requesterPath(options?.orgId, "service-requests", requestId, "referrals"),
        schema: z.array(referralSchema),
        authenticated: true,
      }),
    consentToReferral: async (requestId, referralId, consent, options) =>
      send({
        method: "POST",
        path: requesterPath(
          options?.orgId,
          "service-requests",
          requestId,
          "referrals",
          referralId,
          "consent",
        ),
        schema: referralSchema,
        body: referralConsentSchema.parse(consent),
        authenticated: true,
      }),
    declineReferral: (requestId, referralId, options) =>
      send({
        method: "POST",
        path: requesterPath(
          options?.orgId,
          "service-requests",
          requestId,
          "referrals",
          referralId,
          "decline",
        ),
        schema: referralSchema,
        authenticated: true,
      }),
    fleetDashboard: (orgId, query) =>
      send({
        method: "GET",
        path: `${orgPath(orgId, "fleet", "dashboard")}${queryString(dashboardQuerySchema, query)}`,
        schema: fleetDashboardSchema,
        authenticated: true,
      }),
    fleetIncidents: (orgId, query) =>
      send({
        method: "GET",
        path: `${orgPath(orgId, "fleet", "incidents")}${queryString(fleetIncidentQuerySchema, query)}`,
        schema: z.array(fleetIncidentSchema),
        authenticated: true,
      }),
    reportFleetIncident: async (orgId, incident) =>
      send({
        method: "POST",
        path: orgPath(orgId, "fleet", "incidents"),
        schema: fleetIncidentSchema,
        body: createFleetIncidentSchema.parse(incident),
        authenticated: true,
      }),
    updateFleetIncident: async (orgId, incidentId, change) =>
      send({
        method: "PATCH",
        path: orgPath(orgId, "fleet", "incidents", incidentId),
        schema: fleetIncidentSchema,
        body: updateFleetIncidentSchema.parse(change),
        authenticated: true,
      }),
    fleetExpenses: (orgId, query) =>
      send({
        method: "GET",
        path: `${orgPath(orgId, "fleet", "expenses")}${queryString(expenseQuerySchema, query)}`,
        schema: z.array(expenseSchema),
        authenticated: true,
      }),
    addFleetExpense: async (orgId, expense) =>
      send({
        method: "POST",
        path: orgPath(orgId, "fleet", "expenses"),
        schema: expenseSchema,
        body: expenseRequestSchema.parse(expense),
        authenticated: true,
      }),
    replaceFleetExpense: async (orgId, expenseId, expense) =>
      send({
        method: "PUT",
        path: orgPath(orgId, "fleet", "expenses", expenseId),
        schema: expenseSchema,
        body: expenseRequestSchema.parse(expense),
        authenticated: true,
      }),
    deleteFleetExpense: (orgId, expenseId) =>
      send({
        method: "DELETE",
        path: orgPath(orgId, "fleet", "expenses", expenseId),
        schema: undefined,
        authenticated: true,
      }),
    preferredProviders: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "fleet", "preferred-providers"),
        schema: z.array(preferredProviderSchema),
        authenticated: true,
      }),
    addPreferredProvider: async (orgId, entry) =>
      send({
        method: "POST",
        path: orgPath(orgId, "fleet", "preferred-providers"),
        schema: z.array(preferredProviderSchema),
        body: preferredProviderRequestSchema.parse(entry),
        authenticated: true,
      }),
    updatePreferredProvider: async (orgId, entryId, change) =>
      send({
        method: "PATCH",
        path: orgPath(orgId, "fleet", "preferred-providers", entryId),
        schema: z.array(preferredProviderSchema),
        body: updatePreferredProviderSchema.parse(change),
        authenticated: true,
      }),
    removePreferredProvider: (orgId, entryId) =>
      send({
        method: "DELETE",
        path: orgPath(orgId, "fleet", "preferred-providers", entryId),
        schema: undefined,
        authenticated: true,
      }),
    preferredByCount: (orgId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "preferred-by"),
        schema: preferredByCountSchema,
        authenticated: true,
      }),
    employerJobs: (orgId, query) =>
      send({
        method: "GET",
        path: `${orgPath(orgId, "jobs")}${queryString(jobListQuerySchema, query)}`,
        schema: z.array(jobSchema),
        authenticated: true,
      }),
    employerJob: (orgId, jobId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "jobs", jobId),
        schema: jobSchema,
        authenticated: true,
      }),
    createJob: async (orgId, job) =>
      send({
        method: "POST",
        path: orgPath(orgId, "jobs"),
        schema: jobSchema,
        body: jobRequestSchema.parse(job),
        authenticated: true,
      }),
    updateJob: async (orgId, jobId, job) =>
      send({
        method: "PUT",
        path: orgPath(orgId, "jobs", jobId),
        schema: jobSchema,
        body: jobRequestSchema.parse(job),
        authenticated: true,
      }),
    publishJob: (orgId, jobId) =>
      send({
        method: "POST",
        path: orgPath(orgId, "jobs", jobId, "publish"),
        schema: jobSchema,
        authenticated: true,
      }),
    closeJob: (orgId, jobId) =>
      send({
        method: "POST",
        path: orgPath(orgId, "jobs", jobId, "close"),
        schema: jobSchema,
        authenticated: true,
      }),
    deleteJob: (orgId, jobId) =>
      send({
        method: "DELETE",
        path: orgPath(orgId, "jobs", jobId),
        schema: undefined,
        authenticated: true,
      }),
    jobApplications: (orgId, jobId) =>
      send({
        method: "GET",
        path: orgPath(orgId, "jobs", jobId, "applications"),
        schema: z.array(applicationSchema),
        authenticated: true,
      }),
    setApplicationStatus: async (orgId, applicationId, status) =>
      send({
        method: "PATCH",
        path: orgPath(orgId, "job-applications", applicationId),
        schema: applicationSchema,
        body: applicationStatusRequestSchema.parse({ status }),
        authenticated: true,
      }),
    jobs: (query) =>
      send({
        method: "GET",
        path: `/v1/jobs${queryString(publicJobQuerySchema, query)}`,
        schema: publicJobListSchema,
        authenticated: false,
      }),
    job: (jobId) =>
      send({
        method: "GET",
        path: `/v1/jobs/${encodeURIComponent(jobId)}`,
        schema: publicJobSchema,
        authenticated: false,
      }),
    applyForJob: async (jobId, application) =>
      send({
        method: "POST",
        path: `/v1/jobs/${encodeURIComponent(jobId)}/applications`,
        schema: applicationSchema,
        body: applyRequestSchema.parse(application),
        authenticated: true,
      }),
    myApplications: () =>
      send({
        method: "GET",
        path: "/v1/me/job-applications",
        schema: z.array(applicationSchema),
        authenticated: true,
      }),
    withdrawApplication: (applicationId) =>
      send({
        method: "POST",
        path: `/v1/me/job-applications/${encodeURIComponent(applicationId)}/withdraw`,
        schema: applicationSchema,
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
