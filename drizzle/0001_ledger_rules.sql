-- The vault balance is never stored. It is the sum of the ledger.
CREATE VIEW "vault_balances" AS
  SELECT v.id AS vault_id, COALESCE(SUM(l.amount_cents), 0)::integer AS balance_cents
  FROM "vault_accounts" v
  LEFT JOIN "ledger_entries" l ON l.vault_id = v.id
  GROUP BY v.id;
--> statement-breakpoint
-- The ledger is insert only. Updates are never allowed. Deletes are allowed only
-- inside a transaction that sets stabl.allow_ledger_delete, which the "delete my
-- data" and demo reset paths do; nothing else can rewrite money history.
CREATE FUNCTION "ledger_entries_insert_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('stabl.allow_ledger_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ledger_entries is insert only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_update"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_insert_only"();
--> statement-breakpoint
-- A vault can never go below zero: a release or emergency entry that would make
-- the sum negative is rejected.
CREATE FUNCTION "ledger_entries_no_overdraw"() RETURNS trigger AS $$
DECLARE balance integer;
BEGIN
  PERFORM 1 FROM "vault_accounts" WHERE id = NEW.vault_id FOR UPDATE;
  SELECT COALESCE(SUM(amount_cents), 0) INTO balance FROM "ledger_entries" WHERE vault_id = NEW.vault_id;
  IF balance + NEW.amount_cents < 0 THEN
    RAISE EXCEPTION 'vault % would go below zero', NEW.vault_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_balance_check"
  BEFORE INSERT ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_no_overdraw"();
