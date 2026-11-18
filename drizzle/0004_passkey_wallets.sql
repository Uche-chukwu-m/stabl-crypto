ALTER TABLE "chain_wallets" ALTER COLUMN "circle_wallet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_wallets" ADD COLUMN "kind" text DEFAULT 'circle' NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_wallets" ADD COLUMN "previous_address" text;--> statement-breakpoint
ALTER TABLE "chain_wallets" ADD COLUMN "previous_circle_wallet_id" text;--> statement-breakpoint
ALTER TABLE "chain_wallets" ADD COLUMN "passkey_at" timestamp with time zone;