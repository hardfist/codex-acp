# Code Mode tool events

This fork adds live Code Mode tool events to `codex-acp` v1.13.1.
New threads subscribe to the Codex app-server's experimental raw response items.
An outer `custom_tool_call` named `exec` becomes an ACP `tool_call` containing
the JavaScript source. Its matching `custom_tool_call_output` becomes a
`tool_call_update` containing the original output in `rawOutput`.
The adapter pairs these events by `call_id` and ignores duplicate notifications.
Nested command and MCP events keep their existing mappings.

The adapter marks the wrapper as failed when Codex reports `Script failed` or
`Script error:`. If a turn ends before the wrapper returns output, the adapter
also closes its pending tool call as failed. A completed wrapper can return a
running cell ID; it does not imply that every background operation has finished.

## Scope

Live wrapper events are available for newly started threads, including
`acpx codex exec`. They do not reconstruct a parent-child graph for nested calls.
The Codex app-server only exposes the raw-event opt-in on `thread/start`.
Resuming a thread after restarting app-server does not enable raw events, and
this change does not add history replay for custom calls.

## Verify

Enable `features.code_mode = true` in the Codex configuration, build the adapter,
and run a read-only prompt through your ACP client:

```text
Use Code Mode's exec tool to execute JavaScript: text([17, 23, 41].reduce((a, b) => a + b, 0));
```

The client receives `Code Mode exec` with the script, followed by a completed
update whose output contains `81`.

Local checks:

```sh
npm run typecheck
npm test
npm run build
```
