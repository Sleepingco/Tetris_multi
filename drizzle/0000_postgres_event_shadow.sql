CREATE TABLE "game_events" (
    "idempotency_key" char(64) PRIMARY KEY NOT NULL,
    "event_type" text NOT NULL,
    "schema_version" integer NOT NULL,
    "game_id" text NOT NULL,
    "room_id" text,
    "player_id" text,
    "piece_index" integer,
    "occurred_at" timestamp with time zone,
    "payload" jsonb NOT NULL,
    "payload_sha256" char(64) NOT NULL,
    "stored_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "game_events_event_type_check"
        CHECK ("event_type" IN ('game_start', 'game_over', 'placement_decision')),
    CONSTRAINT "game_events_schema_version_check" CHECK ("schema_version" > 0),
    CONSTRAINT "game_events_game_id_check" CHECK (length("game_id") > 0),
    CONSTRAINT "game_events_piece_index_check" CHECK ("piece_index" IS NULL OR "piece_index" >= 0),
    CONSTRAINT "game_events_payload_check" CHECK (jsonb_typeof("payload") = 'object'),
    CONSTRAINT "game_events_payload_sha256_check" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "game_events_idempotency_key_check" CHECK ("idempotency_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "game_events_game_id_idx" ON "game_events" ("game_id");
--> statement-breakpoint
CREATE INDEX "game_events_room_id_idx" ON "game_events" ("room_id");
--> statement-breakpoint
CREATE INDEX "game_events_player_id_idx" ON "game_events" ("player_id");
