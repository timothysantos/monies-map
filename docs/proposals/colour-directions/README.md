# Colour directions

The owner chose the **1970s warm** direction, shipped on `colour-70s`
(design.md, "Pastel palette"). The 60s mod and 80s pop sets below are the
alternatives it was compared with. They use the same token names, so either
could replace the 70s values in `:root` of `public/styles.css`,
`src/domain/category-palette.ts` and `src/client/person-colour.js` without
any component change. Nothing here is wired into the app.

Later (2026-10) the colours became a setting: **Settings → Colours** ships
60s Mod, 80s Pop, Modern, Black & White and Code presets next to the 70s
default (design.md, "Colour presets"; `public/palettes/*.css`). The shipped
60s and 80s presets have their own accents and Splits panels, so their
values differ from the comparison sets below, which stay as the record of
the original choice.

All three keep the terracotta accent (`--accent` #934923, `--accent-strong`
#b15e2f) and the Splits orange panel. Every ink below meets WCAG AA (4.5:1)
on the panel, its soft tint (60% over the panel), its full fill and the
Splits wash (94% over #9b4a21), and every category colour is at least 3:1
on its panel with its 62% label at 4.5:1 or more and the closest pair at
least 8 apart in Lab. The 70s numbers are proved by
`tests/colour-contrast.test.mjs` and `tests/category-palette.test.mjs`; the
60s and 80s numbers were computed the same way when this page was written.

## Side by side

| Token | 1970s warm (shipped) | 1960s mod | 1980s pop |
| --- | --- | --- | --- |
| `--bg` | #eee4cf cream paper | #f1efea gallery white | #ecebf2 cool lilac grey |
| `--panel` | rgba(255, 253, 248, 0.92) | rgba(255, 255, 255, 0.94) | rgba(255, 255, 255, 0.92) |
| `--chrome-surface` | rgba(255, 253, 248, 0.96) | rgba(255, 255, 255, 0.96) | rgba(255, 255, 255, 0.96) |
| `--panel-strong` | #33241a | #16171b | #1a1830 |
| `--text` | #3b2a1f chocolate | #1e1f24 ink black | #23213a deep indigo |
| `--muted` | #6e5f54 warm grey-brown | #5d5f67 cool grey | #5f5c75 violet grey |
| `--line` | rgba(110, 95, 84, 0.2) | rgba(30, 31, 36, 0.14) | rgba(35, 33, 58, 0.14) |
| `--shadow` tint | rgba(59, 42, 31, …) | rgba(30, 31, 36, …) | rgba(35, 33, 58, …) |
| `--pastel-neutral` | #faf4e6 | #f7f6f2 | #f6f5fa |
| `--pastel-mint` / `-ink` | #e8ebd0 / #4c5e1a avocado | #dcefe8 / #0f6656 mod turquoise | #d7f4ea / #0b6a54 Miami mint |
| `--pastel-rose` / `-ink` | #f5ded4 / #973223 brick red | #fbe0de / #a6262b cherry red | #fcdfea / #a2204f hot pink |
| `--pastel-sky` / `-ink` | #d6e7e2 / #2c5f5f dusty teal | #dee6f7 / #24479a cobalt | #d6eef5 / #0c5d72 electric teal |
| `--pastel-lavender` / `-ink` | #eedce6 / #6b4360 faded plum | #ece3f6 / #5b3a8e mod lilac | #eadffa / #5d2d9d neon purple |
| `--pastel-butter` / `-ink` | #f5e4b8 / #664a0b harvest gold, mustard ink | #fbefc2 / #6b5300 sunflower | #fcf2bd / #665200 electric yellow |
| Person: Tim | #46788E dusty teal | #0A8E81 turquoise | #26A2A8 electric teal |
| Person: Joyce | #B97680 mauve | #CC6167 cherry | #EB63A6 hot pink |
| Person: linked to Splits | #BF7D51 terracotta | #BF7D51 terracotta | #BF7D51 terracotta |
| Person: other owners | #8B897A, #6E858A, #918E54, #BF7D51, #376966, #625A7A | #687A75, #7D8791, #809D4B, #BF7D51, #497ECA, #836CBA | #6B7A72, #78888F, #939932, #BF7D51, #6773C0, #7E6FD7 |
| Split group chips | #46788E, #758C4D, #625A7A, #B16739, #699696, #C67D3F, #A77899, #6E858A | #4D8FD6, #57A363, #836CBA, #CD8150, #5F9DA0, #A1772E, #D972A1, #7D8791 | #7289D3, #00A96B, #7E6FD7, #E27444, #5E9DA4, #B88D1E, #EB63A6, #78888F |

Meaning stays the same in every direction: `mint` is money in or going
well, `rose` over plan, money out in a list and debts, `sky` a plan and
"worth knowing", `butter` a To do or warning (always with its dark ink for
text), `lavender` "think about".

## 1960s mod

Crisp gallery white and near-black ink with clean mod hues: turquoise,
cherry, cobalt, lilac and sunflower. The category colours keep each former
hue, pulled a third of the way toward the mod families (cherry, tangerine,
sunflower, avocado, turquoise, cobalt, lilac, pink), with chroma capped at
46. Closest category pair: 8.0.

| Token | Fill | Ink | Ink on the panel | Ink on a soft tint | Ink on the full fill | Ink on the Splits wash |
| --- | --- | --- | --- | --- | --- | --- |
| mint (mod turquoise) | #DCEFE8 | #0F6656 | 6.82 | 6.16 | 5.75 | 5.29 |
| rose (cherry red) | #FBE0DE | #A6262B | 7.10 | 6.25 | 5.73 | 5.30 |
| sky (cobalt) | #DEE6F7 | #24479A | 8.53 | 7.50 | 6.86 | 6.33 |
| lavender (mod lilac) | #ECE3F6 | #5B3A8E | 8.53 | 7.54 | 6.92 | 6.39 |
| butter (sunflower) | #FBEFC2 | #6B5300 | 7.28 | 6.72 | 6.37 | 5.87 |

`--text` is 14.31:1 on the background; `--muted` is 5.54 on the background
and 5.89 on the neutral fill; `--accent-strong` is 4.62 on the panel.

| Category (demo) | Former | Colour | On the panel | Label on the panel |
| --- | --- | --- | --- | --- |
| Income | #1F7A63 | #007566 | 5.57 | 8.68 |
| Transfer | #C97B47 | #A55D2F | 4.95 | 7.99 |
| Savings | #7C8791 | #7D8791 | 3.62 | 6.36 |
| Investments | #8FAE4B | #809D4B | 3.04 | 5.63 |
| Salary | #22B573 | #57A363 | 3.05 | 5.65 |
| Extra Income | #D5A24B | #B38E40 | 3.04 | 5.63 |
| Other - Income | #B8875D | #B5815A | 3.33 | 6.02 |
| Subscriptions MO | #E96A7A | #B04852 | 5.35 | 8.48 |
| Subscriptions YR | #F08FA0 | #D67883 | 3.03 | 5.65 |
| Food & Drinks | #F7A21B | #A1772E | 4.01 | 6.88 |
| Healthcare | #D4B35D | #967C2B | 3.99 | 6.85 |
| Family & Personal | #4F8FD6 | #4D8FD6 | 3.35 | 6.05 |
| Baby & Kids | #7EBDC2 | #5F9DA0 | 3.06 | 5.64 |
| Home | #F85A53 | #DA726B | 3.16 | 5.84 |
| Church | #F062A6 | #D972A1 | 3.03 | 5.66 |
| Tax | #CC63D8 | #A069B2 | 4.04 | 6.90 |
| Groceries | #F08B43 | #CD8150 | 3.04 | 5.65 |
| Travel | #567CC9 | #497ECA | 4.07 | 6.94 |
| Loans | #A06C5B | #9F6D59 | 4.33 | 7.24 |
| Sports & Hobbies | #66D2CF | #269D9B | 3.27 | 5.97 |
| Bills | #62C7B2 | #0A8E81 | 4.01 | 6.94 |
| Education | #7D86F2 | #9285D6 | 3.18 | 5.80 |
| Insurance | #5EA89B | #54A198 | 3.01 | 5.58 |
| Fees | #8B78E6 | #836CBA | 4.32 | 7.21 |
| Beauty | #D56BDD | #B87EC8 | 3.04 | 5.62 |
| Entertainment | #FFA51A | #B4763A | 3.72 | 6.54 |
| Shopping | #D86B73 | #CC6167 | 3.81 | 6.69 |
| Gifts | #C98A5A | #AE7044 | 4.01 | 6.88 |
| Other | #717379 | #717379 | 4.70 | 7.61 |
| Public Transport | #56A4C9 | #5A9BC6 | 3.00 | 5.57 |
| Taxi | #BDD93C | #718734 | 3.99 | 6.84 |
| fallback | #6A7A73 | #687A75 | 4.50 | 7.39 |

## 1980s pop

A cool lilac-grey page and deep indigo ink with Memphis hues: Miami mint,
hot pink, electric teal, neon purple and electric yellow, still as soft
tints on surfaces. The category colours pull each former hue halfway toward
the pop families (pink, purple, teal, mint, yellow, coral), with chroma
capped at 60. Closest category pair: 8.1.

| Token | Fill | Ink | Ink on the panel | Ink on a soft tint | Ink on the full fill | Ink on the Splits wash |
| --- | --- | --- | --- | --- | --- | --- |
| mint (Miami mint) | #D7F4EA | #0B6A54 | 6.47 | 5.95 | 5.62 | 5.18 |
| rose (hot pink) | #FCDFEA | #A2204F | 7.26 | 6.42 | 5.91 | 5.46 |
| sky (electric teal) | #D6EEF5 | #0C5D72 | 7.34 | 6.61 | 6.16 | 5.68 |
| lavender (neon purple) | #EADFFA | #5D2D9D | 8.90 | 7.76 | 7.06 | 6.52 |
| butter (electric yellow) | #FCF2BD | #665200 | 7.48 | 7.00 | 6.70 | 6.17 |

`--text` is 13.13:1 on the background; `--muted` is 5.42 on the background
and 5.91 on the neutral fill; `--accent-strong` is 4.59 on the panel.

| Category (demo) | Former | Colour | On the panel | Label on the panel |
| --- | --- | --- | --- | --- |
| Income | #1F7A63 | #297A5E | 5.13 | 7.96 |
| Transfer | #C97B47 | #D07650 | 3.24 | 5.81 |
| Savings | #7C8791 | #78888F | 3.63 | 6.20 |
| Investments | #8FAE4B | #939932 | 3.03 | 5.50 |
| Salary | #22B573 | #00A96B | 3.01 | 5.57 |
| Extra Income | #D5A24B | #B18F32 | 3.03 | 5.51 |
| Other - Income | #B8875D | #B4795A | 3.56 | 6.17 |
| Subscriptions MO | #E96A7A | #E76E69 | 3.03 | 5.55 |
| Subscriptions YR | #F08FA0 | #D37794 | 3.03 | 5.50 |
| Food & Drinks | #F7A21B | #B88D1E | 3.02 | 5.51 |
| Healthcare | #D4B35D | #99822C | 3.71 | 6.37 |
| Family & Personal | #4F8FD6 | #7289D3 | 3.32 | 5.82 |
| Baby & Kids | #7EBDC2 | #5E9DA4 | 3.03 | 5.47 |
| Home | #F85A53 | #E96855 | 3.15 | 5.74 |
| Church | #F062A6 | #EB63A6 | 3.02 | 5.53 |
| Tax | #CC63D8 | #9A66CB | 4.03 | 6.68 |
| Groceries | #F08B43 | #E27444 | 3.04 | 5.57 |
| Travel | #567CC9 | #6773C0 | 4.33 | 6.99 |
| Loans | #A06C5B | #A16C5C | 4.30 | 7.03 |
| Sports & Hobbies | #66D2CF | #26A2A8 | 3.04 | 5.54 |
| Bills | #62C7B2 | #49A386 | 3.02 | 5.49 |
| Education | #7D86F2 | #8784EE | 3.16 | 5.60 |
| Insurance | #5EA89B | #5EA08B | 3.01 | 5.46 |
| Fees | #8B78E6 | #7E6FD7 | 4.03 | 6.66 |
| Beauty | #D56BDD | #B27CE2 | 3.02 | 5.43 |
| Entertainment | #FFA51A | #A17800 | 3.98 | 6.74 |
| Shopping | #D86B73 | #D06961 | 3.53 | 6.17 |
| Gifts | #C98A5A | #CC815E | 3.02 | 5.49 |
| Other | #717379 | #727379 | 4.66 | 7.37 |
| Public Transport | #56A4C9 | #3E9FB8 | 3.02 | 5.48 |
| Taxi | #BDD93C | #8C8E10 | 3.46 | 6.08 |
| fallback | #6A7A73 | #6B7A72 | 4.46 | 7.15 |

## 1970s warm (shipped)

For comparison, the shipped category colours with their family. The full
contrast tables are in design.md ("Pastel palette" and "Category palette").

| Category (demo) | Former | Colour | Family | On the panel | Glyph on its tint | Label on the panel |
| --- | --- | --- | --- | --- | --- | --- |
| Income | #1F7A63 | #566432 | avocado | 6.22 | 4.86 | 8.37 |
| Transfer | #C97B47 | #AA6647 | rust | 4.32 | 3.99 | 6.56 |
| Savings | #7C8791 | #6E858A | dusty teal | 3.77 | 3.79 | 6.01 |
| Investments | #8FAE4B | #918E54 | olive | 3.28 | 3.50 | 5.42 |
| Salary | #22B573 | #758C4D | avocado | 3.62 | 3.69 | 5.84 |
| Extra Income | #D5A24B | #B48639 | harvest gold | 3.17 | 3.41 | 5.29 |
| Other - Income | #B8875D | #A98466 | tan | 3.29 | 3.49 | 5.42 |
| Subscriptions MO | #E96A7A | #B97680 | mauve | 3.41 | 3.54 | 5.57 |
| Subscriptions YR | #F08FA0 | #9F667B | mauve | 4.36 | 4.03 | 6.60 |
| Food & Drinks | #F7A21B | #C67D3F | burnt orange | 3.17 | 3.39 | 5.29 |
| Healthcare | #D4B35D | #A58F45 | mustard | 3.07 | 3.37 | 5.17 |
| Family & Personal | #4F8FD6 | #46788E | dusty teal | 4.68 | 4.24 | 7.03 |
| Baby & Kids | #7EBDC2 | #699696 | dusty teal | 3.17 | 3.46 | 5.35 |
| Home | #F85A53 | #C36351 | rust | 3.89 | 3.76 | 6.13 |
| Church | #F062A6 | #A77899 | mauve | 3.51 | 3.62 | 5.69 |
| Tax | #CC63D8 | #7A587D | mauve | 5.77 | 4.67 | 7.95 |
| Groceries | #F08B43 | #B16739 | burnt orange | 4.17 | 3.91 | 6.41 |
| Travel | #567CC9 | #2C627C | dusty teal | 6.46 | 4.99 | 8.72 |
| Loans | #A06C5B | #7E584A | brown | 6.01 | 4.75 | 8.13 |
| Sports & Hobbies | #66D2CF | #619989 | dusty teal | 3.16 | 3.45 | 5.34 |
| Bills | #62C7B2 | #53806F | dusty teal | 4.34 | 4.07 | 6.65 |
| Education | #7D86F2 | #7C7998 | mauve | 4.03 | 3.91 | 6.27 |
| Insurance | #5EA89B | #376966 | dusty teal | 6.02 | 4.81 | 8.29 |
| Fees | #8B78E6 | #625A7A | mauve | 6.23 | 4.87 | 8.36 |
| Beauty | #D56BDD | #816C93 | mauve | 4.51 | 4.14 | 6.77 |
| Entertainment | #FFA51A | #986C29 | harvest gold | 4.50 | 4.09 | 6.74 |
| Shopping | #D86B73 | #92535F | mauve | 5.60 | 4.57 | 7.80 |
| Gifts | #C98A5A | #8E6849 | tan | 4.81 | 4.25 | 7.03 |
| Other | #717379 | #7D7369 | brown | 4.49 | 4.13 | 6.73 |
| Public Transport | #56A4C9 | #568C99 | dusty teal | 3.62 | 3.71 | 5.89 |
| Taxi | #BDD93C | #7E7541 | olive | 4.51 | 4.12 | 6.75 |
| fallback | #6A7A73 | #8B897A | olive | 3.41 | 3.58 | 5.58 |
