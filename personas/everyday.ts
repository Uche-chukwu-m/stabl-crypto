import type { Gen } from "./gen";

type Everyday = {
  grocers: string[];
  groceryDollars: [number, number];
  fuel?: string[];
  fuelDollars?: [number, number];
  dining: string[];
  diningPerWeek: number;
  diningDollars: [number, number];
  shops: string[];
  shopsPerMonth: number;
  shopDollars: [number, number];
  transit?: string;
};

// Weekly groceries and gas, a few meals out, and some shopping. The texture that
// makes a bank feed look like a real person's.
export function everyday(g: Gen, account: string, e: Everyday) {
  g.weekly(6, (date) => g.spend(account, date, g.cents(...e.groceryDollars), `${g.pick(e.grocers)} #${g.storeNumber()}`), 1);

  if (e.fuel && e.fuelDollars) {
    const fuel = e.fuel;
    const dollars = e.fuelDollars;
    g.weekly(3, (date) => g.spend(account, date, g.cents(...dollars), `${g.pick(fuel)} ${g.storeNumber()}`), 1);
  }

  g.weekly(
    5,
    (date) => {
      const meals = Math.round(e.diningPerWeek + (g.random() - 0.5));
      for (let i = 0; i < meals; i++) {
        g.spend(account, g.day(g.offsetOf(date) - g.int(0, 5)), g.cents(...e.diningDollars), g.pick(e.dining));
      }
    },
    0,
  );

  const shopGap = Math.round(30 / e.shopsPerMonth);
  g.everyDays(Math.max(3, shopGap - 4), shopGap + 4, (date) => g.spend(account, date, g.cents(...e.shopDollars), g.pick(e.shops)));

  if (e.transit) {
    const transit = e.transit;
    g.everyDays(10, 20, (date) => g.spend(account, date, g.cents(10, 30), transit));
  }
}
