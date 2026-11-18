\# MCCS app UI standards



These keep every screen looking and behaving the same. When you build or change

a screen, use the shared pieces below instead of styling things by hand.



\## Colors



All colors live in `src/constants/theme.ts`.



| Use | Color | Where it comes from |

|---|---|---|

| Header, tab bar, links, secondary buttons | Navy `Brand.navy` (#0C2340) | MCCS website theme color |

| Main action on a screen | Red `Brand.red` (#940000) | Marine Corps style guide |

| Cards and inputs | `theme.backgroundElement` | Follows light/dark mode |

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

\- `ScreenHeader` (`components/ui/screen-header.tsx`): Back + title + optional

&#x20; subtitle on every inner screen.



\## Layout



\- Screen padding: `Spacing.four` (24) on the sides.

\- Gap between sections: `Spacing.three` (16). Inside a card: `Spacing.two` (8).

\- Rounding from `Radius`: cards `large` (18), buttons and inputs `medium` (14),

&#x20; chips `pill`.

\- On wide screens, content is centered and at most `MaxContentWidth` (800) wide.



\## Text



\- Screen title: `ScreenHeader` (28, extra bold).

\- Section title: 20, bold.

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

