# Pricing coverage, live card scan and money tone

**Production intent:** Live app. Real users and real ledger data; full validation, auth on
every route, and no AI-invented prices.

Source: design review `docs/reviews/2026-09-19-expo-design-review.md` (F1-F8).

## What it does

1. **Money tone.** Signed money is green when positive, red when negative and neutral at zero or
   unknown, on every screen.
2. **Sealed values.** Packs, booster boxes, ETBs/box sets, collections, decks and cases can be
   priced from free TCGCSV data. New and unmapped products get a suggested match to confirm in
   one tap. Stock shows unit value, holding value and unrealized P&L.
3. **Set sync.** New sets (for example Pokémon 30th Celebration, Lorcana, One Piece) appear
   automatically from TCGCSV each day. Recent releases lead the set suggestions.
4. **Live scan.** Point the camera at cards. Each recognized card joins a list with its market
   price, and one confirm adds all of them. This works in Rip (hit values feed FIFO allocation)
   and in a new "Add singles" flow.
5. **Vision redundancy.** Card reading falls back across AI providers, so one outage doesn't stop scanning.

## Who it's for
Joseph and the two other members recording purchases, rips and sales from a phone.

## Core requirements

- Money stays in integer cents end to end. Market values stay estimates: never cost basis,
  never realized profit.
- Mapping confirmation stays a human action. Suggestions only prefill.
- AI returns identity only. Prices come only from TCGCSV (free). Slabs stay manual.
- Vision providers are tried in configured order, and a provider with no API key is skipped.
  We fall back on timeout, 429/5xx, or an unparseable/empty response. Default chain: Gemini
  Flash-Lite -> Groq (vision model) -> Claude Haiku 4.5 -> OpenAI-compatible (model by env).
  Each provider has its own key and model env var, and all use the same prompt and parser.
  The response records which provider answered.
- Live scan sends a downscaled frame (≤640px JPEG) about every 1.2s, and only while the frame is
  steady. Results are deduped by normalized (name, set, number, variant) within a session.
  A per-member rate limit and daily frame cap replace the global 3s throttle. Hitting the cap
  falls back to tap-to-capture.
- Camera permission denied -> manual entry still works. Web client -> existing photo picker.

## Out of scope
Paid price feeds, slab auto-pricing, graded-card scan, social/deck features, and a
continuous on-device ML recognizer.

## Success looks like
- A loss is visibly red on Home, Stock, Sales, Money, Reports and Vault.
- An ETB bought today shows a market value after one confirm tap and the next refresh.
- 30th Celebration is the first Pokémon suggestion without typing.
- Ripping a pack: scan 5 hits in under 30 seconds, each with a price, and the allocation previews correctly.
- Disabling the Gemini key in staging: scanning still works via the next provider.

## Delivery slices (one PR each)
A `fix/money-tone` -> B `feat/sealed-pricing` -> C `feat/set-catalog-sync` -> D `feat/live-card-scan`
(D1 backend lookup + provider chain, D2 app scanner + flows). B's auto-suggest is better with
C's group ids, but it degrades to a name search within the game's category.

## Open questions
- OpenAI-compatible slot: which exact model ID should "Luna" map to (it must be available on the
  public API)? The slot ships disabled until a key and model are set.
