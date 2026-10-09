import type { On } from "claude-code";
import { expect, mock, type TestBody, test } from "claude-code/testing";

import type { WorkspaceTree } from "../types";

const TREE: WorkspaceTree = {
	workspace: "acme",
	attached: "s-1",
	channels: [
		{
			id: "C1",
			name: "onboarding",
			sessions: [
				{ id: "s-1", title: "login bug", status: "awaiting_input" },
				{ id: "s-2", title: "pricing copy", status: "idle" },
			],
		},
		{ id: "C2", name: "billing", sessions: [] },
	],
	direct: [{ id: "s-3", title: "scratch", status: "idle" }],
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
/** What `leverage claude` starts Claude Code with. */
const LAUNCHED = {
	LEVERAGE_CLAUDE_URL: "https://leverage.test",
	LEVERAGE_CLAUDE_TOKEN: "lev_cl_test",
	LEVERAGE_CLAUDE_SESSION: "s-1",
};

function fakeLeverage(on: On, env: Record<string, string> = LAUNCHED) {
	const opened: string[] = [];
	const read: string[] = [];
	const histories: string[] = [];
	const queries: (string | null)[] = [];
	const commands: string[] = [];
	const tokens: string[] = [];
	mock.env(on, env);
	const clock = mock.clock(on);
	on("http.fetch", ($, e) => {
		const url = new URL(e.url);
		const path = url.pathname;
		const headers = (e.init?.headers ?? {}) as Record<string, string>;
		tokens.push(`${url.origin} ${headers.authorization}`);
		if (path === "/api/claude/workspace")
			queries.push(url.searchParams.get("query"));
		const { attached: _, ...tree } = TREE;
		let answer: unknown = tree;
		const [, id, action] =
			path.match(/^\/api\/claude\/sessions\/([^/]+)\/?(.*)$/) ?? [];
		if (id && !action) {
			opened.push(id);
			answer = { id, title: id, cursor: 7 };
		}
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
		tokens,
	};
}

/** Starts a window as Claude Code does, launched by `leverage claude`. */
async function startWindow(
	$: Parameters<TestBody>[0],
	on: On,
	surface: "terminal" | "desktop" | "vscode",
) {
	const tools = engineStart(on);
	await $.session.start({ cwd: "/work", surface, isInteractive: true });
	return tools;
}

/** The engine beneath a window's start, which these tests do not look at. */
function engineStart(on: On) {
	const tools: string[] = [];
	on("session.start", ($, e) => ({ cwd: e.cwd }));
	on("tool.register", (_, e) => {
		tools.push(e.name);
		return { value: {} } as never;
	});
	for (const event of ["command.register", "ui.open", "ui.status"] as const)
		on(event, () => ({ value: {} }) as never);
	return tools;
}

for (const surface of ["terminal", "desktop", "vscode"] as const) {
	test(`the pane lists spaces and their sessions on ${surface}`, async ($, on) => {
		fakeLeverage(on);
		await startWindow($, on, surface);
		const ui = await $.ui.mount({ ...PANE, surface });
		await expect(ui.find({ text: /#onboarding/ })).resolves.toBeDefined();
		await expect(ui.find({ key: "s-s-2" })).resolves.toBeDefined();
		await expect(ui.find({ key: "s-s-3" })).resolves.toBeDefined();
		// The session here is not one to open again.
		await expect(ui.find({ key: "s-s-1" })).resolves.toBeUndefined();
	});
}

test("pressing another session moves the window to it", async ($, on) => {
	const leverage = fakeLeverage(on);
	await startWindow($, on, "desktop");
	const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
	await ui.press({ key: "s-s-2" });
	expect(leverage.opened).toContain("s-2");
	expect(leverage.commands).toContain("clear");
	// Opened here, it reads as read, and its last turns show.
	expect(leverage.read.at(-1)).toBe("s-2");
	expect(leverage.histories.at(-1)).toBe("s-2");
	// The pane marks the new session as the one here; the old one opens again.
	await expect(ui.find({ key: "here-s-2" })).resolves.toBeDefined();
	await expect(ui.find({ key: "s-s-1" })).resolves.toBeDefined();
});

test("a search lists the sessions whose titles hold it", async ($, on) => {
	const leverage = fakeLeverage(on);
	await startWindow($, on, "terminal");
	const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
	await ui.input({ key: "search", text: "pricing" });
	expect(leverage.queries.at(-1)).toBe("pricing");
});

for (const surface of ["terminal", "desktop"] as const) {
	test(`above the prompt, the others in the session and who types on ${surface}`, async ($, on) => {
		const leverage = fakeLeverage(on);
		await startWindow($, on, surface);
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
	await startWindow($, on, "terminal");
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

test("without leverage claude, the pane reads the CLI's token, and a press runs the session here", async ($, on) => {
	const leverage = fakeLeverage(on, { HOME: "/Users/ana" });
	// The CLI keeps a Claude Code token per host and workspace.
	on("fs.read", (_, e) => {
		if (e.path !== "/Users/ana/.config/leverage/config.json")
			throw new Error("no such file");
		return {
			value: JSON.stringify({
				currentHost: "https://leverage.test",
				hosts: {
					"https://leverage.test": {
						workspaceId: "w-1",
						accessTokens: { claude: { "w-1": "lev_cl_kept" } },
					},
				},
			}),
		};
	});
	const tools = engineStart(on);
	await $.session.start({
		cwd: "/work",
		surface: "desktop",
		isInteractive: true,
	});
	const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
	await expect(ui.find({ key: "s-s-2" })).resolves.toBeDefined();
	expect(leverage.tokens).toContain("https://leverage.test Bearer lev_cl_kept");
	// Until a session is opened here, the window stays Claude Code's own.
	expect(tools).toEqual([]);
	await ui.press({ key: "s-s-2" });
	expect(leverage.opened).toContain("s-2");
	expect(tools).toContain("remote_tool");
});

test("with no token anywhere, /leverage says how to get one", async ($, on) => {
	fakeLeverage(on, { HOME: "/Users/ana" });
	on("fs.read", () => {
		throw new Error("no such file");
	});
	const tools = engineStart(on);
	await $.session.start({
		cwd: "/work",
		surface: "terminal",
		isInteractive: true,
	});
	const answer = await $.command.run({
		command: "leverage",
		args: "",
	} as never);
	expect(answer.text).toContain("/leverage login");
	expect(tools).toEqual([]);
});
