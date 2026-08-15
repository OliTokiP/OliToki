# Toast Migration Info

**Last updated:** 2026-08-14  
**Compared:** Restaurant Copy vs [Toast online](https://order.toasttab.com/online/olitoki)  
**olitoki.com** is marketing only (no prices). Toast is the live order menu.

Restaurant Copy ID: `1dXnhfxd9kzAkKNz4oVwTZHHK8focy6GW-twpC8B11gM`  
Settings workbook currently points Data Source at **Restaurant Copy** (Require Restart on).

---

## 1. How Toast stores a menu

Not a CSV. Toast is a cloud POS. The live source is their database. Partners get **JSON** from the [Menus API](https://doc.toasttab.com/openapi/menus/overview/) (V2/V3). You can export/test as JSON. CSV is not the native shape.

### Core tree (5 types)

1. **Menu** — e.g. “Lunch” vs “Online”
2. **Menu group** — a section (can nest)
3. **Menu item** — the thing you sell
4. **Modifier group** — Size, Protein, Sauce…
5. **Modifier option** — Small / Bulgogi / Ranch

Around that, the API also has **pre-modifiers** (NO / EXTRA), **sales categories**, **item tags** (veg, GF), **images**, **prices + pricing rules** (base, size, time-of-day, location), **visibility** (POS / kiosk / Toast online / partners), **taxes**, **prep/kitchen**, **portions**, **stock**, hours, calories/allergens (mostly unused in the public API), shipping dimensions, PLU/SKU, retail catalog fields for merch.

A single item object has **~40 fields**. Most restaurants leave a lot of them empty.

### What OliToki is actually using (public Toast page)

| Toast layer | OliToki online |
|-------------|----------------|
| Menus | 1 published online menu |
| Groups | **8** (Handhelds, Bowls/Salads, Munchies, Fries/Tots, Crispy Chicken/Tofu, Family Meals, Beverages, Swag) |
| Items | ~40 sellable SKUs (boards show ~35 of those) |
| Modifiers | Heavy — protein, sauce, size S/M/L, ramen seasoning, spicy/regular, dumpling type, “no kimchi” |
| Images | Yes |
| Prices | Base price; size rules on tenders/wings |
| Visibility | Online vs POS (family meals / swag / water are online-only relative to the boards) |

They are **not** using the fancy bits: time-of-day pricing, multi-location versions, portions (pizza halves), weight/shipping, SNAP, combo parents, etc.

### What a Toast-driven sheet would pull

JSON → flatten **group → item → price → description → image → visibility**, and treat modifiers as the Proteins / Sauces / size columns. We would not ingest most of those 40 item fields. Price/name drift (see below) is exactly what that pipeline is for: Toast changes a price, the board should follow.

---

## 2. Restaurant Copy vs Toast (2026-08-13)

### Updated 2026-08-14 to match Toast

| Cell | Was | Now |
|------|-----|-----|
| Board 1 · Exxtra bowl | Exxtra Tofu or Veggie Bowl | **Exxtra Chicken or Tofu Veggie Bowl** |
| Board 3 · Ramen Chips | $4.50 | **$3.95** |
| Board 3 · Mini MoChurros | $6.95 | **$5.95** |
| Board 3 · Tenders Plate | $16.95 | **$14.95** |

Require Restart was on — boards need a human refresh after that write.

### Other gaps (not changed)

| Item | Restaurant Copy | Toast |
|------|-----------------|-------|
| Kalifornia Burrito | OliToki Kalifornia Burrito $12.50 | Kalifornia Burrito $12.50 |
| Loaded fries | Loaded **Pulled Pork** Fusion Fries $12.95 | Loaded Fusion Fries $12.95 (Toast copy also lists guac, cheese, sour cream, scallions) |

**On Toast, not on the boards:** Family meals (Bulgogi $19.95, Soy-Garlic Chicken $14.95, Chipotle Pork $15.95, rice, extra sauce, banchan); swag stickers $0.99; bottled water $1.50; canned soda **$1.95** (board lists named drinks with no prices). Tenders Plate is bowls on Toast, Munchies “Meal Deal” on the sheet.

**Fine / expected:** OliToki Burrito $10.50, Tacos $8.95, Burilla $10.25, Dilla $11.95; Packed $12.95, Super Cup $13.95, Crunch Bowl $14.95, Mix Market $12.50, Dumpling Bowl $12.50, Aloha $12.95, Kimchi fried rice $12.95; Totchos $9.25, rice balls 1/$2 & 4/$6.95, dumplings $6.95, musubis $4.25 / $4, fries/tots/mix; Tender Dippers small $8.25, Tofu Wings small $7.95 (M/L only on the board). Proteins/sauces/veggies are add-on lists (Boneless Wings **Include = 0**). Website FAQ hours and 76 Brighton Ave match Toast.

---

## 3. Related

- [FUTURE_HOSTED_API.md](./FUTURE_HOSTED_API.md) — private sheets from Remote  
- [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) — board tab layout  
- Toast docs: [Menus API overview](https://doc.toasttab.com/openapi/menus/overview/), [menu hierarchy](https://doc.toasttab.com/doc/devguide/menu_information_config_api.html)
