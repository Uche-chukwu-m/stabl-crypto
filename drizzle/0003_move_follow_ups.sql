ALTER TABLE "moves" ADD COLUMN "follow_ups_json" jsonb;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "follow_ups_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "follow_ups_done_at" timestamp with time zone;--> statement-breakpoint
-- Moves settled before this migration already had their follow-ups done.
UPDATE "moves" SET "follow_ups_done_at" = COALESCE("settled_at", "created_at") WHERE "state" = 'settled';
