// Scripts read the same env files as Next.js: .env.local wins over .env.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
