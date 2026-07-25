ALTER TABLE "devices" ADD COLUMN "uptime_seconds" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "uptime_captured_at" timestamp with time zone;