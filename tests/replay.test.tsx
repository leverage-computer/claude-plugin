import type { On } from "claude-code";
import { expect, mock, type TestBody, test } from "claude-code/testing";

/** What `leverage claude` starts Claude Code with. */
const LAUNCHED = {
	LEVERAGE_CLAUDE_URL: "https://leverage.test",
	LEVERAGE_CLAUDE_TOKEN: "lev_cl_test",
	LEVERAGE_CLAUDE_SESSION: "s-1",
};

// Two earlier turns: Ada's prompt, Grace's steer into it, then Ada's next.
const PROMPTS = [
	{
		uuid: "u-1",
		author: "Ada",
		text: "fix the login",
		images: 0,
		steer: false,
	},
	{
		uuid: "u-2",
		author: "Grace",
		text: "use the cookie",
		images: 0,
		steer: true,
	},
	{
		uuid: "u-3",
		author: "Ada",
		text: "now the tests",
		images: 1,
		steer: false,
	},
];
const FIRST = "Ada (in Leverage): fix the login";
const SECOND = "Ada (in Leverage): now the tests [1 image in Leverage]";

/** The session's steps, by the row each reads after. */
const STEPS: Record<string, unknown> = {
	"0": {
		blocks: [
			{ kind: "thinking", text: "The cookie is unset." },
			{ kind: "text", text: "Fixed the login." },
		],
		stop: "end_turn",
		cursor: 4,
		turnId: "turn-1",
		context: null,
		question: null,
	},
	"4": {
		blocks: [{ kind: "text", text: "The tests pass." }],
		stop: "end_turn",
		cursor: 9,
		turnId: "turn-2",
		context: null,
		question: null,
	},
};

const PANE = {
	plugin: "leverage",
	component: "Pane",
	requestId: "leverage",
	props: {
		title: "Leverage",
		isFocused: true,
		bodyColumns: 48,
		placement: "dock",
	} as never,
	viewport: { columns: 160, rows: 40, isFullscreen: true },
} as const;

// Stands in for Leverage and the engine beneath, and records what reaches them.
function fakeLeverage(on: On) {
	const asked: string[] = [];
	const submitted: string[] = [];
	const filled: string[] = [];
	const aborted: string[] = [];
	mock.env(on, LAUNCHED);
	const clock = mock.clock(on);
	// The kit of Claude Code 2.1.286, which CI runs, records no appends.
	const session = "session" in mock ? mock.session(on) : null;
	on("http.fetch", ($, e) => {
		const url = new URL(e.url);
		const path = url.pathname.replace(/^\/api\/claude/, "");
		asked.push(`${e.init?.method ?? "GET"} ${path}${url.search}`);
		const after = url.searchParams.get("after");
		let answer: unknown = {
			workspace: "acme",
			channels: [
				{
					id: "C1",
					name: "onboarding",
					sessions: [
						{ id: "s-1", title: "login bug", status: "idle" },
						{ id: "s-2", title: "pricing copy", status: "idle" },
					],
				},
			],
			direct: [],
		};
		const [, id, action] = path.match(/^\/sessions\/([^/]+)\/?(.*)$/) ?? [];
		if (id && !action) answer = { id, title: id, cursor: 9 };
		if (action === "read" || action === "messages") answer = { ok: true };
		if (action === "prompts") {
			answer = {
				prompts: after === "0" && id === "s-1" ? PROMPTS : [],
				notices:
					after === "0" && id === "s-1"
						? [{ seq: 5, text: "Leverage compacted the session." }]
						: [],
				last: 9,
				viewers: [],
				typing: [],
			};
		}
		if (action === "step") answer = STEPS[after ?? ""];
		return {
			value: {
				status: 200,
				ok: true,
				headers: {},
				text: JSON.stringify(answer),
			},
		};
	});
	on("prompt.submit", ($, e) => {
		submitted.push(e.text);
		return { text: e.text };
	});
	on("prompt.fill", ($, e) => {
		filled.push(e.text);
		return { isFilled: true };
	});
	on("turn.abort", ($, e) => {
		aborted.push(e.turnId);
		return { value: undefined } as never;
	});
	on("command.run", () => ({ text: "" }));
	on("turn.start", ($, e) => ({ turnId: e.turnId }));
	on("turn.complete", () => ({ text: "" }));
	on("session.start", ($, e) => ({ cwd: e.cwd }));
	for (const event of [
		"tool.register",
		"command.register",
		"ui.open",
		"ui.status",
	] as const)
		on(event, () => ({ value: {} }) as never);
	return { asked, submitted, filled, aborted, clock, session };
}

/** Runs one turn here as the engine does, and hands back what it drew. */
async function turn($: Parameters<TestBody>[0], text: string, turnId: string) {
	await $.turn.start({ text, turnId });
	const chunks = [];
	for await (const chunk of $.turn.step({
		turnId,
		index: 0,
		model: "leverage",
		messageCount: 1,
	}))
		chunks.push(chunk);
	await $.turn.complete({
		turnId,
		answer: "",
		durationMs: 1,
		isAborted: false,
		reason: "answer",
	});
	return chunks;
}

const start = ($: Parameters<TestBody>[0]) =>
	$.session.start({ cwd: "/work", surface: "terminal", isInteractive: true });

test("a session opened here draws its earlier turns as Claude Code's own", async ($, on) => {
	const leverage = fakeLeverage(on);
	await start($);
	await leverage.clock.advance(1500);
	// Read from the session's first row, each earlier prompt starts a turn here.
	expect(leverage.asked).toContain("GET /sessions/s-1/prompts?after=0");
	expect(leverage.submitted).toEqual([FIRST, SECOND]);
	const first = await turn($, FIRST, "c-1");
	expect(first).toContainEqual(
		expect.objectContaining({ kind: "thinking", text: "The cookie is unset." }),
	);
	expect(first).toContainEqual(
		expect.objectContaining({ kind: "text", text: "Fixed the login." }),
	);
	const second = await turn($, SECOND, "c-2");
	expect(second).toContainEqual(
		expect.objectContaining({ kind: "text", text: "The tests pass." }),
	);
	expect(leverage.asked).toContain(
		"GET /sessions/s-1/step?after=4&stream=true",
	);
	// Grace's steer shows in the turn it joined; the compaction once the
	// replay reaches its row.
	if (leverage.session) {
		expect(
			leverage.session.appended().map((row) => row.message.content[0]),
		).toEqual([
			expect.objectContaining({
				text: "Grace (in Leverage) adds: use the cookie",
			}),
			expect.objectContaining({ text: "Leverage compacted the session." }),
		]);
	}
	// Nothing went to Leverage: these turns ran there already.
	expect(leverage.asked.filter((one) => one.startsWith("POST"))).toEqual([
		"POST /sessions/s-1/read",
	]);
});

test("a prompt typed while the earlier turns draw goes to Leverage after them", async ($, on) => {
	const leverage = fakeLeverage(on);
	await start($);
	await leverage.clock.advance(1500);
	await $.prompt.submit({
		text: "and the docs",
		wait: false,
		turnId: "c-1",
		origin: { kind: "composer" },
	});
	// Not a steer of a turn that ran long ago.
	expect(leverage.asked).not.toContain("POST /sessions/s-1/messages");
	await turn($, FIRST, "c-1");
	await turn($, SECOND, "c-2");
	await $.turn.start({ text: "and the docs", turnId: "c-3" });
	expect(leverage.asked).toContain("POST /sessions/s-1/messages");
});

test("before the earlier turns are read, a prompt goes back to the box", async ($, on) => {
	const leverage = fakeLeverage(on);
	await start($);
	const answer = await $.prompt.submit({
		text: "and the docs",
		wait: false,
		origin: { kind: "composer" },
	});
	expect(answer.drop).toContain("earlier turns");
	expect(leverage.filled).toEqual(["and the docs"]);
	expect(leverage.asked).not.toContain("POST /sessions/s-1/messages");
});

test("a turn queued for a session the window left draws nothing", async ($, on) => {
	const leverage = fakeLeverage(on);
	await start($);
	await leverage.clock.advance(1500);
	const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
	await ui.press({ key: "s-s-2" });
	const chunks = await turn($, FIRST, "c-1");
	expect(leverage.aborted).toEqual(["c-1"]);
	expect(chunks.filter((chunk) => chunk.kind !== "stop")).toEqual([]);
	// The window reads the new session from its own first row.
	await leverage.clock.advance(1500);
	expect(leverage.asked).toContain("GET /sessions/s-2/prompts?after=0");
});
