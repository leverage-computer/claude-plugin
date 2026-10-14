import type { On } from "claude-code";
import { expect, mock, type TestBody, test } from "claude-code/testing";

const TREE = { workspace: "acme", channels: [], direct: [] };
const WORKSPACES = [
	{ id: "w-1", slug: "acme", name: "Acme" },
	{ id: "w-2", slug: "globex", name: "Globex" },
];

/** A Leverage that signs in through the browser, and the host beneath it. */
function fakeLeverage(
	on: On,
	env: Record<string, string>,
	{
		workspaces = WORKSPACES.slice(0, 1),
		approveAfter = 1,
		canWrite = true,
	} = {},
) {
	const asked: string[] = [];
	const ran: { argv: readonly string[]; stdin?: string }[] = [];
	const toasts: string[] = [];
	let polls = 0;
	mock.env(on, env);
	const clock = mock.clock(on);
	on("http.fetch", (_, e) => {
		const url = new URL(e.url);
		const headers = (e.init?.headers ?? {}) as Record<string, string>;
		asked.push(
			`${e.init?.method ?? "GET"} ${url.href} ${headers.authorization ?? ""}`.trim(),
		);
		const answer = (status: number, body: unknown) => ({
			value: {
				status,
				ok: status < 300,
				headers: {},
				text: JSON.stringify(body),
			},
		});
		switch (url.pathname) {
			case "/api/cli/auth/device":
				return answer(200, {
					device_code: "dc-1",
					user_code: "ABCD-EFGH",
					expires_in: 900,
					interval: 5,
				});
			case "/api/cli/auth/token":
				return ++polls > approveAfter
					? answer(200, { access_token: "lev_at_1", refresh_token: "lev_rt_1" })
					: answer(428, { error: "authorization_pending" });
			case "/api/workspaces":
				return answer(200, workspaces);
			case "/api/claude/workspace":
				return answer(200, TREE);
		}
		const minted = url.pathname.match(
			/^\/api\/workspaces\/([^/]+)\/claude\/token$/,
		);
		if (minted) return answer(200, { token: `lev_cl_${minted[1]}` });
		return answer(404, { error: "not_found" });
	});
	on("process.run", (_, e) => {
		ran.push({ argv: e.argv, stdin: e.init?.stdin });
		return {
			value: {
				exitCode: canWrite || e.argv[0] !== "/bin/sh" ? 0 : 1,
				stdout: "",
				stderr: "",
				isStdoutTruncated: false,
				isStderrTruncated: false,
			},
		};
	});
	on("ui.toast", (_, e) => {
		toasts.push(e.text);
		return { value: undefined };
	});
	return { asked, ran, toasts, clock };
}

/** The engine beneath a window's start, which these tests do not look at. */
async function start($: Parameters<TestBody>[0], on: On) {
	const opened: string[] = [];
	on("session.start", (_, e) => ({ cwd: e.cwd }));
	on("ui.open", (_, e) => {
		opened.push(e.id);
		return { value: {} } as never;
	});
	for (const event of [
		"command.register",
		"tool.register",
		"ui.status",
		"ui.close",
	] as const)
		on(event, () => ({ value: {} }) as never);
	await $.session.start({
		cwd: "/work",
		surface: "terminal",
		isInteractive: true,
	});
	return opened;
}

const leverage = ($: Parameters<TestBody>[0], args: string) =>
	$.command.run({ command: "leverage", args } as never);

/** The file a test keeps, as written through the host. */
const kept = (ran: { argv: readonly string[]; stdin?: string }[]) => {
	const write = ran.find((one) => one.argv[0] === "/bin/sh");
	return write
		? { file: write.argv.at(-1), ...JSON.parse(write.stdin ?? "{}") }
		: null;
};

test("/leverage login signs in in the browser and keeps a Claude Code token", async ($, on) => {
	const host = fakeLeverage(on, {
		HOME: "/Users/ana",
		LEVERAGE_HOST: "leverage.test",
	});
	on("fs.read", () => {
		throw new Error("no such file");
	});
	const opened = await start($, on);
	expect((await leverage($, "")).text).toContain("/leverage login");

	const answer = await leverage($, "login");
	expect(answer.text).toContain("ABCD-EFGH");
	expect(answer.text).toContain(
		"https://leverage.test/device?user_code=ABCD-EFGH",
	);
	expect(host.ran[0]?.argv).toEqual([
		"open",
		"https://leverage.test/device?user_code=ABCD-EFGH",
	]);
	expect(host.asked).toContainEqual(
		expect.stringContaining("POST https://leverage.test/api/cli/auth/device"),
	);

	// Not approved yet, then approved.
	await host.clock.advance(5000);
	expect(kept(host.ran)).toBeNull();
	await host.clock.advance(5000);
	expect(host.asked).toContain(
		"POST https://leverage.test/api/workspaces/w-1/claude/token Bearer lev_at_1",
	);
	expect(kept(host.ran)).toEqual({
		file: "/Users/ana/.claude/leverage.json",
		url: "https://leverage.test",
		token: "lev_cl_w-1",
	});
	expect(host.toasts).toContain("Signed in to acme. /leverage opens the pane.");
	expect(opened).toContain("leverage");
	// The sign-in itself is never kept: only the Claude Code token.
	expect(JSON.stringify(host.ran)).not.toContain("lev_at_1");
	expect((await leverage($, "connectors")).text).not.toContain("Not signed in");
});

test("/leverage login <workspace> picks one of several", async ($, on) => {
	const host = fakeLeverage(
		on,
		{ HOME: "/Users/ana" },
		{ workspaces: WORKSPACES, approveAfter: 0 },
	);
	on("fs.read", () => {
		throw new Error("no such file");
	});
	await start($, on);
	await leverage($, "login globex");
	await host.clock.advance(5000);
	expect(host.asked).toContain(
		"POST https://app.leverage.computer/api/workspaces/w-2/claude/token Bearer lev_at_1",
	);
	expect(kept(host.ran)?.token).toBe("lev_cl_w-2");
});

test("a token that cannot be kept privately is not kept", async ($, on) => {
	const host = fakeLeverage(
		on,
		{ HOME: "/Users/ana" },
		{ approveAfter: 0, canWrite: false },
	);
	const written: string[] = [];
	on("fs.read", () => {
		throw new Error("no such file");
	});
	on("fs.write", (_, e) => {
		written.push(e.path);
		return { value: undefined };
	});
	await start($, on);
	await leverage($, "login");
	await host.clock.advance(5000);
	expect(host.toasts).toContain(
		"Could not keep the token in /Users/ana/.claude/leverage.json.",
	);
	expect(written).toEqual([]);
	expect((await leverage($, "")).text).toContain("Not signed in");
});

test("with no home folder, no token is read or kept in the project", async ($, on) => {
	const host = fakeLeverage(on, {}, { approveAfter: 0 });
	const read: string[] = [];
	on("fs.read", (_, e) => {
		read.push(e.path);
		throw new Error("no such file");
	});
	await start($, on);
	expect(read).toEqual([]);
	expect((await leverage($, "login")).text).toBe(
		"No home folder to keep the token in.",
	);
	expect(host.asked).toEqual([]);
});

test("logout while a sign-in waits keeps nothing", async ($, on) => {
	const host = fakeLeverage(on, { HOME: "/Users/ana" }, { approveAfter: 0 });
	on("fs.read", () => {
		throw new Error("no such file");
	});
	on("fs.exists", () => ({ value: false }));
	await start($, on);
	await leverage($, "login");
	await leverage($, "logout");
	await host.clock.advance(10000);
	expect(kept(host.ran)).toBeNull();
	expect(host.toasts).toEqual([]);
	expect((await leverage($, "")).text).toContain("Not signed in");
});
