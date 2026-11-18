\# MCCS app UI standards



These keep every screen looking and behaving the same. When you build or change

a screen, use the shared pieces below instead of styling things by hand.



\## Colors



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



\## Shared components



\- `AppButton` (`components/ui/app-button.tsx`): every button.

&#x20; - `primary` (red, filled) for the one main action on a screen

&#x20; - `secondary` (navy outline) for other actions

&#x20; - `danger` (red outline) for removing things

&#x20; - `loading` shows a spinner and blocks double taps

\- `BackButton` (`components/ui/back-button.tsx`): every Back link. Goes back,

&#x20; or to `from`, or to Home, so it also works after a web refresh.

\- `ScreenHeader` (`components/ui/screen-header.tsx`): the navy band with the red

&#x20; stripe at the top of every screen, same look as the Home header. Takes `title`,

&#x20; an optional small `eyebrow` above it, `subtitle`, Back settings, and `children`

&#x20; for anything that belongs in the band (the Likes / History switch). It spans the

&#x20; full width, so put it outside the screen's padded content.

\- `SectionLabel` (`components/ui/section-label.tsx`): small navy capitals that

&#x20; name a section, e.g. TODAY or PRICE.

\- `ProductCard`: white card with a border, navy price, red heart when liked, and an

&#x20; optional red `badge` such as "#1". A navy left edge marks a selected card, a red

&#x20; left edge marks the For You pick.

\- Highlights like "Lowest price" are small red pills in capitals.



\## Layout



\- Screen padding: `Spacing.four` (24) on the sides.

\- Gap between sections: `Spacing.three` (16). Inside a card: `Spacing.two` (8).

\- Rounding from `Radius`: cards, buttons and inputs `medium` (14), small buttons `small` (8),

&#x20; chips `pill`.

\- On wide screens, content is centered and at most `MaxContentWidth` (800) wide.



\## Text



\- Screen title: `ScreenHeader` (28, extra bold, white on navy).

\- Section title: `SectionLabel`.

\- Body: `ThemedText` default (16). Hints: `type="small"` with `themeColor="textSecondary"`.

\- Links: `type="linkPrimary"`.



\## Every screen that loads data shows



1\. a spinner while loading,

2\. a short message and \*\*Try again\*\* if it fails,

3\. a helpful empty message when there is nothing to show.



\## Navigation



\- Inner screens use `ScreenHeader` (or `BackButton`) at the top left, labeled "Back".

\- When opening a product, pass `from` with the current page, so Back returns there.

\- After finishing an action (saving, comparing), stay on the page and show a short

&#x20; message rather than jumping somewhere unexpected.

