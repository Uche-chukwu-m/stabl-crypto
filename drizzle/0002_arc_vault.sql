CREATE TABLE "chain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"units" text,
	"ref" text,
	"balance_units" text,
	"user_id" uuid,
	"move_id" uuid,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_events_tx_log_unique" UNIQUE("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "chain_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"move_id" uuid,
	"units" text,
	"chain_tx_id" text,
	"tx_hash" text,
	"state" text DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"circle_wallet_id" text NOT NULL,
	"address" text NOT NULL,
	"blockchain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_wallets_circle_wallet_id_unique" UNIQUE("circle_wallet_id"),
	CONSTRAINT "chain_wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "chain_tx_id" text;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "tx_hash" text;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "chain_block" bigint;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "meta_json" jsonb;--> statement-breakpoint
ALTER TABLE "chain_events" ADD CONSTRAINT "chain_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_events" ADD CONSTRAINT "chain_events_move_id_moves_id_fk" FOREIGN KEY ("move_id") REFERENCES "public"."moves"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_ops" ADD CONSTRAINT "chain_ops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_ops" ADD CONSTRAINT "chain_ops_move_id_moves_id_fk" FOREIGN KEY ("move_id") REFERENCES "public"."moves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_wallets" ADD CONSTRAINT "chain_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chain_events_user" ON "chain_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "chain_ops_user" ON "chain_ops" USING btree ("user_id","created_at");