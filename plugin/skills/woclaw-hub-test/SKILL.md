# WoClaw Hub Diagnostic Skill

A skill to test and verify WoClaw Hub connectivity from within OpenClaw.

## Commands

### `/woclaw-test connect`
Test connection to WoClaw Hub. Reports:
- WebSocket connectivity
- REST API health
- Topic list
- Agent authentication status

### `/woclaw-test topics`
List all available topics on the Hub.

### `/woclaw-test memory [key]`
Read a value from shared memory pool.

### `/woclaw-test memwrite <key> <value>`
Write a value to shared memory pool.

## Configuration

Requires the following environment variables or config entries:

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAWLINK_HUB_URL` | WoClaw Hub WebSocket URL | `ws://vm153:8082` |
| `CLAWLINK_REST_URL` | WoClaw Hub REST URL | `http://vm153:8083` |
| `CLAWLINK_AGENT_ID` | Unique agent identifier | `openclaw-{hostname}` |
| `CLAWLINK_TOKEN` | Authentication token | `ClawLink2026` |

## Example

```
/woclaw-test connect
/woclaw-test topics
/woclaw-test memory project-context
/woclaw-test memwrite last-seen "2026-04-01"
```
