// Product catalog + shop info for the Activewear33 demo.
//
// Products, sizes, offers, address and phone come from @activewear.33's own
// Instagram posts (read Nov 2026). Their posts never show prices ("DM for size
// and price"), so:
// ⚠ EVERY PRICE AND STOCK COUNT BELOW IS A SAMPLE. Replace with the shop's real
// numbers before showing the demo to the owner. Everything the bot says comes
// from this file.
//
// Optional: drop screenshots of their posts into ./images and set `image`
// on a product (e.g. image: "images/predator.jpg") to show the real photo.

globalThis.AW33_CATALOG = {
  shop: {
    name: "Activewear33",
    handle: "activewear.33",
    tagline: "Premium Sportswear & Custom Teamwear",
    address: "Nava India Road, Karpakkal Thottam, PN Palayam, Coimbatore",
    landmark: "Near Sri Ramakrishna College of Arts and Science",
    phone: "+91 88709 21208",
    mapsUrl: "https://maps.google.com/?q=Activewear33+PN+Palayam+Coimbatore",
    staffHours: "9:00 AM – 10:30 PM", // from their story
    storeHours: "10:00 AM – 9:30 PM, all days", // SAMPLE — confirm
    shipping: {
      local: "same / next day", // inside Coimbatore — SAMPLE
      state: "2–3 days", // rest of Tamil Nadu — SAMPLE
      india: "4–6 days", // other states — SAMPLE
      freeAbove: 999, // SAMPLE
      charge: 70, // SAMPLE
    },
    codFee: 50, // SAMPLE
    exchange: "size exchange within 7 days if unused, with tags", // SAMPLE
    printPrice: 150, // name & number printing, per jersey — SAMPLE
    // From their Diwali posts
    offers: [
      "Combo price when you take 3 or 4 jerseys (1–2 jerseys regular price)",
      "XXL offer – 3 pieces for ₹999",
    ],
  },

  // Jersey size chart (chest in inches) — SAMPLE
  sizeChart: { S: 36, M: 38, L: 40, XL: 42, XXL: 44 },

  products: [
    // ── Club jerseys (fan / player version / jersey + shorts set) ──
    { id: "fb-realmadrid", category: "club", name: "Real Madrid Jersey 25/26", short: "Real Madrid",
      keys: ["real madrid", "madrid", "rmcf", "mbappe", "bellingham jersey", "vinicius"], emoji: "⚽", colors: ["#f5f5f5", "#c9a227"],
      versions: { fan: 599, player: 899, set: 799 }, print: true,
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5, "3XL": 3, "4XL": 2 }, colour: "White" },
    { id: "fb-barcelona", category: "club", name: "FC Barcelona Jersey 25/26", short: "Barcelona",
      keys: ["barcelona", "barca", "fcb", "yamal"], emoji: "⚽", colors: ["#a50044", "#004d98"],
      versions: { fan: 599, player: 899, set: 799 }, print: true,
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Blaugrana / peach away" },
    { id: "fb-manutd", category: "club", name: "Manchester United Jersey 25/26", short: "Man United",
      keys: ["manchester united", "man united", "man utd", "manutd", "united", "mufc"], emoji: "⚽", colors: ["#da291c", "#111111"],
      versions: { fan: 599, player: 899, set: 799 }, print: true,
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Red / black" },
    { id: "fb-arsenal", category: "club", name: "Arsenal Jersey 25/26", short: "Arsenal",
      keys: ["arsenal", "gunners", "saka", "afc"], emoji: "⚽", colors: ["#ef0107", "#063672"],
      versions: { fan: 599, player: 899, set: 799 }, print: true,
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Red" },
    { id: "fb-liverpool", category: "club", name: "Liverpool Jersey 25/26", short: "Liverpool",
      keys: ["liverpool", "lfc", "salah"], emoji: "⚽", colors: ["#c8102e", "#00b2a9"],
      versions: { fan: 599, player: 899, set: 799 }, print: true,
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 0 }, colour: "Red" },
    { id: "fb-mancity", category: "club", name: "Manchester City Jersey 25/26", short: "Man City",
      keys: ["manchester city", "man city", "mancity", "haaland"], emoji: "⚽", colors: ["#6cabdd", "#1c2c5b"],
      versions: { fan: 599, player: 899, set: 799 }, print: true,
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Sky blue" },

    // ── Country / World Cup jerseys ──
    { id: "ct-india", category: "country", name: "India Jersey 2026", short: "India 2026",
      keys: ["team india", "indian jersey", "india jersey", "india 2026", "india jerseys"], emoji: "🇮🇳", colors: ["#1c4ea1", "#ff9933"],
      versions: { fan: 599, player: 899 }, print: true,
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Blue" },
    { id: "ct-argentina", category: "country", name: "Argentina World Cup Jersey", short: "Argentina",
      keys: ["argentina", "messi", "arg"], emoji: "⚽", colors: ["#75aadb", "#ffffff"],
      versions: { fan: 599, player: 899 }, print: true,
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Sky blue / white" },
    { id: "ct-portugal", category: "country", name: "Portugal World Cup Jersey", short: "Portugal",
      keys: ["portugal", "ronaldo", "cr7"], emoji: "⚽", colors: ["#c8102e", "#111111"],
      versions: { fan: 599, player: 899 }, print: true,
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Red / black" },

    // ── F1 (sizes S–XL per their post) ──
    { id: "f1-ferrari", category: "f1", name: "Ferrari F1 Jersey", short: "Ferrari",
      keys: ["ferrari", "scuderia", "hamilton", "leclerc"], emoji: "🏎️", colors: ["#e10600", "#7a0000"],
      price: 899, print: true, sizes: { S: 5, M: 5, L: 5, XL: 5 }, colour: "Red" },
    { id: "f1-mercedes", category: "f1", name: "Mercedes-AMG F1 Jersey", short: "Mercedes",
      keys: ["mercedes", "merc", "amg", "russell"], emoji: "🏎️", colors: ["#1b1b1b", "#00a19b"],
      price: 899, print: true, sizes: { S: 5, M: 5, L: 5, XL: 5 }, colour: "Black" },
    { id: "f1-redbull", category: "f1", name: "Red Bull Racing F1 Jersey", short: "Red Bull",
      keys: ["red bull", "redbull", "rbr", "verstappen"], emoji: "🏎️", colors: ["#1e2a5a", "#d81e3a"],
      price: 899, print: true, sizes: { S: 5, M: 5, L: 5, XL: 5 }, colour: "Navy" },
    { id: "f1-mclaren", category: "f1", name: "McLaren F1 Jersey", short: "McLaren",
      keys: ["mclaren", "norris", "piastri", "papaya"], emoji: "🏎️", colors: ["#ff8000", "#1a1a1a"],
      price: 899, print: true, sizes: { S: 5, M: 5, L: 5, XL: 5 }, colour: "Papaya" },

    // ── Courtwear ──
    { id: "nba-lebron", category: "basketball", name: "Lakers LeBron #23 Basketball Jersey", short: "Lakers LeBron 23",
      keys: ["lebron", "lakers"], emoji: "🏀", colors: ["#fdb927", "#552583"],
      versions: { jersey: 799, set: 1199 }, versionLabels: { jersey: "Jersey only", set: "Jersey + shorts set" },
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Gold" },
    { id: "nba-kobe", category: "basketball", name: "Lakers Kobe Basketball Jersey", short: "Lakers Kobe",
      keys: ["kobe", "lakers", "mamba"], emoji: "🏀", colors: ["#552583", "#fdb927"],
      versions: { jersey: 799, set: 1199 }, versionLabels: { jersey: "Jersey only", set: "Jersey + shorts set" },
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Purple / gold" },
    { id: "nba-jordan", category: "basketball", name: "Bulls Jordan #23 Basketball Jersey", short: "Bulls Jordan 23",
      keys: ["bulls", "jordan 23", "mj", "chicago"], emoji: "🏀", colors: ["#ce1141", "#000000"],
      versions: { jersey: 799, set: 1199 }, versionLabels: { jersey: "Jersey only", set: "Jersey + shorts set" },
      sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Red" },

    // ── Football boots (sizes from their posts) ──
    { id: "cl-predator", category: "boots", name: "Adidas Predator (Jude Bellingham edition)", short: "Predator Bellingham",
      keys: ["predator", "bellingham", "adidas boots", "adidas boot", "adidas cleats", "adidas studs"], emoji: "👟", colors: ["#111111", "#e4002b"],
      price: 2699, shoe: true,
      sizes: { "UK 3.5": 2, "UK 5": 3, "UK 6": 4, "UK 7": 4, "UK 8": 4, "UK 9": 2, "UK 9.5": 2, "UK 10": 2, "UK 10.5": 1 }, colour: "Bellingham edition" },
    { id: "cl-phantom", category: "boots", name: "Nike Phantom Elite 6 Football Trainers", short: "Phantom Elite 6",
      keys: ["phantom", "elite 6", "nike trainers", "nike boots", "nike boot", "trainers", "turf"], emoji: "👟", colors: ["#ff2d55", "#1a1a1a"],
      price: 2499, shoe: true, sizes: { "UK 5": 3, "UK 6": 3, "UK 7": 3, "UK 8": 2 }, colour: "Pink / black" },

    // ── Training wear ──
    { id: "tr-dryfit-tee", category: "training", name: "Dry-Fit T-Shirt", short: "Dry-fit tee",
      keys: ["dry fit tshirt", "dry fit t shirt", "dryfit tshirt", "dri fit", "dry fit tee", "gym tshirt", "gym t shirt", "training tee"], emoji: "💪", colors: ["#2b2b2b", "#5b5bff"],
      price: 399, sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Multiple colours" },
    { id: "tr-shorts", category: "training", name: "Dry-Fit Sports Shorts", short: "Dry-fit shorts",
      keys: ["dry fit shorts", "gym shorts", "sports shorts", "training shorts"], emoji: "🩳", colors: ["#1f2937", "#22c55e"],
      price: 349, sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Multiple colours" },
    { id: "tr-jordan-trousers", category: "training", name: "Jordan Dry-Fit Trousers", short: "Jordan trousers",
      keys: ["jordan trousers", "jordan trouser", "dryfit trousers", "dry fit trousers", "trousers"], emoji: "👖", colors: ["#111111", "#ce1141"],
      price: 799, sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Multiple colours" },
    { id: "tr-trackpants", category: "training", name: "Embroidery Zipper Track Pants", short: "Track pants",
      keys: ["track pant", "track pants", "trackpant", "trackpants", "joggers", "jogger"], emoji: "👖", colors: ["#3a3a3a", "#8a8a8a"],
      price: 699, sizes: { M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Black, navy" },
    { id: "tr-halfzip", category: "training", name: "4-Way Nylon Half Zipper", short: "Half zipper",
      keys: ["half zip", "half zipper", "zipper tshirt", "4 way nylon", "nylon"], emoji: "🧥", colors: ["#0f172a", "#38bdf8"],
      price: 699, sizes: { M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Club & country designs" },
    { id: "tr-aw33-jacket", category: "training", name: "Activewear33 Upper Jacket (our own brand)", short: "AW33 Upper Jacket",
      keys: ["jacket", "upper jacket", "aw33 jacket", "activewear33 jacket"], emoji: "🧥", colors: ["#000000", "#e1306c"],
      price: 1199, sizes: { S: 5, M: 5, L: 5, XL: 5, XXL: 5 }, colour: "Black", note: "Our first-ever own product 🖤" },

    // ── Accessories ──
    { id: "ac-kitbag", category: "accessories", name: "Boot / Kit Bag", short: "Kit bag",
      keys: ["kit bag", "boot bag", "shoe bag", "bag"], emoji: "🎒", colors: ["#1f1f1f", "#f59e0b"],
      price: 499, sizes: { "One size": 5 }, colour: "Black", note: "Fits boots up to size 13" },
    { id: "ac-gripsocks", category: "accessories", name: "Grip Socks", short: "Grip socks",
      keys: ["grip socks", "grip sock", "socks"], emoji: "🧦", colors: ["#f5f5f5", "#ef4444"],
      price: 299, sizes: { "One size": 5 }, colour: "White, black" },
    { id: "ac-oakley", category: "accessories", name: "Oakley Sport Glasses", short: "Oakley glasses",
      keys: ["oakley", "glasses", "sunglasses", "goggles"], emoji: "🕶️", colors: ["#0f172a", "#a3e635"],
      price: 999, sizes: { "One size": 5 }, colour: "Multiple shades" },
  ],

  categories: {
    f1: { label: "F1 jerseys", emoji: "🏎️", words: ["f1", "formula 1", "formula one", "racing jersey"] },
    club: { label: "Club jerseys", emoji: "⚽", words: ["club jersey", "club jerseys", "club set", "set jersey", "set jerseys", "football jersey", "football jerseys", "player version"] },
    country: { label: "World Cup jerseys", emoji: "🌍", words: ["world cup", "country jersey", "country jerseys", "national team"] },
    basketball: { label: "Basketball jerseys", emoji: "🏀", words: ["nba", "basketball", "courtwear", "court wear"] },
    boots: { label: "Football boots", emoji: "👟", words: ["boots", "boot", "cleats", "cleat", "studs", "football shoes", "football shoe", "spikes"] },
    training: { label: "Training wear", emoji: "💪", words: ["gym", "workout", "training", "dry fit", "dryfit", "gymwear"] },
    accessories: { label: "Accessories", emoji: "🎒", words: ["accessories", "accessory"] },
  },

  // Custom team kits (bio: "Custom Kits | Team Orders | Corporate") — SAMPLE pricing
  teamwear: {
    minQty: 10,
    perSetLow: 550, // jersey + shorts, sublimation print
    perSetHigh: 750,
    namesFree: true,
    production: "7–10 days after design approval",
  },
};
