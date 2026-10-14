import type { On } from "claude-code";
import { expect, mock, type TestBody, test } from "claude-code/testing";

/** What `leverage claude` starts Claude Code with. */
const LAUNCHED = {
	LEVERAGE_CLAUDE_URL: "https://leverage.test",
	LEVERAGE_CLAUDE_TOKEN: "lev_cl_test",
	LEVERAGE_CLAUDE_SESSION: "s-1",
};

// A turn in which Leverage's model runs a command.
const STEP = {
	blocks: [
		{ kind: "tool", id: "call-1", name: "Bash", input: { command: "ls" } },
	],
	stop: "tool_use",
	cursor: 9,
	turnId: "turn-1",
	context: null,
	question: null,
};

// Stands in for a Leverage that fails `failing`, and for the engine beneath,
// recording what reaches it: what Leverage should have done, done here.
function fakeLeverage(on: On, failing: string) {
	const here: string[] = [];
	const filled: string[] = [];
	mock.env(on, LAUNCHED);
	const clock = mock.clock(on);
	on("http.fetch", ($, e) => {
		const path = new URL(e.url).pathname.replace(/^\/api\/claude/, "");
		const [, id, action] = path.match(/^\/sessions\/([^/]+)\/?(.*)$/) ?? [];
		if (action?.startsWith(failing)) {
			const text = "Leverage is down";
			return { value: { status: 500, ok: false, headers: {}, text } };
		}
		let answer: unknown = { workspace: "acme", channels: [], direct: [] };
		if (id && !action) answer = { id, title: id, cursor: 7 };
		if (action === "prompts")
			answer = { prompts: [], notices: [], last: 7, viewers: [], typing: [] };
		if (action === "step") answer = STEP;
		const text = JSON.stringify(answer ?? { ok: true });
		return { value: { status: 200, ok: true, headers: {}, text } };
	});
	on("tool.call", ($, e) => {
		here.push(`tool ${e.tool}`);
		return { result: "ran here" as never };
	});
	on("prompt.submit", ($, e) => {
		here.push(`prompt ${e.text}`);
		return { text: e.text };
	});
	on("prompt.fill", ($, e) => {
		filled.push(e.text);
		return { isFilled: true };
	});
	on("session.compact", () => {
		here.push("compact");
		return { skip: "compacted here" };
	});
	on("command.run", ($, e) => {
		here.push(`/${e.command}`);
		return { text: "" };
	});
	on("session.start", ($, e) => ({ cwd: e.cwd }));
	for (const event of [
		"tool.register",
		"command.register",
		"ui.open",
		"ui.status",
	] as const)
		on(event, () => ({ value: {} }) as never);
	return { here, filled, clock };
}

/** A window `leverage claude` opened on s-1, its earlier turns read. */
async function start(
	$: Parameters<TestBody>[0],
	leverage: ReturnType<typeof fakeLeverage>,
) {
	await $.session.start({
		cwd: "/work",
		surface: "terminal",
		isInteractive: true,
	});
	await leverage.clock.advance(1500);
}

test("a command whose result Leverage does not return never runs here", async ($, on) => {
	const leverage = fakeLeverage(on, "results");
	await start($, leverage);
	for await (const _ of $.turn.step({
		turnId: "turn-1",
		index: 0,
		model: "leverage",
		messageCount: 1,
	}));
	const answer = await $.tool.call({
		tool: "Bash",
		tool_use_id: "call-1",
		command: "ls",
	} as never);
	expect(leverage.here).toEqual([]);
	expect(answer.deny).toContain("Leverage answered 500");
});

test("a prompt Leverage does not take goes back to the box", async ($, on) => {
	const leverage = fakeLeverage(on, "messages");
	await start($, leverage);
	const answer = await $.prompt.submit({
		text: "fix the login",
		wait: false,
		origin: { kind: "composer" },
	});
	expect(answer.drop).toContain("Not sent to Leverage");
	expect(leverage.filled).toEqual(["fix the login"]);
	expect(leverage.here).toEqual([]);
});

test("a compaction Leverage does not do is not done here", async ($, on) => {
	const leverage = fakeLeverage(on, "compact");
	await start($, leverage);
	const answer = await $.session.compact({ trigger: "manual" } as never);
	expect(answer.skip).toContain("Leverage did not compact");
	expect(leverage.here).toEqual([]);
});

test("a rename Leverage does not do is not done here", async ($, on) => {
	const leverage = fakeLeverage(on, "rename");
	await start($, leverage);
	const answer = await $.command.run({
		command: "rename",
		args: "login bug",
	} as never);
	expect(answer.text).toContain("Leverage did not rename");
	expect(leverage.here).toEqual([]);
});
