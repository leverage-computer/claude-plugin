import type { On } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

import type { WorkspaceTree } from "../types";

const TREE: WorkspaceTree = {
	workspace: "acme",
	attached: "s-1",
	channels: [
		{
			id: "C1",
			name: "onboarding",
			sessions: [
				{
					id: "s-1",
					title: "login bug",
					status: "awaiting_input",
					viewers: [],
					typing: [],
				},
				{
					id: "s-2",
					title: "pricing copy",
					status: "idle",
					viewers: [
						{ name: "Grace Hopper", state: "active", apps: ["codex"] },
						{ name: "Alan Turing", state: "idle", apps: [] },
					],
					typing: [],
				},
			],
			connections: ["acme/web", "Linear"],
		},
		{ id: "C2", name: "billing", sessions: [], connections: [] },
	],
	direct: [
		{
			id: "s-3",
			title: "scratch",
			status: "idle",
			viewers: [{ name: "Ada Lovelace", state: "active", apps: [] }],
			typing: ["Ada Lovelace"],
		},
	],
};

/** What Leverage answers about the session here, by the path's last part. */
const PANEL: Record<string, unknown> = {
	waiting: {
		writable: true,
		approvals: [{ id: "inv-1", tool: "Bash", input: { command: "npm test" } }],
		question: null,
	},
	queue: [{ uuid: "q-1", text: "then fix the copy" }],
	agents: [
		{
			task: "t-1",
			description: "Find the flake",
			type: "Explore",
			running: true,
			status: null,
		},
	],
	outputs: ["notes/report.md"],
	changes: [
		{
			name: "acme/web",
			branch: "login-fix",
			changes: [{ path: "src/login.ts" }],
			pullRequest: { number: 12, url: "https://github.com/acme/web/pull/12" },
		},
	],
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

// Stands in for Leverage and records what the pane asks of it.
function fakeLeverage(on: On) {
	const opened: string[] = [];
	const read: string[] = [];
	const histories: string[] = [];
	const queries: (string | null)[] = [];
	const commands: string[] = [];
	const posted: [string, unknown][] = [];
	const saved = new Map<string, string>();
	const toasts: string[] = [];
	on("fs.write", (_, e) => {
		saved.set(e.path, e.text);
		return { value: undefined };
	});
	on("ui.toast", (_, e) => {
		toasts.push(e.text);
		return { value: undefined };
	});
	mock.env(on, {
		LEVERAGE_CLAUDE_URL: "https://leverage.test",
		LEVERAGE_CLAUDE_TOKEN: "lev_cl_test",
		LEVERAGE_CLAUDE_SESSION: "s-1",
	});
	const clock = mock.clock(on);
	on("http.fetch", ($, e) => {
		const url = new URL(e.url);
		const path = url.pathname;
		if (path === "/api/claude/workspace")
			queries.push(url.searchParams.get("query"));
		if (e.init?.method === "POST")
			posted.push([
				path.replace("/api/claude", ""),
				JSON.parse(e.init.body ?? "{}"),
			]);
		const { attached: _, ...tree } = TREE;
		let answer: unknown = tree;
		const [, id, action] =
			path.match(/^\/api\/claude\/sessions\/([^/]+)\/?(.*)$/) ?? [];
		if (id && !action) {
			opened.push(id);
			answer = {
				id,
				title: id,
				cursor: 7,
				model: "claude-opus-4-5",
				effort: "high",
			};
		}
		if (path === "/api/claude/models") {
			answer = [
				{ id: "claude-opus-4-5", label: "Opus", efforts: ["low", "high"] },
				{ id: "claude-sonnet-4-5", label: "Sonnet", efforts: ["low", "high"] },
			];
		}
		if (action && action in PANEL) answer = PANEL[action];
		if (action === "file") answer = { content: "# Report" };
		if (path.startsWith("/api/claude/approvals/") || action === "model")
			answer = { ok: true };
		if (action?.startsWith("queue/")) answer = { ok: true };
		if (action === "read") {
			read.push(id ?? "");
			answer = { ok: true };
		}
		if (action === "history") {
			histories.push(id ?? "");
			answer = { messages: [], before: null };
		}
		// The turn starts a subagent in Leverage.
		if (action === "step") {
			answer = {
				blocks: [
					{
						kind: "tool",
						id: "agent-1",
						name: "Task",
						input: { prompt: "Look at checkout" },
						agent: {
							task: "t-1",
							description: "Find the flake",
							prompt: "Look at checkout",
							type: "Explore",
						},
					},
				],
				stop: "tool_use",
				cursor: 9,
				turnId: "turn-1",
				context: null,
				question: null,
			};
		}
		// Grace has the session open in Codex, idle, and Ada types in the web app.
		if (action === "prompts") {
			answer = {
				prompts: [],
				notices: [],
				last: 7,
				viewers: [
					{ name: "Ada Lovelace", state: "active", apps: ["leverage/web"] },
					{ name: "Grace Hopper", state: "idle", apps: ["codex"] },
				],
				typing: ["Ada Lovelace"],
			};
		}
		const text = JSON.stringify(answer);
		return { value: { status: 200, ok: true, headers: {}, text } };
	});
	on("command.run", ($, e) => {
		commands.push(e.command);
		return { text: "" };
	});
	return {
		opened,
		read,
		histories,
		queries,
		commands,
		clock,
		posted,
		saved,
		toasts,
	};
}

for (const surface of ["terminal", "desktop", "vscode"] as const) {
	test(`the pane lists channels, sessions, who is in them and connections on ${surface}`, async ($, on) => {
		fakeLeverage(on);
		const ui = await $.ui.mount({ ...PANE, surface });
		await expect(ui.find({ text: /#onboarding/ })).resolves.toBeDefined();
		await expect(ui.find({ key: "s-s-2" })).resolves.toBeDefined();
		await expect(ui.find({ key: "s-s-3" })).resolves.toBeDefined();
		await expect(
			ui.find({ text: /acme\/web · Linear/ }),
		).resolves.toBeDefined();
		await expect(ui.find({ text: /no connections/ })).resolves.toBeDefined();
		// Who else has each session open, and who types there.
		await expect(ui.find({ text: /Grace \+1/ })).resolves.toBeDefined();
		await expect(ui.find({ text: /Ada types…/ })).resolves.toBeDefined();
	});

	test(`under the session here, the pane shows and drives it on ${surface}`, async ($, on) => {
		const leverage = fakeLeverage(on);
		const ui = await $.ui.mount({ ...PANE, surface });
		await expect(ui.find({ text: /Bash: npm test/ })).resolves.toBeDefined();
		await expect(ui.find({ text: /then fix the copy/ })).resolves.toBeDefined();
		await expect(ui.find({ text: /Find the flake/ })).resolves.toBeDefined();
		await expect(ui.find({ text: /login-fix/ })).resolves.toBeDefined();
		// Only the session here has a panel.
		expect(await ui.findAll({ key: "compact" })).toHaveLength(1);

		await ui.press({ key: "allow-inv-1" });
		await ui.select({ key: "model", value: "claude-sonnet-4-5" });
		await ui.select({ key: "effort", value: "low" });
		await ui.press({ key: "send-q-1" });
		await ui.press({ key: "stop" });
		expect(leverage.posted).toEqual([
			["/approvals/inv-1", { decision: "once" }],
			// The effort carries over when the new model has it.
			["/sessions/s-1/model", { model: "claude-sonnet-4-5", effort: "high" }],
			["/sessions/s-1/model", { model: "claude-opus-4-5", effort: "low" }],
			["/sessions/s-1/queue/q-1/send", {}],
			["/sessions/s-1/stop", {}],
		]);

		// An output is kept in the working folder, as /leverage save keeps it.
		await ui.press({ key: "output-notes/report.md" });
		expect(
			[...leverage.saved].find(([path]) => path.endsWith("report.md"))?.[1],
		).toBe("# Report");
		expect(leverage.toasts).toContain("Saved report.md.");
	});
}

test("pressing another session moves the window to it", async ($, on) => {
	const leverage = fakeLeverage(on);
	const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
	await ui.press({ key: "s-s-2" });
	expect(leverage.opened).toContain("s-2");
	expect(leverage.commands).toContain("clear");
	// Opened here, it reads as read, and its last turns show.
	expect(leverage.read).toEqual(["s-2"]);
	expect(leverage.histories).toEqual(["s-2"]);
});

test("a search lists the sessions whose titles hold it", async ($, on) => {
	const leverage = fakeLeverage(on);
	const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
	await ui.input({ key: "search", text: "pricing" });
	expect(leverage.queries.at(-1)).toBe("pricing");
});

test("pressing the session already here does nothing", async ($, on) => {
	const leverage = fakeLeverage(on);
	const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
	await ui.press({ key: "s-s-1" });
	expect(leverage.read).toEqual([]);
	expect(leverage.commands).toEqual([]);
});

for (const surface of ["terminal", "desktop"] as const) {
	test(`above the prompt, the others in the session and who types on ${surface}`, async ($, on) => {
		const leverage = fakeLeverage(on);
		// The engine beneath the window's start, which this test does not look at.
		on("session.start", ($, e) => ({ cwd: e.cwd }));
		for (const event of [
			"tool.register",
			"command.register",
			"ui.open",
			"ui.status",
		] as const)
			on(event, () => ({ value: {} }) as never);
		await $.session.start({ cwd: "/work", surface, isInteractive: true });
		await leverage.clock.advance(1500);
		const ui = await $.ui.mount({
			plugin: "leverage",
			surface,
			component: "AbovePrompt",
			props: {
				hasSurvey: false,
				isWorking: false,
				maxRows: 10,
				bodyColumns: 120,
			} as never,
			viewport: { columns: 120, rows: 40, isFullscreen: false },
		});
		await expect(
			ui.find({ text: /● Ada Lovelace · ◐ Grace Hopper \(idle, on Codex\)/ }),
		).resolves.toBeDefined();
		await expect(
			ui.find({ text: /Ada Lovelace is typing…/ }),
		).resolves.toBeDefined();
	});
}

test("a Leverage subagent's call is Claude Code's own Agent call", async ($, on) => {
	fakeLeverage(on);
	on("session.start", ($, e) => ({ cwd: e.cwd }));
	for (const event of [
		"tool.register",
		"command.register",
		"ui.open",
		"ui.status",
	] as const)
		on(event, () => ({ value: {} }) as never);
	await $.session.start({
		cwd: "/work",
		surface: "terminal",
		isInteractive: true,
	});
	const chunks = [];
	for await (const chunk of $.turn.step({
		turnId: "turn-1",
		index: 0,
		model: "leverage",
		messageCount: 1,
	}))
		chunks.push(chunk);
	expect(chunks).toContainEqual(
		expect.objectContaining({ kind: "tool", id: "agent-1", name: "Agent" }),
	);
	const input = chunks.find((chunk) => chunk.kind === "input");
	expect(JSON.parse(input && "json" in input ? input.json : "{}")).toEqual({
		description: "Find the flake",
		prompt: "Look at checkout",
		subagent_type: "general-purpose",
	});
});
