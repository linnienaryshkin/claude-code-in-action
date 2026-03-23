// @vitest-environment node
import { test, expect, vi } from "vitest";
import { MockLanguageModel } from "@/lib/provider";

// ── Helpers ───────────────────────────────────────────────────────────────────

function userMsg(text: string) {
  return { role: "user" as const, content: [{ type: "text" as const, text }] };
}

function toolMsg() {
  return {
    role: "tool" as const,
    content: [{ type: "tool-result" as const, toolCallId: "x", toolName: "x", result: "ok" }],
  };
}

/** Stub out the internal delay so tests don't spend forever trickling characters */
function instantModel(id = "test-model") {
  const model = new MockLanguageModel(id);
  vi.spyOn(model as any, "delay").mockResolvedValue(undefined);
  return model;
}

function generate(model: MockLanguageModel, messages: any[]) {
  return model.doGenerate({ prompt: messages } as any);
}

async function streamParts(model: MockLanguageModel, messages: any[]) {
  const { stream } = await model.doStream({ prompt: messages } as any);
  const reader = stream.getReader();
  const parts: any[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return parts;
}

// ── Constructor ───────────────────────────────────────────────────────────────

test("assigns modelId from the constructor argument", () => {
  const m = new MockLanguageModel("fancy-llm");
  expect(m.modelId).toBe("fancy-llm");
});

test("exposes the required LanguageModelV1 metadata", () => {
  const m = new MockLanguageModel("x");
  expect(m.specificationVersion).toBe("v1");
  expect(m.provider).toBe("mock");
  expect(m.defaultObjectGenerationMode).toBe("tool");
});

// ── Step 0: first call (0 tool messages) ─────────────────────────────────────

test("step 0 — creates /App.jsx via str_replace_editor", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter")]);

  expect(result.toolCalls).toHaveLength(1);
  const args = JSON.parse(result.toolCalls![0].args);
  expect(args.command).toBe("create");
  expect(args.path).toBe("/App.jsx");
});

test("step 0 — finishReason is tool-calls", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter")]);
  expect(result.finishReason).toBe("tool-calls");
});

test("step 0 — response text mentions the API key", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter")]);
  expect(result.text).toMatch(/api key/i);
});

// ── Component-type detection ──────────────────────────────────────────────────

test("'form' in prompt → ContactForm component path", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("build a contact form"), toolMsg()]);
  const args = JSON.parse(result.toolCalls![0].args);
  expect(args.path).toContain("ContactForm");
});

test("'card' in prompt → Card component path", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("show me a nice card"), toolMsg()]);
  const args = JSON.parse(result.toolCalls![0].args);
  expect(args.path).toContain("Card");
});

test("unrecognised prompt falls back to Counter", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("surprise me"), toolMsg()]);
  const args = JSON.parse(result.toolCalls![0].args);
  expect(args.path).toContain("Counter");
});

// ── Step 1: one tool message ──────────────────────────────────────────────────

test("step 1 — creates the component file", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter"), toolMsg()]);

  expect(result.toolCalls).toHaveLength(1);
  const args = JSON.parse(result.toolCalls![0].args);
  expect(args.command).toBe("create");
  expect(args.file_text).toMatch(/export default/);
});

test("step 1 — announcement text names the component", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter"), toolMsg()]);
  expect(result.text).toMatch(/counter/i);
});

// ── Step 2: two tool messages ─────────────────────────────────────────────────

test("step 2 — issues a str_replace command", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter"), toolMsg(), toolMsg()]);

  expect(result.toolCalls).toHaveLength(1);
  const args = JSON.parse(result.toolCalls![0].args);
  expect(args.command).toBe("str_replace");
});

test("step 2 — new_str actually differs from old_str", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter"), toolMsg(), toolMsg()]);
  const { old_str, new_str } = JSON.parse(result.toolCalls![0].args);
  expect(new_str).not.toBe(old_str);
  expect(new_str.length).toBeGreaterThan(0);
});

// ── Step 3+: ≥3 tool messages ─────────────────────────────────────────────────

test("step 3+ — no tool calls in the final summary", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter"), toolMsg(), toolMsg(), toolMsg()]);
  expect(result.toolCalls).toHaveLength(0);
});

test("step 3+ — finishReason is stop", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter"), toolMsg(), toolMsg(), toolMsg()]);
  expect(result.finishReason).toBe("stop");
});

test("step 3+ — summary mentions the component and App.jsx", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("make a counter"), toolMsg(), toolMsg(), toolMsg()]);
  expect(result.text).toMatch(/counter/i);
  expect(result.text).toMatch(/app\.jsx/i);
});

// ── doGenerate response envelope ─────────────────────────────────────────────

test("doGenerate includes an empty warnings array", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("x")]);
  expect(Array.isArray(result.warnings)).toBe(true);
  expect(result.warnings).toHaveLength(0);
});

test("doGenerate rawCall echoes back the original prompt", async () => {
  const m = instantModel();
  const msgs = [userMsg("hi")];
  const result = await generate(m, msgs);
  expect((result.rawCall as any).rawPrompt).toEqual(msgs);
});

test("doGenerate returns token usage", async () => {
  const m = instantModel();
  const result = await generate(m, [userMsg("hi")]);
  expect(result.usage.promptTokens).toBeGreaterThan(0);
  expect(result.usage.completionTokens).toBeGreaterThan(0);
});

// ── doStream ──────────────────────────────────────────────────────────────────

test("doStream returns a ReadableStream", async () => {
  const m = instantModel();
  const { stream } = await m.doStream({ prompt: [userMsg("hi")] } as any);
  expect(stream).toBeInstanceOf(ReadableStream);
});

test("doStream emits text-delta parts", async () => {
  const m = instantModel();
  const parts = await streamParts(m, [userMsg("make a counter")]);
  expect(parts.some((p) => p.type === "text-delta")).toBe(true);
});

test("doStream ends with a finish part", async () => {
  const m = instantModel();
  const parts = await streamParts(m, [userMsg("make a counter")]);
  expect(parts.at(-1)?.type).toBe("finish");
});

test("doStream includes a tool-call part with the right toolName", async () => {
  const m = instantModel();
  const parts = await streamParts(m, [userMsg("make a counter")]);
  const toolCall = parts.find((p) => p.type === "tool-call");
  expect(toolCall).toBeDefined();
  expect(toolCall.toolName).toBe("str_replace_editor");
});

test("doStream concatenated text matches doGenerate text", async () => {
  const msgs = [userMsg("make a counter")];
  const m1 = instantModel();
  const m2 = instantModel();

  const parts = await streamParts(m1, msgs);
  const streamedText = parts
    .filter((p) => p.type === "text-delta")
    .map((p) => p.textDelta)
    .join("");

  const { text } = await generate(m2, msgs);
  expect(streamedText).toBe(text);
});

test("doStream response envelope has warnings and rawCall", async () => {
  const m = instantModel();
  const { warnings, rawCall } = await m.doStream({ prompt: [userMsg("hi")] } as any);
  expect(Array.isArray(warnings)).toBe(true);
  expect(rawCall).toBeDefined();
});
