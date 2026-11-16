// A fresh copy of Jemaya for filming, separate from the live demo account.
// Prints JSON for film/record.mjs: { userId, loginUrl }.
import "./env";
import { pool } from "@/lib/db";
import { demoLoginUrl } from "@/lib/demo/login";
import { seedPersona } from "@/lib/demo/seed";

const { userId } = await seedPersona("jemaya", { email: "jemaya.film@demo.stabl.app" });
console.log(JSON.stringify({ userId, loginUrl: await demoLoginUrl(userId) }));
await pool.end();
