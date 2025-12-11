CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_date" timestamp with time zone NOT NULL,
	"location" text,
	"zip" text,
	"organizer" text,
	"price" text,
	"url" text NOT NULL,
	"image_url" text,
	"created_at" timestamp DEFAULT now(),
	"hidden" boolean DEFAULT false,
	"tags" text[],
	"interested_count" integer,
	"going_count" integer,
	"time_unknown" boolean DEFAULT false,
	"recurring_type" text,
	"recurring_end_date" timestamp with time zone,
	"favorite_count" integer DEFAULT 0,
	CONSTRAINT "events_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "submitted_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"location" text,
	"organizer" text,
	"price" text,
	"url" text,
	"image_url" text,
	"submitter_email" text,
	"submitter_name" text,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"source" text DEFAULT 'form' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "events_start_date_idx" ON "events" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "events_source_idx" ON "events" USING btree ("source");--> statement-breakpoint
CREATE INDEX "events_tags_idx" ON "events" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "submitted_events_status_idx" ON "submitted_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "submitted_events_created_at_idx" ON "submitted_events" USING btree ("created_at");