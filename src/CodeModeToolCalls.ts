import type {UpdateSessionEvent} from "./ACPSessionConnection";
import type {RawResponseItemCompletedNotification} from "./app-server/v2";
import {functionToolName} from "./ToolCallName";

type CodeModeCall = {
    threadId: string;
    turnId: string;
    state: "running" | "finished";
};

export class CodeModeToolCalls {
    private readonly calls = new Map<string, CodeModeCall>();

    handle({threadId, turnId, item}: RawResponseItemCompletedNotification): UpdateSessionEvent | null {
        if (item.type === "custom_tool_call") {
            if (item.name !== "exec" || this.calls.has(item.call_id)) return null;
            this.calls.set(item.call_id, {threadId, turnId, state: "running"});
            return {
                sessionUpdate: "tool_call",
                toolCallId: item.call_id,
                name: functionToolName(item.name, item.namespace),
                title: "Code Mode exec",
                kind: "execute",
                status: "in_progress",
                rawInput: {code: item.input},
            };
        }
        if (item.type !== "custom_tool_call_output") return null;
        const call = this.calls.get(item.call_id);
        if (!call || call.state !== "running" || call.threadId !== threadId || call.turnId !== turnId) return null;
        call.state = "finished";
        const text = typeof item.output === "string"
            ? item.output
            : item.output.filter(part => part.type === "input_text").map(part => part.text).join("\n");
        return {
            sessionUpdate: "tool_call_update",
            toolCallId: item.call_id,
            status: /^Script (failed\b|error:)/.test(text) ? "failed" : "completed",
            rawOutput: {output: item.output},
            content: [{type: "content", content: {type: "text", text}}],
        };
    }

    finishTurn(threadId: string, turnId: string): UpdateSessionEvent[] {
        const updates: UpdateSessionEvent[] = [];
        for (const [toolCallId, call] of this.calls) {
            if (call.threadId !== threadId || call.turnId !== turnId) continue;
            this.calls.delete(toolCallId);
            if (call.state === "running") {
                updates.push({
                    sessionUpdate: "tool_call_update",
                    toolCallId,
                    status: "failed",
                    content: [{type: "content", content: {
                        type: "text",
                        text: "Codex ended the turn before Code Mode returned output.",
                    }}],
                });
            }
        }
        return updates;
    }
}
