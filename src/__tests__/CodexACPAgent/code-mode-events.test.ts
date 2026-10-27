import {describe, expect, it} from "vitest";
import type {ResponseItem, ServerNotification} from "../../app-server";
import {CodexEventHandler} from "../../CodexEventHandler";
import {createCodexMockTestFixture, createTestFixture, createTestSessionState} from "../acp-test-utils";

const sessionId = "code-mode-session";
const turnId = "code-mode-turn";
const script = 'const r = await tools.exec_command({cmd: "pwd"});\ntext(r.output);';

function raw(item: ResponseItem): ServerNotification {
    return {method: "rawResponseItem/completed", params: {threadId: sessionId, turnId, item}};
}

function call(callId = "outer-exec"): ServerNotification {
    return raw({type: "custom_tool_call", call_id: callId, name: "exec", input: script});
}

function output(text: string, callId = "outer-exec"): ServerNotification {
    return raw({type: "custom_tool_call_output", call_id: callId, output: text});
}

function fixture() {
    const mock = createCodexMockTestFixture();
    const handler = new CodexEventHandler(mock.getAcpConnection(), createTestSessionState({sessionId}));
    return {mock, handler};
}

describe("Code Mode tool events", () => {
    it("subscribes to raw response items for new sessions", async () => {
        const mock = createTestFixture();
        const agent = mock.getCodexAcpAgent();
        await agent.initialize({protocolVersion: 1});
        await mock.getCodexAppServerClient().threadStart({cwd: "/test/cwd"});
        expect(mock.getCodexConnectionEvents([])).toContainEqual(expect.objectContaining({
            eventType: "request",
            method: "thread/start",
            params: expect.objectContaining({experimentalRawEvents: true}),
        }));
    });

    it("shows the outer script and its complete text output", async () => {
        const {mock, handler} = fixture();
        await handler.handleNotification(call());
        await handler.handleNotification(raw({
            type: "custom_tool_call_output", call_id: "outer-exec", output: [
                {type: "input_text", text: "Script completed\nOutput:\n"},
                {type: "input_text", text: "/test/cwd"},
            ],
        }));
        expect(mock.getAcpConnectionEvents([])).toHaveLength(2);
        await expect(mock.getAcpConnectionDump([])).toMatchFileSnapshot("data/code-mode-events.json");
    });

    it("does not repeat duplicate call and output notifications", async () => {
        const {mock, handler} = fixture();
        for (const event of [call(), call(), output("Script completed"), output("Script completed"), call()]) {
            await handler.handleNotification(event);
        }
        expect(mock.getAcpConnectionEvents([])).toHaveLength(2);
    });

    it("ignores other raw tool calls and outputs without a matching exec", async () => {
        const {mock, handler} = fixture();
        for (const event of [
            raw({type: "function_call", call_id: "shell", name: "exec_command", arguments: '{"cmd":"pwd"}'}),
            raw({type: "custom_tool_call", call_id: "patch", name: "apply_patch", input: "patch"}),
            output("Script completed", "unknown"),
        ]) {
            await handler.handleNotification(event);
        }
        expect(mock.getAcpConnectionEvents([])).toEqual([]);
    });

    it.each(["Script failed\nOutput:\nError: test", "Script error:\nSyntaxError: test"])(
        "reports a failed execution for %s", async (message) => {
            const {mock, handler} = fixture();
            await handler.handleNotification(call());
            await handler.handleNotification(output(message));
            expect(mock.getAcpConnectionEvents([])).toContainEqual(expect.objectContaining({
                method: "sessionUpdate",
                args: [expect.objectContaining({update: expect.objectContaining({
                    sessionUpdate: "tool_call_update", toolCallId: "outer-exec", status: "failed",
                })})],
            }));
        },
    );

    it("does not mistake printed error text for a script failure", async () => {
        const {mock, handler} = fixture();
        await handler.handleNotification(call());
        await handler.handleNotification(output("Script completed\nOutput:\nError: this is printed data"));
        expect(mock.getAcpConnectionEvents([])).toContainEqual(expect.objectContaining({
            args: [expect.objectContaining({update: expect.objectContaining({status: "completed"})})],
        }));
    });

    it("closes an unfinished outer call when its turn is interrupted", async () => {
        const {mock, handler} = fixture();
        await handler.handleNotification(call());
        await handler.handleNotification({
            method: "turn/completed", params: {threadId: sessionId, turn: {
                id: turnId, items: [], itemsView: "notLoaded", status: "interrupted", error: null,
                startedAt: null, completedAt: null, durationMs: null,
            }},
        });
        expect(mock.getAcpConnectionEvents([])).toContainEqual(expect.objectContaining({
            args: [expect.objectContaining({update: expect.objectContaining({
                sessionUpdate: "tool_call_update", toolCallId: "outer-exec", status: "failed",
            })})],
        }));
        await handler.dispose();
        expect(mock.getAcpConnectionEvents([])).toHaveLength(2);
    });
});
