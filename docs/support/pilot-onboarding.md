# Limited pilot onboarding

How FleetTrust admits the first users, keeps the pilot small, and decides when it's ready to open up.

## Who

| Group                                      | Target size         | Why                                                   |
| ------------------------------------------ | ------------------- | ----------------------------------------------------- |
| Providers (workshops, tyre, towing, parts) | 20–50 organisations | Enough listings for search and requests to be useful  |
| Fleets                                     | 3–5 companies       | Exercises fleet vehicles, members and the job board   |
| Individual drivers                         | 100–300             | Messaging, community, requests and emergency contacts |

Pick providers and fleets in one or two metro areas, so drivers find listings near them. The exact numbers are the owner's call.

## Controlling who can sign up

The admin console has the setting **"Limited pilot: who may create an account"** (`signups.pilot_allowlist`; super admins). While it has entries, only people whose **verified** email matches can create an account. Everyone else sees a plain message that FleetTrust is in a limited pilot (`pilot_invite_only`).

- One entry per line: a full address (`jane@acme-transport.example`) or a whole domain (`@acme-transport.example`). Domains are best for fleets and providers with their own email domain.
- People who already have an account keep signing in when the list changes.
- An empty list lets anyone sign up. Clearing it is the switch for opening up.
- **"Pause new sign-ups"** stops all new accounts, for example during an abuse wave. It is separate from the allowlist and takes priority over it.
- Changes are audited, with the before and after.

## Onboarding steps

1. **Invite.** Add the person's email or company domain to the allowlist. Then send the invitation email from the template below, with the website link and the app store links (TestFlight or internal testing during the early pilot).
2. **Providers:**
   - help them create the organisation, fill in the profile, add branches, opening hours and services, then publish;
   - offer verification and explain what each badge means and doesn't mean;
   - assign the pilot plan (billing operator), after payment is confirmed outside FleetTrust if any applies.
3. **Fleets:** create the organisation, invite members (seats), add vehicles.
4. **Drivers:** sign in, add a display name, optionally add a vehicle and **trusted contacts**, and try a test emergency alert with a contact who knows it's a test.
5. **Feedback:** a short weekly check-in for the first month, plus in-app reports. Log issues in GitHub without personal data.

### Invitation email (template)

> Subject: You're invited to the FleetTrust pilot
>
> Hi {name},
>
> You're invited to try FleetTrust, a place to find trusted transport services, message providers and keep your fleet's paperwork in one place. Sign in at {web_url} with this email address ({email}), or get the app: {store_links}.
>
> It's a pilot: things will change, and your feedback shapes them. Reply to this email any time.
>
> FleetTrust is not an emergency service. In an emergency, call your local emergency number.

## Exit criteria (ready to widen the pilot)

- No open critical or high incidents. The SLOs in [slo.md](../operations/slo.md) held for 4 weeks on production traffic.
- Rollback rehearsed on staging and the point-in-time restore drill done ([release-and-rollback.md](../operations/release-and-rollback.md)).
- The Cloud Armor WAF rules have been tuned and switched out of preview ([dns-tls.md](../operations/dns-tls.md)).
- Support has handled real requests within the response targets ([support-playbook.md](support-playbook.md)).
- The owner signs the [go/no-go checklist](../launch/go-no-go.md) for the wider launch.
