import { everyday } from "./everyday";
import type { Gen, Persona } from "./gen";

// Runs a catering business. Square pays out weekly into business checking, with
// spikes around holidays and big events. Supplies come out of business checking,
// and she pays herself into personal checking. A few one off credits have no
// history and need a label.
export const ada: Persona = {
  key: "ada",
  legalName: "Ada Okafor",
  email: "ada.okafor@demo.stabl.app",
  earnType: "own_business",
  payFrequency: "weekly",
  timezone: "America/Chicago",
  items: [
    {
      key: "ada-main",
      label: "First Platypus Bank",
      accounts: [
        {
          key: "checking",
          name: "Checking",
          officialName: "Personal Checking",
          mask: "5512",
          type: "depository",
          subtype: "checking",
          homeBase: true,
        },
        {
          key: "business",
          name: "Business Checking",
          officialName: "Okafor Catering LLC",
          mask: "6630",
          type: "depository",
          subtype: "checking",
        },
        {
          key: "card",
          name: "Business Card",
          officialName: "Platypus Business Visa",
          mask: "1187",
          type: "credit",
          subtype: "credit card",
        },
      ],
    },
  ],
  openingCents: { business: 1_800_00, card: 0 },
  targetEndCheckingCents: 2_800_00,
  build(g: Gen) {
    // Weekly Square payouts; holiday and event weeks pay two to three times more.
    const spikes = new Set([-150, -149, -148, -147, -146, -145, -144, -66, -65, -64, -63, -62, -61, -60, -24, -23, -22]);
    g.weekly(1, (d) => {
      const spike = spikes.has(g.offsetOf(d));
      g.add("business", d, spike ? g.cents(2_200, 3_600) : g.cents(650, 1_250), "SQUARE INC DEP");
    });

    // Supplies and costs from business checking and the business card.
    g.weekly(3, (d) => g.spend("business", d, g.cents(100, 260), `RESTAURANT DEPOT ${g.storeNumber()}`), 1);
    g.everyDays(12, 20, (d) => g.spend("card", d, g.cents(40, 180), g.pick(["SYSCO ATLANTA", "WEBSTAURANTSTORE", "COSTCO WHSE 1123"])));
    g.monthly(6, (d) => g.spend("business", d, 450_00, "COMMISSARY KITCHEN LEASE"));
    g.monthly(15, (d) => g.spend("business", d, 129_00, "NEXT INSURANCE"));

    // Pay herself twice a month.
    g.monthly(2, (d) => {
      g.spend("business", d, 1_600_00, "ONLINE TRANSFER TO CHK 5512");
      g.add("checking", d, 1_600_00, "ONLINE TRANSFER FROM CHK 6630");
    });
    g.monthly(17, (d) => {
      g.spend("business", d, 1_400_00, "ONLINE TRANSFER TO CHK 5512");
      g.add("checking", d, 1_400_00, "ONLINE TRANSFER FROM CHK 6630");
    });

    // Personal bills
    g.monthly(1, (d) => g.spend("checking", d, 1_050_00, "MAGNOLIA PLACE RENT"));
    g.monthly(11, (d) => g.spend("checking", d, 78_00, "AT&T WIRELESS"));
    g.monthly(19, (d) => g.spend("checking", d, g.cents(105, 160), "GEORGIA POWER"));
    g.monthly(7, (d) => g.spend("checking", d, 15_49, "NETFLIX COM"));

    everyday(g, "checking", {
      grocers: ["KROGER", "ALDI"],
      groceryDollars: [45, 80],
      fuel: ["CHEVRON", "SHELL OIL"],
      fuelDollars: [30, 50],
      dining: ["CHICK FIL A #1123", "JOLLOF HUT", "STARBUCKS STORE 0921"],
      diningPerWeek: 1.5,
      diningDollars: [9, 36],
      shops: ["TARGET T 1442", "AMAZON MKTP US"],
      shopsPerMonth: 2,
      shopDollars: [20, 80],
    });

    // Card paid from business checking.
    g.monthly(26, (d) => {
      const owed = g.txns
        .filter((t) => t.account === "card" && t.amountCents < 0 && t.date < d && t.date >= g.day(g.offsetOf(d) - 31))
        .reduce((sum, t) => sum - t.amountCents, 0);
      if (owed <= 0) return;
      g.spend("business", d, owed, "CHASE CARD EPAYMENT");
      g.add("card", g.day(Math.min(0, g.offsetOf(d) + 1)), owed, "PAYMENT THANK YOU");
    });

    // One off credits with no history. These become mystery credits to label.
    g.add("checking", g.day(-58), 250_00, "ZELLE FROM T OKAFOR");
    g.add("business", g.day(-33), 640_00, "MOBILE DEPOSIT CHECK 1042");
    g.add("checking", g.day(-9), 180_00, "VENMO CASHOUT");
  },
};
