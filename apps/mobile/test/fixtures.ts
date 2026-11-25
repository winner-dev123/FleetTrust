import {
  COMMUNITY_CONTENT_LABEL,
  type ConversationDto,
  EMERGENCY_DISCLAIMER,
  INCIDENT_CATEGORY_LABELS,
  type IncidentDto,
  INDICATIVE_PRICE_DISCLAIMER,
  type MessageDto,
  PAYMENT_DISCLAIMER,
  type ProviderSearchResult,
  type PublicProviderProfile,
  QUOTE_SCAM_WARNING,
  type ServiceRequestDto,
  type TrustedContactDto,
} from "@fleettrust/types";

/** Schema-valid API data for screen tests (the SDK rejects anything off-contract). */

export const NOW = "2026-11-24T10:00:00.000Z";
export const IDS = {
  user: "0190c000-0000-7000-8000-000000000001",
  acme: "0190c000-0000-7000-8000-00000000a001",
  acmeBranch: "0190c000-0000-7000-8000-00000000a002",
  request: "0190c000-0000-7000-8000-00000000b001",
  recipient: "0190c000-0000-7000-8000-00000000b002",
  quote: "0190c000-0000-7000-8000-00000000b003",
  conversation: "0190c000-0000-7000-8000-00000000c001",
  contactUser: "0190c000-0000-7000-8000-00000000d001",
  contact: "0190c000-0000-7000-8000-00000000d002",
  incident: "0190c000-0000-7000-8000-00000000e001",
  article: "0190c000-0000-7000-8000-00000000f001",
} as const;

const openStatus = {
  known: true,
  isOpen: true,
  localTime: "2026-11-24T10:00",
  closesAt: "2026-11-24T17:00",
  opensAt: null,
  exception: null,
};

export const me = {
  id: IDS.user,
  email: "driver@example.com",
  emailVerified: true,
  displayName: "Sam Driver",
  profileComplete: true,
  timeZone: "Africa/Johannesburg",
  createdAt: NOW,
};

export const searchResult: ProviderSearchResult = {
  branchId: IDS.acmeBranch,
  organizationId: IDS.acme,
  slug: "acme-garage",
  tradingName: "Acme Garage",
  branchName: "Woodstock",
  locality: "Woodstock",
  countryCode: "ZA",
  categories: ["workshop"],
  vehicleTypes: ["car", "van"],
  location: { lng: 18.447, lat: -33.927, approximate: true },
  distanceKm: 2.3,
  serviceRadiusKm: 15,
  coversSearchLocation: true,
  hours: openStatus,
  verification: [
    { badgeType: "business", status: "verified" },
    { badgeType: "location", status: "unverified" },
  ],
  priceHighlights: [{ name: "Brake pad replacement", label: "From ZAR 850.00 per job" }],
  logoUrl: null,
};

export const profile: PublicProviderProfile = {
  organizationId: IDS.acme,
  slug: "acme-garage",
  tradingName: "Acme Garage",
  legalName: "Acme Garage (Pty) Ltd",
  description: "Family workshop since 1998.",
  categories: ["workshop"],
  categoryDetails: {},
  vehicleTypes: ["car"],
  contact: null,
  branches: [
    {
      id: IDS.acmeBranch,
      name: "Woodstock",
      addressLine1: null,
      addressLine2: null,
      locality: "Woodstock",
      region: "Western Cape",
      postalCode: null,
      countryCode: "ZA",
      location: { lng: 18.447, lat: -33.927, approximate: true },
      serviceRadiusKm: 15,
      phone: null,
      timeZone: "Africa/Johannesburg",
      hours: { weekly: null, exceptions: [], status: openStatus },
    },
  ],
  catalog: { disclaimer: INDICATIVE_PRICE_DISCLAIMER, offerings: [] },
  media: [],
  verification: [{ badgeType: "business", status: "verified", expiresAt: null }],
  publishedAt: "2026-10-01T08:00:00.000Z",
};

export function serviceRequest(overrides: Partial<ServiceRequestDto> = {}): ServiceRequestDto {
  return {
    id: IDS.request,
    category: "workshop",
    vehicle: { vehicleType: "car", make: null, model: null, year: null, registration: null },
    description: "Brakes squeal when stopping",
    urgency: "routine",
    neededBy: null,
    status: "open",
    expiresAt: "2026-12-08T10:00:00.000Z",
    createdAt: NOW,
    attachments: [],
    events: [],
    requester: { kind: "user", organizationId: null, createdBy: IDS.user, fleetBranchId: null },
    location: { lat: -33.9249, lng: 18.4241 },
    locationNote: null,
    vehicleId: null,
    recipients: [
      {
        id: IDS.recipient,
        providerOrganizationId: IDS.acme,
        providerName: "Acme Garage",
        providerSlug: "acme-garage",
        status: "quoted",
        quotes: [
          {
            id: IDS.quote,
            recipientId: IDS.recipient,
            providerOrganizationId: IDS.acme,
            price: {
              type: "fixed",
              currency: "ZAR",
              amount: "950",
              unit: "job",
              indicative: true,
              label: "ZAR 950.00 per job",
            },
            message: "We can fit you in tomorrow.",
            availableFrom: null,
            validUntil: "2026-12-01T10:00:00.000Z",
            status: "active",
            createdAt: NOW,
            disclaimer: PAYMENT_DISCLAIMER,
            scamWarning: QUOTE_SCAM_WARNING,
          },
        ],
      },
    ],
    acceptedQuoteId: null,
    agreement: null,
    ...overrides,
  };
}

export const conversation: ConversationDto = {
  id: IDS.conversation,
  kind: "request",
  title: "Acme Garage",
  peer: null,
  serviceRequestRecipientId: IDS.recipient,
  groupId: null,
  lastSeq: 1,
  lastMessageAt: NOW,
  lastReadSeq: 1,
  unread: 0,
  muted: false,
  peerReadSeq: null,
  canSend: true,
  warning: "Never pay to an account you can't verify.",
};

export function message(
  seq: number,
  body: string,
  overrides: Partial<MessageDto> = {},
): MessageDto {
  return {
    id: `0190c000-0000-7000-8000-${(0xc100 + seq).toString(16).padStart(12, "0")}`,
    conversationId: IDS.conversation,
    seq,
    clientMessageId: null,
    sender: { userId: null, name: "Acme Garage", side: "provider", mine: false },
    body,
    attachments: [],
    status: "visible",
    warnings: [],
    createdAt: NOW,
    ...overrides,
  };
}

export const activeContact: TrustedContactDto = {
  id: IDS.contact,
  person: { userId: IDS.contactUser, displayName: "Lerato" },
  role: "my_contact",
  status: "active",
  priority: "primary",
  muted: false,
  createdAt: NOW,
};

export const guidance: IncidentDto["guidance"] = {
  countryCode: "ZA",
  number: "112",
  label: "If anyone is in danger",
  text: "Call 112 from any phone.",
  disclaimer: EMERGENCY_DISCLAIMER,
};

export function incident(body: {
  category: IncidentDto["category"];
  note?: string | null;
}): IncidentDto {
  return {
    id: IDS.incident,
    status: "active",
    category: body.category,
    categoryLabel: INCIDENT_CATEGORY_LABELS[body.category],
    note: body.note ?? null,
    owner: { userId: IDS.user, displayName: "Sam Driver", mine: true },
    location: null,
    locationUpdatedAt: null,
    wave: 1,
    contacts: [
      { userId: IDS.contactUser, displayName: "Lerato", notifiedAt: NOW, acknowledgedAt: null },
    ],
    providerOffers: [],
    conversationId: null,
    flagged: false,
    createdAt: NOW,
    expiresAt: "2026-11-24T22:00:00.000Z",
    closedAt: null,
    guidance,
    disclaimer: EMERGENCY_DISCLAIMER,
  };
}

export const articleSummary = {
  id: IDS.article,
  slug: "checking-tyre-pressure",
  title: "Checking tyre pressure before a long trip",
  summary: "Five minutes that save fuel and tyres.",
  excerpt: "Check your tyres when they are cold...",
  category: "maintenance" as const,
  tags: ["tyres"],
  coverImage: null,
  author: { displayName: "Thandi M", organization: null },
  publishedAt: "2026-11-01T09:00:00.000Z",
  editedAt: null,
  commentCount: 0,
  label: COMMUNITY_CONTENT_LABEL,
};
