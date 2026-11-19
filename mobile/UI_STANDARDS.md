# MCCS app UI standards

These keep every screen looking and behaving the same. When you build or change
a screen, use the shared pieces below instead of styling things by hand.

## Colors

All colors live in `src/constants/theme.ts`.

| Use | Color | Where it comes from |
|---|---|---|
| Header, tab bar, links, secondary buttons | Navy `Brand.navy` (#0C2340) | MCCS website theme color |
| Main action on a screen | Red `Brand.red` (#940000) | Marine Corps style guide |
| Cards and inputs | `theme.card` with a 1px `theme.border` | White with a thin border, like the MCCS store site |
| Prices, section labels | `theme.link` (navy), extra bold | Follows light/dark mode |
| Body text / hints | `theme.text` / `theme.textSecondary` | Follows light/dark mode |
| Links | `theme.link` (navy, light navy in dark mode) | Used by `type="linkPrimary"` |
| Good / warning / problem | `Brand.success` / `Brand.warning` / `Brand.danger` | Status messages |

Don't add new hex colors in screens. The old blue `#3c87f7` is replaced by navy.

## Shared components

- `AppButton` (`components/ui/app-button.tsx`): every button.
  - `primary` (red, filled) for the one main action on a screen
  - `secondary` (navy outline) for other actions
  - `danger` (red outline) for removing things
  - `loading` shows a spinner and blocks double taps
- `BackButton` (`components/ui/back-button.tsx`): every Back link. Goes back,
  or to `from`, or to Home, so it also works after a web refresh.
- `ScreenHeader` (`components/ui/screen-header.tsx`): the navy band with the red
  stripe at the top of every screen, same look as the Home header. Takes `title`,
  an optional small `eyebrow` above it, `subtitle`, Back settings, and `children`
  for anything that belongs in the band (the Likes / History switch). It spans the
  full width, so put it outside the screen's padded content.
- `SectionLabel` (`components/ui/section-label.tsx`): small navy capitals that
  name a section, e.g. TODAY or PRICE.
- `ProductCard`: white card with a border, navy price, red heart when liked, and an
  optional red `badge` such as "#1". A navy left edge marks a selected card, a red
  left edge marks the For You pick.
- Highlights like "Lowest price" are small red pills in capitals.

## Layout

- Screen padding: `Spacing.four` (24) on the sides.
- Gap between sections: `Spacing.three` (16). Inside a card: `Spacing.two` (8).
- Rounding from `Radius`: cards, buttons and inputs `medium` (14), small buttons `small` (8),
  chips `pill`.
- On wide screens, content is centered and at most `MaxContentWidth` (800) wide.

## Text

- Screen title: `ScreenHeader` (28, extra bold, white on navy).
- Section title: `SectionLabel`.
- Body: `ThemedText` default (16). Hints: `type="small"` with `themeColor="textSecondary"`.
- Links: `type="linkPrimary"`.

## Every screen that loads data shows

1. a spinner while loading,
2. a short message and **Try again** if it fails,
3. a helpful empty message when there is nothing to show.

## Navigation

- Inner screens use `ScreenHeader` (or `BackButton`) at the top left, labeled "Back".
- When opening a product, pass `from` with the current page, so Back returns there.
- After finishing an action (saving, comparing), stay on the page and show a short
  message rather than jumping somewhere unexpected.

## Moving between features

Every feature should lead to the next thing a shopper is likely to do:

| From | To | How |
|---|---|---|
| Home | Shopping mode (or a new list) | `ShoppingListShortcut` card under Chesty |
| Product page | Shopping List | Tap the "On your shopping list" line |
| Add to list dialog | Shopping List | "View list" after adding, "Create a shopping list" when there are none |
| Shopping mode scan | Shopping List | "Add it to this list" when the product isn't on it |
| Shopping List, History, Likes, results | Product page | Tap the product. Back returns here (`from`) |
| History | Compare | Tick 2 to 4 products, then Compare |
