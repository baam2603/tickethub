ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "vnp_create_date" varchar(14);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "payment_url" varchar(4000);--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "provider_request_id" varchar(32);--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "next_retry_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_provider_request_id_unique" UNIQUE("provider_request_id");