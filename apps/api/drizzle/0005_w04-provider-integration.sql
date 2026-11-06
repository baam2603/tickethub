-- Ho tro DB legacy W05 co MV tham chieu orders.status; giu lai dinh nghia/index, khong them tinh nang W05.
DO $$ DECLARE saved_views jsonb := '[]'::jsonb; saved_indexes text[]; item record; entry jsonb; definition text;
BEGIN
 IF (SELECT character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='status') IS DISTINCT FROM 32 THEN
  FOR item IN SELECT m.matviewname,pg_get_viewdef(c.oid) AS view_definition,c.relacl,c.relowner
   FROM pg_matviews m JOIN pg_namespace n ON n.nspname=m.schemaname JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=m.matviewname
   WHERE m.schemaname='public' AND m.matviewname IN ('mv_event_sales_summary','mv_event_ticket_sales','mv_event_report_daily','mv_event_report_facts') ORDER BY m.matviewname LOOP
   IF item.relacl IS NOT NULL OR item.relowner <> (SELECT oid FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Custom report MV ownership/grants require a reviewed migration';
   END IF;
   saved_views := saved_views || jsonb_build_array(jsonb_build_object('name',item.matviewname,'sql',item.view_definition));
  END LOOP;
  SELECT array_agg(indexdef ORDER BY indexname) INTO saved_indexes FROM pg_indexes WHERE schemaname='public' AND tablename IN ('mv_event_sales_summary','mv_event_ticket_sales','mv_event_report_daily','mv_event_report_facts');
  FOR entry IN SELECT value FROM jsonb_array_elements(saved_views) LOOP EXECUTE format('DROP MATERIALIZED VIEW public.%I',entry->>'name'); END LOOP;
  ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE varchar(32);
  FOR entry IN SELECT value FROM jsonb_array_elements(saved_views) LOOP EXECUTE format('CREATE MATERIALIZED VIEW public.%I AS %s',entry->>'name',entry->>'sql'); END LOOP;
  FOREACH definition IN ARRAY coalesce(saved_indexes,ARRAY[]::text[]) LOOP EXECUTE definition; END LOOP;
 END IF;
END $$;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "vnp_create_date" varchar(14);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "payment_url" varchar(4000);--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "provider_request_id" varchar(32);--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='refunds_provider_request_id_unique' AND conrelid='public.refunds'::regclass) THEN ALTER TABLE "refunds" ADD CONSTRAINT "refunds_provider_request_id_unique" UNIQUE("provider_request_id"); END IF; END $$;
