<!-- Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later -->
# Turbo Ogre onboarding

Content-forge consumes the public [Turbo Ogre SDK](https://github.com/turbo-ogre/sdk).
Its development dependency is pinned to a reviewed Git commit. The consumer owns
`hosting.json`, its review-site selection, and the built artifact. It does not
import hosting/auth internals or install gateway configuration.

## Prepare a review-site candidate

```sh
npm ci --ignore-scripts
npm run hosting:check
npm run review:cohort -- --cohort review/cohorts/survival-stone.json
npm run review:cohort -- --cohort review/cohorts/survival-plants.json
npm run review:cohort -- --family ingots
npm run hosting:bundle
```

Build the ingot candidate first with the retained-source export workflow in
[item-family-review.md](item-family-review.md) when its latest export is absent.
The model export needs the configured Blockbench checkout/editor; the bundle
step needs only completed sheets, Node, and Python 3's standard library. There
is no editor or game process on the future web-serving path.

`review/site.json` explicitly selects up to 12 sheets; each sheet contains at
most 12 entries. Packaging checks its HTML against the evidence hash and includes
only the selected HTML/JSON, an index, and a hash manifest. Unknown files under
`work/reviews/` are excluded. Inputs escaping that directory are refused. The
archive normalizes ownership, timestamps, and ordering for repeatable bytes.

The resulting `work/hosting/review-site.tar.gz` contains candidate artwork, with
sources embedded in the sheets. `bundle-receipt.json` records its SHA-256.
Neither packaging nor hosting grants approval or publishes a Minecraft pack.
The current site has three sheets and 14 entries. Notes still need to be exported
from each browser page; there is no shared review database in this static site.

## Register and store the artifact

Run from this repository's Actions identity with `permissions: id-token: write`:

```sh
export TURBO_OGRE_URL='https://t1.jrepp.com/hosting'
export TURBO_OGRE_AUDIENCE='https://hosting.jrepp.com'
npm run hosting:register
npm run hosting:publish -- --channel canary
npm run hosting:status
```

The URL and audience are environment configuration supplied by the platform.
The initial values above match the existing fleet; changing the branding does
not change the issuer's audience. No host, auth-admin, or permanent CI credential
belongs in this repository. The SDK obtains a short-lived Actions token or uses
an explicitly supplied `TURBO_OGRE_TOKEN` for operator workflows.

`hosting:status` reports the registered declaration. `hosting:publish` stores
bytes and verifies the receipt. **These commands do not deploy a website.**
The current backend does not implement runtime provisioning, version retention,
or browser group authorization. `hosting.json` intentionally declares only the
supported v1 artifact contract; unknown future deployment fields are refused.

## Hosting target and remaining work

The requested target is `https://content-forge.jrepp.com`, on Artemis through
the jrepp.com gateway, with exact `content-forge` group membership required.
The auth group was created on 2026-09-08 and initially has no members. Users can
request access through the auth portal's existing admin-reviewed request flow.
Group creation alone does not enable a protected website.

The fleet still needs the reusable browser authorization interface, Artemis
runtime placement, a private origin route, DNS/certificate coverage, and live
allow/deny checks. No public route or Artemis web service was installed during
this SDK onboarding. Serving the sheets on the auth origin or sharing its cookie
across subdomains would break the intended project boundary.

The fleet's RFC-008 records the next `plan`, `apply`, deployment `status`,
`rollback`, and delegated access interfaces. Those changes belong behind the
SDK; future consumers should onboard by editing their declaration and calling
the same client, without reaching into backend repositories.

## Progress at 2026-09-08

The source/export/review workflow is established and validated. Content quality
remains the priority: the queue has 1,330 actionable entries, including 1,306
item models. The current ingots need silhouette/material refinement; fern and
mushroom candidates need further art review. The quality gate remains held, and
no candidate received artistic approval through these infrastructure changes.

Next content work should choose one bounded family, refine its retained sources
against the Minecraft style standard, review its sheet, then validate the chosen
assets in Minosoft. Broad placeholder generation does not reduce that backlog.
