# Godot Runtime Event Protocol

The runtime bridge writes append-only JSONL to `GODOT_HARNESS_EVENTS`.

Each complete line is one event:

```json
{
  "schema_version": "0.1",
  "source": "REAL",
  "run_id": "run-123",
  "sequence": 1,
  "timestamp": "2026-09-06T04:00:00.000Z",
  "event": "level_started",
  "payload": { "scene": "res://main.tscn" }
}
```

## Rules

- `run_id` identifies one Godot process and must not change within a file.
- `sequence` starts at `1` and increases strictly by event order.
- Writers append a newline after every complete event. A partial final line is ignored until the next poll.
- Readers reject malformed JSON, schema-invalid events, mixed run IDs, and non-increasing sequences while retaining an `invalid_lines` record.
- Event payloads are JSON objects and must not contain credentials or host secrets.

## Subscription lifecycle

Subscriptions are persisted in `subscriptions.json` and have independent `subscription_id`, `run_id` cursor, filter, status, pending cursor, and ACK deadline.

```text
ACTIVE -> PAUSED -> ACTIVE
ACTIVE -> CANCELLED
ACTIVE -> CLOSED
PAUSED -> CANCELLED
PAUSED -> CLOSED
```

Polling delivers events without advancing the acknowledged cursor. The delivered cursor is stored as `pending_cursor`; clients call `ack_event_subscription` to commit it. If `ack_deadline_at` expires, the subscription enters `PAUSED` and redelivery resumes after a valid ACK/reconnect. Replayed events must be deduplicated by `(run_id, sequence)` by the client.

MCP continuous subscriptions emit each event through the official SDK `notifications/message` logging notification. The notification data contains the same event object returned by the subscription tool. Clients should persist the latest acknowledged cursor and recreate or poll the same `subscription_id` after transport loss.
