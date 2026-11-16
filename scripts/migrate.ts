// npm run db:migrate. Applies every migration in ./drizzle, including the custom
// one that creates the vault balance view and the insert only ledger trigger.
import "./env";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/lib/db";

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await pool.end();
