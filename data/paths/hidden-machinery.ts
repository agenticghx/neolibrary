import type { SeedBook, SeedPath, SeedPillar } from "./types";

/**
 * Samuel's first Path, transcribed from docs/reading-lists/hidden-machinery.md
 * (data/paths/hidden-machinery.test.ts checks the two stay in step).
 * Order inside a pillar: N (read first), E (read second), then extras.
 * The master key (Seeing Like a State) is the last pillar.
 */

const pair = (n: [string, string], e: [string, string], extras: SeedBook[] = []): SeedBook[] => [
  { kind: "N", title: n[0], author: n[1] },
  { kind: "E", title: e[0], author: e[1] },
  ...extras,
];

const extra = (title: string, author: string, note?: string, unverified?: boolean): SeedBook => ({
  kind: "extra",
  title,
  author,
  ...(note ? { note } : {}),
  ...(unverified ? { unverified } : {}),
});

const main: SeedPillar[] = [
  ["electricity-grid", "Electricity & the grid", ["The Grid", "Bakke"], ["Power System Economics", "Stoft"]],
  ["payments", "Payments & settlement", ["The Pay Off", "Leibbrandt & de Terán"], ["Payments Systems in the U.S.", "Glenbrook"]],
  ["shipping", "Shipping & logistics", ["Ninety Percent of Everything", "George"], ["Maritime Economics", "Stopford"]],
  ["food", "Food systems", ["The Alchemy of Air", "Hager"], ["Feeding the World", "Smil"]],
  ["construction", "Construction", ["How Big Things Get Done", "Flyvbjerg"], ["The Origins of Efficiency", "Potter"]],
  ["cables", "Cables & the physical internet", ["Tubes", "Blum"], ["The Undersea Network", "Starosielski"]],
  ["public-health", "Public health delivery", ["The Ghost Map", "Johnson"], ["The Great Escape", "Deaton"]],
  ["courts", "Courts & contracts", ["Gideon's Trumpet", "Lewis"], ["How Judges Think", "Posner"]],
  ["water", "Water & rivers", ["Cadillac Desert", "Reisner"], ["Water 4.0", "Sedlak"]],
  ["semiconductors", "Semiconductors", ["Chip War", "Miller"], ["Fabless", "Nenni & McLellan"]],
  ["materials", "Materials & trading", ["The World for Sale", "Blas & Farchy"], ["Material World", "Conway"]],
  ["oil-gas", "Oil & gas", ["The Prize", "Yergin"], ["Oil 101", "Downey"]],
  ["systems-fail", "How systems fail", ["Meltdown", "Clearfield & Tilcsik"], ["Normal Accidents", "Perrow"]],
  ["insurance", "Insurance & catastrophe", ["Against the Gods", "Bernstein"], ["The Cure for Catastrophe", "Muir-Wood"]],
  ["waste", "Waste & recycling", ["Junkyard Planet", "Minter"], ["Rubbish!", "Rathje & Murphy"]],
  ["precision", "Precision & standards", ["The Perfectionists", "Winchester"], ["Beyond Measure", "Vincent"]],
  ["land-zoning", "Land & zoning", ["The Color of Law", "Rothstein"], ["Order Without Design", "Bertaud"]],
  ["drugs", "Drug development & quality", ["The Billion-Dollar Molecule", "Werth"], ["A Prescription for Change", "Kinch"]],
].map(([slug, title, n, e]) => ({
  slug: slug as string,
  title: title as string,
  group: "main" as const,
  books: pair(n as [string, string], e as [string, string]),
}));

const finance: SeedPillar[] = [
  {
    slug: "banking",
    title: "Banking & credit",
    question:
      "Where does a loan come from? Why can a rumor empty a bank by Friday — and freeze the rest of the economy?",
    group: "finance",
    books: pair(
      ["The House of Morgan", "Chernow"],
      ["The Economics of Money, Banking, and Financial Markets", "Mishkin"],
      [
        extra("Fragile by Design", "Calomiris & Haber", "Why the political bargain makes banks fragile. Read after Mishkin."),
        extra("Stigum's Money Market", "Stigum & Crescenzi", "Wholesale plumbing: repo, CP, Fed funds. Dense."),
        extra("Lords of Finance", "Ahamed", "Central bankers and the interwar gold-standard collapse."),
        extra("Other People's Money", "John Kay", "What the financial industry is for, and when it stops being that."),
        extra("Manias, Panics, and Crashes", "Kindleberger", "How financial systems fail. Pairs with Normal Accidents."),
      ],
    ),
  },
  {
    slug: "capital-markets",
    title: "Capital markets",
    question: "Who owns the buildings and businesses around us? Who finances a power plant, a highway, or an airline?",
    group: "finance",
    books: pair(
      ["Barbarians at the Gate", "Burrough & Helyar"],
      ["Principles of Corporate Finance", "Brealey, Myers & Allen"],
      [extra("The Great Game", "John Steele Gordon", "Broader Wall Street survey if Barbarians feels too narrow.")],
    ),
  },
];

const blindspots: SeedPillar[] = [
  {
    slug: "time-gps",
    title: "Time, GPS & navigation",
    question: "If GPS dies, phones, container ships, the grid and finance all degrade. Where does shared time come from?",
    group: "blindspot",
    books: pair(["Pinpoint", "Greg Milner"], ["GPS Declassified", "Easton & Frazier"], [
      extra("Longitude", "Sobel", "The gateway story about why time became infrastructure."),
      extra("Einstein's Clocks, Poincaré's Maps", "Galison", "History of simultaneity. Deep-cut extra."),
    ]),
  },
  {
    slug: "legibility",
    title: "Legibility — maps, addresses, official numbers",
    question: "How did land become a grid, how does a letter find you, and how does a census become “the economy”?",
    group: "blindspot",
    books: pair(["Measuring America", "Andro Linklater"], ["How to Lie with Maps", "Mark Monmonier"], [
      extra("The Sum of the People", "Whitby", "The census as a state machine."),
      extra("GDP: A Brief but Affectionate History", "Coyle", "How one number became the scoreboard."),
      extra("The Address Book", "Mask", "Street addresses as cultural infrastructure."),
      extra("The Invention of the Passport", "Torpey", "How states made people identifiable."),
    ]),
  },
  {
    slug: "land-transport",
    title: "Land transport — roads, rail, trucking",
    question: "Ocean freight is covered. The road you used today is not.",
    group: "blindspot",
    books: pair(["Door to Door", "Edward Humes"], ["The Geography of Transport Systems", "Rodrigue"], [
      extra("The Box", "Levinson", "The container. Belongs next to the shipping pair."),
      extra("The Big Roads", "Swift", "Interstate genesis."),
      extra("Fighting Traffic", "Norton", "How cars captured the street."),
    ]),
  },
  {
    slug: "aviation",
    title: "Aviation",
    question: "How do airlines, airports and air traffic control actually work?",
    group: "blindspot",
    books: pair(["Hard Landing", "Thomas Petzinger Jr."], ["Airport Systems", "de Neufville & Odoni"], [
      extra("Skyfaring", "Vanhoenacker", "For the cathedral feeling."),
      extra("Fly by Wire", "Langewiesche", "The plane as a system."),
    ]),
  },
  {
    slug: "tax-state",
    title: "The tax state",
    question: "How is a modern tax system put together?",
    group: "blindspot",
    books: pair(["Rebellion, Rascals, and Revenue", "Keen & Slemrod"], ["Taxing Ourselves", "Slemrod & Bakija"], [
      extra("Taxing the Rich", "Scheve & Stasavage", "Political history of progressive rates."),
      extra("A Fine Mess", "T.R. Reid", "A journalist’s tour of other countries’ tax systems."),
    ]),
  },
  {
    slug: "maintenance",
    title: "Maintenance and operators",
    question: "Who keeps silent systems silent?",
    group: "blindspot",
    books: pair(["Rust: The Longest War", "Jonathan Waldman"], ["How Buildings Learn", "Stewart Brand"], [
      extra("The Innovation Delusion", "Vinsel & Russell", "The argument: we worship innovation and starve maintainers."),
      extra("The Shock of the Old", "Edgerton", "History of technology as use, not invention."),
      extra("Shop Class as Soulcraft", "Crawford", "Companion: a philosophical mechanic’s memoir."),
    ]),
  },
  {
    slug: "administrative-state",
    title: "The administrative state",
    question: "Who certifies airplanes and inspects boilers?",
    group: "blindspot",
    books: pair(["The Fifth Risk", "Michael Lewis"], ["Bureaucracy", "James Q. Wilson"], [
      extra("Street-Level Bureaucracy", "Lipsky", "The inspector, the cop, the claims officer."),
      extra("The Poison Squad", "Deborah Blum", "Origin story of food regulation."),
    ]),
  },
  {
    slug: "accounting",
    title: "Accounting and the corporate form",
    question: "States and firms rise and fall on whether anyone can read the books.",
    group: "blindspot",
    books: pair(["The Reckoning", "Jacob Soll"], ["For Profit", "William Magnuson"], [
      extra("Double Entry", "Gleeson-White", "Pacioli and the method. Read after Soll."),
      extra("The Company", "Micklethwait & Wooldridge", "A survey history of the firm."),
    ]),
  },
  {
    slug: "housing",
    title: "Housing as a lived system",
    question: "How did America build the mortgage, suburb and FHA machine?",
    group: "blindspot",
    books: pair(["Crabgrass Frontier", "Kenneth T. Jackson"], ["Homelessness is a Housing Problem", "Colburn & Aldern"], [
      extra("Evicted", "Desmond", "The bottom of the market."),
      extra("House of Debt", "Mian & Sufi", "How household leverage blows up the macroeconomy."),
    ]),
  },
];

// From "Books added in replies" (recommended by readers of the original post).
const replies: SeedPillar = {
  slug: "from-the-replies",
  title: "From the replies",
  question: "Same spirit as the original list, suggested by readers.",
  group: "suggested",
  books: [
    extra("The Weather Machine", "Andrew Blum"),
    extra("How Infrastructure Works", "Deb Chachra"),
    extra("Infrastructure: A Field Guide to the Industrial Landscape", "Brian Hayes"),
    extra("Frostbite", "Nicola Twilley"),
    extra("The Frackers", "Gregory Zuckerman"),
    extra("Lift Off", "Eric Berger"),
    extra("Where Wizards Stay Up Late", "Katie Hafner & Matthew Lyon"),
    extra("How the World Really Works", "Vaclav Smil"),
    extra("Fifty Inventions That Shaped the Modern Economy", "Tim Harford"),
    extra("The Logic of Failure", "Dietrich Dörner"),
    extra("Thinking in Systems: A Primer", "Donella Meadows"),
    extra("Toyota Production System", "Taiichi Ohno"),
    extra("The Goal", "Eliyahu Goldratt"),
    extra("Sorting Things Out", "Bowker & Star"),
    extra("A Vast Machine", "Paul Edwards"),
  ],
};

// Agent suggestions (2026-09-29 and 2026-10-01): not catalog-checked.
const u = (kind: SeedBook["kind"], title: string, author: string, note: string): SeedBook => ({
  kind,
  title,
  author,
  note,
  unverified: true,
});

const suggested: SeedPillar[] = [
  {
    slug: "geospatial",
    title: "Geospatial reasoning",
    question: "Once you have a position, what can you conclude from it?",
    group: "suggested",
    books: [
      u("N", "The Power of Maps", "Denis Wood", "How a map argues for a point of view."),
      u("E", "Geographic Information Systems and Science", "Longley, Goodchild, Maguire, Rhind", "The standard GIS textbook."),
      u("extra", "The Mapmakers", "John Noble Wilford", "How the world got mapped."),
      u("extra", "Making Maps", "Krygier & Wood", "Hands-on map design for GIS."),
      u("extra", "Geocomputation with R", "Lovelace, Nowosad, Muenchow", "Spatial analysis in code."),
      u("extra", "Spatial Data Science", "Pebesma & Bivand", "The statistics of spatial data."),
    ],
  },
  {
    slug: "more-blindspots",
    title: "More blindspots",
    question: "Science funding, hospital bills, spectrum, retail, advertising, cooling, blood, death care, scripts.",
    group: "suggested",
    books: [
      u("extra", "Making Mice", "Karen Rader", "How lab mice became standardized products."),
      u("extra", "Lords of the Fly", "Robert Kohler", "The fly stock as shared infrastructure."),
      u("extra", "An American Sickness", "Elisabeth Rosenthal", "Why a hospital bill costs what it does."),
      u("extra", "The Master Switch", "Tim Wu", "The phone and broadcast empires."),
      u("extra", "The Retail Revolution", "Nelson Lichtenstein", "Walmart as a logistics machine."),
      u("extra", "Fulfillment", "Alec MacGillis", "Amazon's warehouses and the towns around them."),
      u("extra", "The Attention Merchants", "Tim Wu", "Who pays for the free internet."),
      u("extra", "Losing Our Cool", "Stan Cox", "What air conditioning did to cities."),
      u("extra", "Lifted", "Andreas Bernard", "The elevator and tall buildings."),
      u("extra", "The Gift Relationship", "Richard Titmuss", "Paid vs donated blood systems."),
      u("extra", "Smoke Gets in Your Eyes", "Caitlin Doughty", "A crematory worker's view."),
      u("extra", "The Chinese Typewriter", "Thomas Mullaney", "Non-Latin scripts on alphabet machines."),
    ],
  },
  {
    slug: "money-markets-dollar",
    title: "Money, markets & the dollar",
    question: "What money is, how orders reach the market, and why the dollar rules.",
    group: "suggested",
    books: [
      u("extra", "Money: The Unauthorized Biography", "Felix Martin", "Money as credit and record-keeping."),
      u("extra", "The Lords of Easy Money", "Christopher Leonard", "The Federal Reserve after 2008."),
      u("extra", "Flash Boys", "Michael Lewis", "How an order actually reaches the market."),
      u("extra", "Trillions", "Robin Wigglesworth", "Index funds, and who owns most shares."),
      u("extra", "Exorbitant Privilege", "Barry Eichengreen", "Why the dollar is the world's money."),
      u("extra", "Underground Empire", "Henry Farrell & Abraham Newman", "The dollar and SWIFT as instruments of power."),
    ],
  },
];

const masterKey: SeedPillar = {
  slug: "master-key",
  title: "Master key",
  question: "Every system above is a state making society legible, and society routing around it.",
  group: "master",
  books: [{ kind: "master", title: "Seeing Like a State", author: "James C. Scott", note: "Read last." }],
};

export const hiddenMachinery: SeedPath = {
  slug: "hidden-machinery",
  title: "Hidden Machinery",
  description: "The “boring” infrastructure modern society runs on. Read the narrative book (N) first, then the engineering and economics book (E).",
  sourceUrl: "https://x.com/deedydas/status/2088870251069129189",
  pillars: [...main, ...finance, ...blindspots, replies, ...suggested, masterKey],
};
