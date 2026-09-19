# Mobile task-focused design correction

Production intent: live Vite website unchanged; Expo internal beta only. Joseph approved
the screenshot/user-flow review on September 14. No Hosting cutover is authorized.

## Approved hierarchy

- Mobile: compact brand/account header; Home, Stock, Vault, Sales, More navigation.
  Stock exposes colored Inventory/Store/Vault bucket segments. Money and Reports,
  global New product/New sale remain reachable through More. Desktop destinations remain.
- Dashboard: prominent realized profit, deliberate responsive metric grid, expandable
  detailed period/lifetime breakdowns. Keep period selection and all report/correction paths.
- Product: identity and bucket quantities, explicit remaining cost/realized profit,
  contextual Sell/Move first; management, pricing, transformations, lineage/history disclosed.
- Vault: concise holdings summary, actionable missing valuation, expandable provenance
  and manual/market details. Unknown is never zero; quotes never replace manual appreciation.

Disclosures retain mounted children so collapsing does not discard drafts. All existing
mutations, eligibility rules, confirmations, accounting, errors and retries remain intact.
No API, dependency, auth or financial algorithm changes are required.

## Ownership and acceptance

Luna owns Dashboard/Vault; Astra owns shell, stock segments, Product Detail/shared disclosure
and integration. Architect profile is unavailable; a second implementation spawn hit the
session thread limit. Do not imply fresh independent review when unavailable.

Require lint/types/units, exports and browser financial workflows with explicit disclosure
interactions. Inspect small-screen/long-name/unknown-state layouts. Native keyboard, back,
large-text, persistence and camera/share remain device acceptance gates. A new signed alpha
needs incremented version/code and a fresh receipt from exact CI-green remote main.

Competitor references: [Collectr](https://getcollectr.com/track),
[ManaBox](https://www.manabox.app/guides/collection/getting-started/),
[TCGplayer](https://seller.tcgplayer.com/mobile-app). Borrow task prioritization, not claims
of price coverage or free data access. Free-only TCGCSV/BoC and manual slabs remain policy.

## Implementation checkpoint

Implemented the approved first hierarchy slice. Local lint/typecheck, 120 unit tests,
ruff and diff checks pass. Combined web/Android/iOS fixture exports passed; the final
equal-height card refinement additionally passed types/lint and a fresh web export.
Root inspected Dashboard/Product/Vault fixture screenshots. Browser checks at 320/390/1536
confirm five mobile/seven desktop destinations and no Dashboard horizontal overflow;
pricing drafts survive disclosure toggles and Money remains reachable through More.
Artifacts are ignored under app/output/playwright. The local Docker test DB is not running,
so full financial browser workflows require CI. Fresh Terra review is blocked by the
session thread limit; root integration review is not a substitute for that gate.

Status: first implementation ready for draft PR / CI; no new APK or deployment.
Broader add/scan/rip guided-flow redesign and installed-device acceptance remain separate
follow-up work. This checkpoint changes hierarchy, not every user journey end to end.

## Installed-device follow-up: action-first stock

The next Android alpha replaces the centre Vault destination with a prominent Add action.
It opens Add product and Record sale directly; Vault remains available under the compact
More destination sheet and as a colored Stock location. Stock now keeps all four location
segments on one row, puts Filters beside search, hides default filter prose, suppresses
duplicate set names and unavailable market-price copy, and exposes Rip directly on eligible
sealed stock cards. The existing server preview, FIFO allocation and confirmation workflow
remain authoritative; this is new access to the same mutation, not new client accounting.

Dashboard primary cards use shorter labels and move detailed accounting context into the
existing disclosures. This pass also introduces a text-free 1024px card-stack app icon and
Android adaptive foreground matching the in-app brand. Android 0.1.3 / versionCode 4 is the
planned signed build. Website production remains the Vite app; no hosting cutover is part of
this release.
