import { everyday } from "./everyday";
import type { Gen, Persona } from "./gen";

// Mixed gig work that does not cover spending on average. Stabl should decline
// to buffer and say why in plain words.
export const tee: Persona = {
  key: "tee",
  legalName: "Tee Daniels",
  email: "tee.daniels@demo.stabl.app",
  earnType: "mix",
  payFrequency: "weekly",
  timezone: "America/Chicago",
  items: [
    {
      key: "tee-main",
      label: "First Platypus Bank",
      accounts: [
        {
          key: "checking",
          name: "Checking",
          officialName: "Basic Checking",
          mask: "3074",
          type: "depository",
          subtype: "checking",
          homeBase: true,
        },
      ],
    },
  ],
  openingCents: {},
  targetEndCheckingCents: 240_00,
  build(g: Gen) {
    g.weekly(1, (d) => g.add("checking", d, g.cents(180, 330), "DOORDASH DASHER"));
    g.weekly(4, (d) => {
      if (g.chance(0.6)) g.add("checking", d, g.cents(60, 160), "INSTACART SHOPPER");
    });
    g.everyDays(10, 20, (d) => g.add("checking", d, g.cents(90, 210), "UBER DRIVER PAYOUT"));

    g.monthly(1, (d) => g.spend("checking", d, 925_00, "OAK HOLLOW APTS RENT"));
    g.monthly(4, (d) => g.spend("checking", d, 289_00, "CARVANA AUTO PMT"));
    g.monthly(10, (d) => g.spend("checking", d, 65_00, "METRO BY T MOBILE"));
    g.monthly(17, (d) => g.spend("checking", d, g.cents(70, 120), "ENTERGY LA"));
    g.monthly(21, (d) => g.spend("checking", d, 142_00, "PROGRESSIVE INS"));

    everyday(g, "checking", {
      grocers: ["WALMART SUPERCENTER", "DOLLAR GENERAL"],
      groceryDollars: [55, 90],
      fuel: ["SHELL OIL", "RACETRAC"],
      fuelDollars: [35, 55],
      dining: ["MCDONALDS F1203", "POPEYES 3302", "SONIC DRIVE IN 41"],
      diningPerWeek: 2,
      diningDollars: [7, 18],
      shops: ["AMAZON MKTP US", "WALMART COM"],
      shopsPerMonth: 1.5,
      shopDollars: [15, 50],
    });
    g.spend("checking", g.day(-88), 340_00, "AUTOZONE 1876");
  },
};
