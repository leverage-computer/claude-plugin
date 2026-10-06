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
				{ id: "s-1", title: "login bug", status: "active" },
				{ id: "s-2", title: "pricing copy", status: "idle" },
			],
			connections: ["acme/web", "Linear"],
		},
		{ id: "C2", name: "billing", sessions: [], connections: [] },
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
function fakeLeverage(on: On) {
	const opened: string[] = [];
	const read: string[] = [];
	const histories: string[] = [];
	const queries: (string | null)[] = [];
	const commands: string[] = [];
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
	return { opened, read, histories, queries, commands, clock };
}

for (const surface of ["terminal", "desktop", "vscode"] as const) {
	test(`the pane lists channels, sessions and connections on ${surface}`, async ($, on) => {
		fakeLeverage(on);
		const ui = await $.ui.mount({ ...PANE, surface });
		await expect(ui.find({ text: /#onboarding/ })).resolves.toBeDefined();
		expect((await ui.find({ key: "s-s-1" }))?.text).toContain("← here");
		expect((await ui.find({ key: "s-s-2" }))?.text).not.toContain("← here");
		await expect(
			ui.find({ text: /acme\/web · Linear/ }),
		).resolves.toBeDefined();
		await expect(ui.find({ text: /no connections/ })).resolves.toBeDefined();
		await expect(ui.find({ key: "s-s-3" })).resolves.toBeDefined();
	});
}

test("pressing another session moves the window to it", async ($, on) => {
	const leverage = fakeLeverage(on);
	const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
	await ui.press({ key: "s-s-2" });
	expect(leverage.opened).toEqual(["s-2"]);
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
	expect(leverage.opened).toEqual([]);
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
