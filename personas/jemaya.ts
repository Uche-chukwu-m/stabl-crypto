import { everyday } from "./everyday";
import type { Gen, Persona } from "./gen";

// Freelance designer. Client payments land on random days, with a lean month in
// the middle and a quiet stretch right before the demo. Some clients pay through
// PayPal into a second bank, and she moves that money over to checking.
export const jemaya: Persona = {
  key: "jemaya",
  legalName: "Jemaya Brooks",
  email: "jemaya.brooks@demo.stabl.app",
  earnType: "freelance",
  payFrequency: "irregular",
  timezone: "America/Chicago",
  items: [
    {
      key: "jemaya-main",
      label: "First Platypus Bank",
      accounts: [
        {
          key: "checking",
          name: "Checking",
          officialName: "Everyday Checking",
          mask: "4321",
          type: "depository",
          subtype: "checking",
          homeBase: true,
        },
      ],
    },
    {
      key: "jemaya-second",
      label: "Second Bank",
      accounts: [
        {
          key: "savings",
          name: "Savings",
          officialName: "Online Savings",
          mask: "7781",
          type: "depository",
          subtype: "savings",
        },
      ],
    },
  ],
  openingCents: { savings: 420_00 },
  targetEndCheckingCents: 900_00,
  demoDayOfMonth: 24,
  build(g: Gen) {
    // Income: $17,800 across two busy stretches, $800 in a lean five weeks, then
    // nothing for the last three weeks. That averages about $3,100 a month.
    const payments: { offset: number; weight: number }[] = [];
    let offset = -181 + g.int(0, 3);
    while (offset <= -22) {
      if (offset < -122 || offset > -88) payments.push({ offset, weight: 0.6 + g.random() * 1.2 });
      offset += g.int(4, 8);
    }
    const totalWeight = payments.reduce((sum, p) => sum + p.weight, 0);
    for (const p of payments) {
      const cents = Math.round(((1_780_000 * p.weight) / totalWeight) / 100) * 100;
      const date = g.day(p.offset);
      if (g.chance(0.7)) {
        g.add("checking", date, cents, `STRIPE TRANSFER ST ${g.int(10000, 99999)}`);
      } else {
        g.add("savings", date, cents, "PAYPAL TRANSFER");
        const moveDate = g.day(Math.min(0, p.offset + g.int(0, 2)));
        g.add("savings", moveDate, -cents, "ONLINE TRANSFER TO CHK 4321");
        g.add("checking", moveDate, cents, "ONLINE TRANSFER FROM SAV 7781");
      }
    }
    g.add("checking", g.day(-101), 800_00, "STRIPE TRANSFER ST 40417");

    // Bills
    g.monthly(1, (d) => g.spend("checking", d, 1150_00, "PARKSIDE APTS RENT"));
    g.monthly(3, (d) => g.spend("checking", d, 365_00, "TOYOTA FINANCIAL"));
    g.monthly(8, (d) => g.spend("checking", d, 70_00, "COMCAST XFINITY"));
    g.monthly(12, (d) => g.spend("checking", d, 85_00, "T MOBILE AUTOPAY"));
    g.monthly(18, (d) => g.spend("checking", d, g.cents(92, 138), "ENTERGY LA"));
    g.monthly(5, (d) => g.spend("checking", d, 11_99, "SPOTIFY USA"));
    g.monthly(14, (d) => g.spend("checking", d, 15_49, "NETFLIX COM"));
    g.monthly(22, (d) => g.spend("checking", d, 59_99, "ADOBE CREATIVE CLD"));
    g.monthly(28, (d) => g.add("savings", d, g.int(30, 60), "INTEREST PAYMENT"));

    everyday(g, "checking", {
      grocers: ["KROGER", "KROGER", "PUBLIX"],
      groceryDollars: [52, 88],
      fuel: ["SHELL OIL", "QT"],
      fuelDollars: [26, 40],
      dining: ["CHICK FIL A #1123", "STARBUCKS STORE 0921", "CAVA GRILL 220", "WAFFLE HOUSE 1876"],
      diningPerWeek: 1.5,
      diningDollars: [8, 26],
      shops: ["AMAZON MKTP US", "TARGET T 1442", "MICHAELS STORES 4410"],
      shopsPerMonth: 2,
      shopDollars: [15, 58],
      transit: "MARTA BREEZE",
    });

    // One time hits
    g.spend("checking", g.day(-134), 286_40, "GOODYEAR AUTO 118");
    g.spend("checking", g.day(-77), 86_25, "OLIVE GARDEN 1407");
    g.spend("checking", g.day(-49), 129_00, "DELTA AIR 0062");
    g.spend("checking", g.day(-12), 64_30, "ULTA BEAUTY 551");
  },
};
