import { copy, fill } from "@fleettrust/copy";
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
          <View style={styles.row} accessibilityLabel={copy.provider.verificationLabel}>
            {profile.data.verification.map((badge) => (
              <Badge
                key={badge.badgeType}
                tone={badge.status === "verified" ? "verified" : "caution"}
                label={
                  badge.status === "verified" && badge.expiresAt
                    ? fill(copy.provider.badgeUntil, {
                        label: verificationLabel(badge.badgeType, badge.status),
                        date: formatDate(badge.expiresAt),
                      })
                    : verificationLabel(badge.badgeType, badge.status)
                }
              />
            ))}
          </View>
          <Body small muted>
            {copy.provider.verificationNote}
          </Body>
          <Button
            label={copy.provider.requestQuote}
            onPress={() => {
              router.push(`/requests/new?provider=${encodeURIComponent(profile.data.slug)}`);
            }}
          />
          {profile.data.description ? (
            <Card title={copy.provider.aboutTitle}>
              <Body>{profile.data.description}</Body>
              {profile.data.vehicleTypes.length > 0 ? (
                <Body small>
                  {fill(copy.provider.vehicles, {
                    types: profile.data.vehicleTypes.map((v) => VEHICLE_TYPE_LABELS[v]).join(", "),
                  })}
                </Body>
              ) : null}
            </Card>
          ) : null}
          <Card title={copy.provider.contactTitle}>
            {profile.data.contact ? (
              <>
                {profile.data.contact.phone ? (
                  <Button
                    label={fill(copy.provider.call, { phone: profile.data.contact.phone })}
                    variant="secondary"
                    onPress={() =>
                      void platform.device.openExternal(`tel:${profile.data.contact?.phone ?? ""}`)
                    }
                  />
                ) : null}
                {profile.data.contact.email ? (
                  <Body>{fill(copy.provider.email, { email: profile.data.contact.email })}</Body>
                ) : null}
                {profile.data.contact.website ? (
                  <Body>
                    {fill(copy.provider.website, { website: profile.data.contact.website })}
                  </Body>
                ) : null}
              </>
            ) : (
              <Body muted>{copy.provider.signInForContact}</Body>
            )}
          </Card>
          <Card title={copy.provider.servicesTitle}>
            <Notice>
              <Body small>{profile.data.catalog.disclaimer}</Body>
            </Notice>
            {profile.data.catalog.offerings.length === 0 ? (
              <Body muted>{copy.provider.noServices}</Body>
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
          <Heading level={2}>{copy.provider.branchesTitle}</Heading>
          {profile.data.branches.map((branch) => (
            <Card key={branch.id} title={branch.name}>
              <Body>
                {[branch.addressLine1, branch.locality, branch.region, branch.countryCode]
                  .filter(Boolean)
                  .join(", ")}
              </Body>
              {branch.location.approximate ? (
                <Body small muted>
                  {copy.provider.addressAfterSignIn}
                </Body>
              ) : null}
              <Body>{openingStatusLabel(branch.hours.status)}</Body>
              {branch.serviceRadiusKm ? (
                <Body small>{fill(copy.provider.travelsUpTo, { km: branch.serviceRadiusKm })}</Body>
              ) : null}
              <Body small muted>
                {fill(copy.provider.localTimes, { timeZone: branch.timeZone })}
              </Body>
            </Card>
          ))}
          <Body small muted>
            {fill(copy.provider.published, { date: formatDate(profile.data.publishedAt) })}
          </Body>
        </>
      ) : null}
    </Screen>
  );
}
