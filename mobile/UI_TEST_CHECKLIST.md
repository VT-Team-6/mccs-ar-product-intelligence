# UI consistency and navigation test (Sprint 4, task 5)

Checks every shopper screen against `UI_STANDARDS.md`, then walks the main
navigation paths. Run on web (`npx expo start --web`) with the backend running
and a store picked. Mark each row Pass, Fail (with a note) or N/A.

Last run: Nov 18, 2026 (web, Chrome, light mode)

## 1. Screen check

For each screen:

- **Header:** navy band with the red stripe, white title, small label above it
- **Colors:** only brand colors (navy, red, success green). No old blue `#3c87f7`
- **Cards:** white with a thin border, rounded the same as other screens
- **Buttons:** one red main action, navy outline for other actions (`AppButton`)
- **States:** spinner while loading, message with Try again on error, helpful empty message
- **Back:** `‹ Back` top left on inner screens, goes where you came from

| Screen | Header | Colors | Cards | Buttons | States | Back | Result |
|---|---|---|---|---|---|---|---|
| Home | Pass | Pass | Pass | Pass | Pass | N/A (tab) | Pass |
| Search | Pass | Pass | Pass | Pass | Pass | Pass | Pass |
| Advanced search | Pass | Pass | Pass | Pass | Pass | Pass | Pass |
| Best matches (results) | Pass | Pass | Pass | Pass | Pass | Pass ("Edit search") | Pass |
| Product page | Pass | Pass | Pass | Pass | Pass | Pass | Pass |
| Products: Likes | Pass | Pass | Pass | Pass | Pass | N/A (tab) | Pass |
| Products: History | Pass | Pass | Pass | Pass | Pass | N/A (tab) | Pass |
| Products: Shopping List | Pass | Pass | Partly (grey panels) | Pass | Pass | N/A (tab) | Pass, see follow-ups |
| In-store shopping mode | Pass | Pass | Pass | Pass | Pass | Pass ("Exit Shopping Mode") | Pass |
| Compare | Pass | Pass | Pass | Pass | Pass | Pass | Pass |
| Account | Pass | Pass | Pass | Pass | Pass | N/A (tab) | Pass |
| Preferences | Pass | Pass | Pass | Pass | Pass | Pass | Pass |

## 2. Navigation paths

| # | Steps | Expected | Result |
|---|---|---|---|
| 1 | Home → Enter product manually → search "boot" → open a product → Back | Back to the same search results | Pass |
| 2 | Advanced search → Search → open a result → Back → Edit search | Results again, then the form with the text and ranking filled in | Pass |
| 3 | History → tick 2 → Compare → View product → Back → Back | Compare, then History | Pass |
| 4 | History → tick 5th product | Message "You can compare up to 4 products" | Pass |
| 5 | Account → Preferences → rank 2 → Save → Back | "Saved to your account", then Account | Pass |
| 6 | Home → 🛒 card | Opens shopping mode (or Shopping List when there is no list) | Pass |
| 7 | Product page → Add to Shopping List → Add → View list | Shopping List with the product on it | Pass |
| 8 | Product page on the list → tap "On your shopping list" | Opens Shopping List | Pass |
| 9 | Shopping mode → tap an item | Moves to Checked off, progress bar updates | Pass |
| 10 | Shopping mode → Scan a product on the list | Green "✓ Checked off" banner, item moves to Checked off | To check on phone (needs a QR tag) |
| 11 | Shopping mode → Scan a product not on the list → Add it to this list | Added and checked off | To check on phone |
| 12 | Home scan of a list item | Product page shows "✓ Checked off your list" | To check on phone |
| 13 | Product page → Continue → open a recommended product → refresh the browser → Back | Back to the first product, not Home | Pass (after fix) |
| 14 | Switch Likes / History / Shopping List | Pill moves, page changes, Back stack does not grow | Pass |

## 3. Problems found and fixed in this PR

- After a web refresh, Back on any inner screen went to Home. Expo puts the tabs back
  underneath the page, so `BackButton` went back to them and ignored `from`. It now
  uses `from` when only the tabs are underneath, so it returns to the page you came from.
- Opening a recommended product from a product page did not pass `from`. Now it does,
  so Back returns to the first product.
- Review source checkboxes used a different green (`#198754`) and error text used a
  different red (`#E5484D`) than the rest of the app. Now `Brand.success` / `Brand.danger`.
- Nearby stores error text used `#E5484D`. Now `Brand.danger`.

## 4. Follow-ups (not in this PR)

- **Sign in / register / password reset** still use their own greys and are not on the
  navy band. They show before the store and tabs, so they need their own pass.
- **Store staff screens** (`admin/…`) use their own headers and `#E5484D` for errors.
  Worth moving to `ScreenHeader` and `Brand.danger` when those screens are next touched.
- **Shopping List** panels (picker, new list form, search results) are still grey
  `backgroundElement` boxes rather than white cards.
- Not yet checked: dark mode and phone width (iOS / Android).
