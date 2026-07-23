ALTER TABLE tetris_analytics.game_events
    DROP CONSTRAINT game_events_shape_check;

ALTER TABLE tetris_analytics.game_events
    ADD CONSTRAINT game_events_shape_check
        CHECK (
            (
                event_type IN ('game_start', 'game_over')
                AND schema_version IN (1, 2)
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
        );
