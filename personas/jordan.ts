import { everyday } from "./everyday";
import { Gen, type Persona } from "./gen";

// Car sales. A steady base check every two weeks plus a commission on the 15th
// that swings from nothing to $4,000. Rent is the biggest bill of the month and
// lands on the 1st; most everyday spending goes on a credit card.
export const jordan: Persona = {
  key: "jordan",
  legalName: "Jordan Ellis",
  email: "jordan.ellis@demo.stabl.app",
  earnType: "commission",
  payFrequency: "biweekly",
  timezone: "America/Chicago",
  items: [
    {
      key: "jordan-main",
      label: "First Platypus Bank",
      accounts: [
        {
          key: "checking",
          name: "Checking",
          officialName: "Premier Checking",
          mask: "2208",
          type: "depository",
          subtype: "checking",
          homeBase: true,
        },
        {
          key: "card",
          name: "Rewards Card",
          officialName: "Platypus Rewards Visa",
          mask: "9031",
          type: "credit",
          subtype: "credit card",
        },
      ],
    },
  ],
  openingCents: { card: 0 },
  targetEndCheckingCents: 3_400_00,
  build(g: Gen) {
    // Base pay every other Friday.
    let payday = g.day(-180);
    while (new Date(`${payday}T00:00:00Z`).getUTCDay() !== 5) payday = g.day(g.offsetOf(payday) + 1);
    for (let d = payday; d <= g.end; d = g.day(g.offsetOf(d) + 14)) {
      g.add("checking", d, 1_200_00, "PAYROLL ELLIS MOTORS");
    }
    const commissions = [3_150_00, 0, 1_850_00, 4_000_00, 620_00, 2_400_00, 1_100_00];
    let i = 0;
    g.monthly(15, (d) => g.add("checking", d, commissions[i++ % commissions.length], "PAYROLL ELLIS MOTORS COMM"));

    // Bills from checking
    g.monthly(1, (d) => g.spend("checking", d, 1_400_00, "WESTWOOD LOFTS RENT"));
    g.monthly(3, (d) => g.spend("checking", d, 412_00, "ALLY AUTO PAYMENT"));
    g.monthly(9, (d) => g.spend("checking", d, 168_00, "STATE FARM INSURANCE"));
    g.monthly(16, (d) => g.spend("checking", d, g.cents(88, 131), "ENTERGY LA"));
    g.monthly(20, (d) => g.spend("checking", d, 95_00, "VERIZON WIRELESS"));

    // Everyday spending on the card, paid off from checking each month.
    const card = new Gen(g.start, g.end, 11);
    everyday(card, "card", {
      grocers: ["KROGER", "WALMART SUPERCENTER"],
      groceryDollars: [50, 90],
      fuel: ["SHELL OIL", "EXXONMOBIL"],
      fuelDollars: [35, 55],
      dining: ["WINGSTOP 702", "CHIPOTLE 2291", "STARBUCKS STORE 0921", "OUTBACK 3301"],
      diningPerWeek: 1.5,
      diningDollars: [10, 40],
      shops: ["AMAZON MKTP US", "NIKE COM", "BEST BUY 00412"],
      shopsPerMonth: 1.5,
      shopDollars: [20, 90],
    });
    card.monthly(10, (d) => card.spend("card", d, 15_49, "NETFLIX COM"));
    card.monthly(24, (d) => card.spend("card", d, 10_99, "SPOTIFY USA"));
    card.spend("card", card.day(-96), 214_00, "FIRESTONE 0381");
    card.spend("card", card.day(-41), 175_00, "BIRTHDAY DINNER RUTHS CHRIS");
    g.txns.push(...card.txns);

    // Pay the card in full on the 25th for whatever was charged since the last payment.
    let lastPaid = g.start;
    g.monthly(25, (d) => {
      const owed = card.txns
        .filter((t) => t.date >= lastPaid && t.date < d)
        .reduce((sum, t) => sum - t.amountCents, 0);
      lastPaid = d;
      if (owed <= 0) return;
      g.spend("checking", d, owed, "CAPITAL ONE MOBILE PMT");
      g.add("card", g.day(Math.min(0, g.offsetOf(d) + 1)), owed, "PAYMENT THANK YOU");
    });
  },
};
