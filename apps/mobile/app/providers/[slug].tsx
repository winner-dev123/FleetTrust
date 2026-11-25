import {
  CATEGORY_LABELS,
  formatDate,
  openingStatusLabel,
  VEHICLE_TYPE_LABELS,
  verificationLabel,
} from "@fleettrust/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { ErrorNotice } from "../../src/components/feedback";
import {
  Badge,
  Body,
  Button,
  Card,
  Heading,
  Loading,
  Notice,
  Screen,
  styles,
} from "../../src/components/ui";
import { useLoad } from "../../src/lib/use-load";
import { useSession } from "../../src/state/session";

/** Public provider profile: what they offer, where, when, and what FleetTrust verified. */
export default function ProviderScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { api, status, platform } = useSession();
  const router = useRouter();
  const signedIn = status === "signed-in";
  const profile = useLoad(
    () => api.provider(slug, { signedIn }),
    `provider-${slug}-${String(signedIn)}`,
  );

  return (
    <Screen>
      {profile.status === "loading" ? <Loading /> : null}
      {profile.status === "error" ? (
        <ErrorNotice error={profile.error} onRetry={profile.reload} />
      ) : null}
      {profile.status === "ready" ? (
        <>
          <Heading>{profile.data.tradingName}</Heading>
          <Body muted>{profile.data.categories.map((c) => CATEGORY_LABELS[c]).join(" · ")}</Body>
          <View style={styles.row} accessibilityLabel="Verification">
            {profile.data.verification.map((badge) => (
              <Badge
                key={badge.badgeType}
                tone={badge.status === "verified" ? "verified" : "caution"}
                label={`${verificationLabel(badge.badgeType, badge.status)}${
                  badge.status === "verified" && badge.expiresAt
                    ? ` (until ${formatDate(badge.expiresAt)})`
                    : ""
                }`}
              />
            ))}
          </View>
          <Body small muted>
            Verification means FleetTrust checked documents for that item. It isn&apos;t an
            endorsement or a quality rating, and plans can&apos;t buy it.
          </Body>
          <Button
            label="Request a quote"
            onPress={() => {
              router.push(`/requests/new?provider=${encodeURIComponent(profile.data.slug)}`);
            }}
          />
          {profile.data.description ? (
            <Card title="About">
              <Body>{profile.data.description}</Body>
              {profile.data.vehicleTypes.length > 0 ? (
                <Body small>
                  Vehicles:{" "}
                  {profile.data.vehicleTypes.map((v) => VEHICLE_TYPE_LABELS[v]).join(", ")}
                </Body>
              ) : null}
            </Card>
          ) : null}
          <Card title="Contact">
            {profile.data.contact ? (
              <>
                {profile.data.contact.phone ? (
                  <Button
                    label={`Call ${profile.data.contact.phone}`}
                    variant="secondary"
                    onPress={() =>
                      void platform.device.openExternal(`tel:${profile.data.contact?.phone ?? ""}`)
                    }
                  />
                ) : null}
                {profile.data.contact.email ? (
                  <Body>Email: {profile.data.contact.email}</Body>
                ) : null}
                {profile.data.contact.website ? (
                  <Body>Website: {profile.data.contact.website}</Body>
                ) : null}
              </>
            ) : (
              <Body muted>Sign in to see phone numbers and street addresses.</Body>
            )}
          </Card>
          <Card title="Services and indicative prices">
            <Notice>
              <Body small>{profile.data.catalog.disclaimer}</Body>
            </Notice>
            {profile.data.catalog.offerings.length === 0 ? (
              <Body muted>No services listed yet.</Body>
            ) : null}
            {profile.data.catalog.offerings.map((offering) => (
              <View key={offering.id} style={{ gap: 2 }}>
                <Body>{offering.name}</Body>
                {offering.description ? (
                  <Body small muted>
                    {offering.description}
                  </Body>
                ) : null}
                <Body small>{offering.price.label}</Body>
              </View>
            ))}
          </Card>
          <Heading level={2}>Branches and opening hours</Heading>
          {profile.data.branches.map((branch) => (
            <Card key={branch.id} title={branch.name}>
              <Body>
                {[branch.addressLine1, branch.locality, branch.region, branch.countryCode]
                  .filter(Boolean)
                  .join(", ")}
              </Body>
              {branch.location.approximate ? (
                <Body small muted>
                  Street address shown after you sign in.
                </Body>
              ) : null}
              <Body>{openingStatusLabel(branch.hours.status)}</Body>
              {branch.serviceRadiusKm ? (
                <Body small>Travels up to {branch.serviceRadiusKm} km</Body>
              ) : null}
              <Body small muted>
                Times are local ({branch.timeZone}).
              </Body>
            </Card>
          ))}
          <Body small muted>
            Profile published {formatDate(profile.data.publishedAt)}.
          </Body>
        </>
      ) : null}
    </Screen>
  );
}
