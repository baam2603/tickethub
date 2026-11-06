ALTER TABLE "refunds" ADD COLUMN "provider_group_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "provider_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_provider_group_id_refunds_id_fk" FOREIGN KEY ("provider_group_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;
