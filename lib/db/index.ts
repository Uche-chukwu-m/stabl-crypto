import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// One pool per server instance. Neon's pooled connection string works here, and
// so does a local Postgres for development and tests.
const globalForDb = globalThis as unknown as { stablPool?: Pool };

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new Pool({
    connectionString: url,
    max: 5,
    ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: true } : undefined,
  });
}

export const pool = globalForDb.stablPool ?? makePool();
if (process.env.NODE_ENV !== "production") globalForDb.stablPool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
// A transaction handle has the same query API as the db.
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;
export { schema };
