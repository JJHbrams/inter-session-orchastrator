# Live validation runbook

`npm test` proves isolated SQLite, HTTP/MCP protocol surface, idempotency, writer fencing, and restart-to-unknown behavior. It does not prove any provider accepted, started, or replied to a request.

Run `npm start`, create a room, register only a newly authorized canary with its exact provider/host/native ID/cwd/profile and actual ownership, join it, then provision a room token. A canary created by an operator inside Orca is host-owned/borrowed. Save the private token only in the selected participant's environment or `.local` config and use `node packages/mcp/participant.js --config .local/participant.json inbox` to pull. A pull proves inbox access, not that the participant is awake. A `reply` with its exact request ID records a correlated reply. Existing discovered Orca sessions remain read-only until their identity, policy, draft, and control capabilities are independently verified.

2026-10-22 pilot: two new actual models produced three correlated replies and one unconfirmed chair proposal through the HTTP helper. Separate actual MCP stdio initialize/tools/context was verified. Browser paths passed at 1440x900 and 1280x800. See `docs/runtime-validation.md` and `docs/validation/runtime.json`.

Remaining full-live criteria: original V-01 through V-13, generic existing cross-project Orca terminal-to-native-ID mapping, effective policy/draft observations, automatic host submission and turn/reply reconciliation, provider lifecycle, and a dedicated third chair. Preserve the distinction from the manual new-canary pilot. Do not resend unresolved submissions to create test evidence.
