CREATE TABLE tetris_analytics.game_events (
    identity_version text NOT NULL,
    event_id text PRIMARY KEY,
    event_type text NOT NULL,
    schema_version integer NOT NULL,
    game_id text NOT NULL,
    player_id text,
    piece_index integer,
    trust_level text NOT NULL,
    occurred_at timestamp with time zone,
    payload jsonb NOT NULL,
    event_sha256 text NOT NULL,
    ingested_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT game_events_identity_version_check
        CHECK (identity_version = 'identity-v1'),
    CONSTRAINT game_events_event_id_check
        CHECK (event_id ~ '^[0-9a-f]{64}$'),
    CONSTRAINT game_events_event_type_check
        CHECK (event_type IN ('game_start', 'placement_decision', 'game_over')),
    CONSTRAINT game_events_schema_version_check
        CHECK (schema_version > 0),
    CONSTRAINT game_events_game_id_check
        CHECK (pg_catalog.btrim(game_id) <> ''),
    CONSTRAINT game_events_player_id_check
        CHECK (player_id IS NULL OR pg_catalog.btrim(player_id) <> ''),
    CONSTRAINT game_events_piece_index_check
        CHECK (piece_index IS NULL OR piece_index >= 0),
    CONSTRAINT game_events_trust_level_check
        CHECK (trust_level IN ('server_authoritative', 'client_reported')),
    CONSTRAINT game_events_payload_check
        CHECK (pg_catalog.jsonb_typeof(payload) = 'object'),
    CONSTRAINT game_events_event_sha256_check
        CHECK (event_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT game_events_shape_check
        CHECK (
            (
                event_type IN ('game_start', 'game_over')
                AND schema_version = 1
                AND player_id IS NULL
                AND piece_index IS NULL
                AND occurred_at IS NOT NULL
                AND trust_level = 'server_authoritative'
            )
            OR
            (
                event_type = 'placement_decision'
                AND schema_version IN (1, 2)
                AND player_id IS NOT NULL
                AND piece_index IS NOT NULL
                AND piece_index >= 0
                AND (
                    schema_version = 1
                    OR occurred_at IS NOT NULL
                )
                AND trust_level IN ('client_reported', 'server_authoritative')
            )
        )
);

REVOKE ALL ON TABLE tetris_analytics.game_events FROM PUBLIC;

CREATE UNIQUE INDEX game_events_lifecycle_identity_uq
    ON tetris_analytics.game_events (event_type, game_id)
    WHERE event_type IN ('game_start', 'game_over');

CREATE UNIQUE INDEX game_events_placement_identity_uq
    ON tetris_analytics.game_events (event_type, game_id, player_id, piece_index)
    WHERE event_type = 'placement_decision';

CREATE INDEX game_events_game_id_idx
    ON tetris_analytics.game_events (game_id);

CREATE INDEX game_events_event_type_ingested_at_idx
    ON tetris_analytics.game_events (event_type, ingested_at);
