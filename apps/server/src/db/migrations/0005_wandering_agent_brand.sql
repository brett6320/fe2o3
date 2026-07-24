ALTER TABLE "orgs" ADD COLUMN "mirror_url" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "mirror_branch" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "mirror_token_enc" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "mirror_ssh_key_enc" text;