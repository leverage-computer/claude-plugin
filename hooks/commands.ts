import type { EngineInterface, HttpResponse, On, Timer } from "claude-code";
import { update } from "claude-code";

import {
	accessPath,
	cliConfigPath,
	connectedBy,
	connectSaved,
	disconnect,
	here,
	isReachable,
	keptToken,
	leverageHost,
	leverageRequest,
	space,
} from "./client";
import { PANE } from "./pane";

// `/leverage <action>`: what the other Leverage apps do with a session,
// done on the session this window shows. Bare, it opens the pane.

const HELP = `/leverage                 open the pane: spaces and their sessions
/leverage login [workspace]  sign in in the browser
/leverage logout          forget the token here
/leverage approvals       ask again for calls that wait on you
/leverage rename <title>  rename this session (/rename does too)
/leverage archive         archive this session; restore brings it back
/leverage model [id] [effort]  show or pick the session's model
/leverage queue           prompts other apps queued for this session
/leverage queue take <n>  take a waiting prompt back
/leverage queue send <n>  send a waiting prompt now
/leverage outputs         files the last turn wrote
/leverage files [path]    this session's files, or the space's
/leverage find <name>     find a file of this session by name
/leverage read <path>     show a file of this session
/leverage save <path>     save a file of this session here
/leverage run <command>   run a shell command in the session's sandbox
/leverage changes         each repository's changes and pull request
/leverage skills          the skills this session can load
/leverage skill <name> <prompt>  send a prompt that loads a skill
/leverage connectors      the workspace's connectors
/leverage history [more]  the session's last turns, then older ones`;

/** The most a file shows in the transcript. */
const SHOWN_CHARS = 20_000;
/** Where the next older page of history starts, once one was shown. */
let olderFrom: number | null = null;

async function call<T>(
	$: EngineInterface,
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await $.http.fetch(...leverageRequest(path, body));
	if (res.status === 401)
		throw new Error(
			connectedBy() === "launched"
				? "Leverage refused this token. Run leverage claude again."
				: "Leverage refused this token. /leverage login signs in again.",
		);
	if (!res.ok) {
		const reason = (() => {
			try {
				return (JSON.parse(res.text) as { error?: string }).error;
			} catch {
				return undefined;
			}
		})();
		throw new Error(reason ?? `Leverage answered ${res.status}`);
	}
	return JSON.parse(res.text) as T;
}

type Approval = { id: string; tool: string; input: unknown };
type Waiting = { writable: boolean; approvals: Approval[] };
type Model = { id: string; label: string; efforts: string[] };
type Entry = { path: string; type?: string };
type FileRead = { content?: string; isBinary?: boolean; truncated?: boolean };

const quoted = (path: string) => encodeURIComponent(path);

async function approvals($: EngineInterface): Promise<string> {
	const waiting = await call<Waiting>($, `/sessions/${here.id}/waiting`);
	if (waiting.approvals.length === 0) return "No call waits for approval.";
	if (!waiting.writable) return "Calls wait for the session owner's approval.";
	for (const pending of waiting.approvals) {
		const answer = await $.ui
			.ask(
				`Allow ${pending.tool} to run in Leverage? ${JSON.stringify(pending.input).slice(0, 300)}`,
				{
					header: "Approval",
					options: ["Once", "This session", "Always", "Reject"],
				},
			)
			.catch(() => "");
		if (!answer) continue;
		here.known.add(pending.id);
		const decision =
			{ Once: "once", "This session": "session", Always: "always" }[answer] ??
			"reject";
		await call($, `/approvals/${pending.id}`, {
			decision,
			...(answer === "Reject" || decision !== "reject"
				? {}
				: { reason: answer }),
		});
	}
	return "Decided.";
}

async function model($: EngineInterface, args: string[]): Promise<string> {
	const [id, effort] = args;
	if (id) {
		await call($, `/sessions/${here.id}/model`, {
			model: id,
			...(effort ? { effort } : {}),
		});
		return `The session runs ${id}${effort ? ` at ${effort}` : ""} from the next turn.`;
	}
	const [models, session] = await Promise.all([
		call<Model[]>($, "/models"),
		call<{ model: string | null; effort: string | null }>(
			$,
			`/sessions/${here.id}`,
		),
	]);
	const lines = models.map(
		(one) =>
			`${one.id === session.model ? "●" : "○"} ${one.id}  ${one.label}${one.efforts.length ? `  (${one.efforts.join(", ")})` : ""}`,
	);
	return [
		`Now: ${session.model ?? "the space's default"}${session.effort ? ` at ${session.effort}` : ""}`,
		...lines,
		"Pick one: /leverage model <id> [effort]",
	].join("\n");
}

async function queue($: EngineInterface, args: string[]): Promise<string> {
	const items = await call<{ uuid: string; text: string }[]>(
		$,
		`/sessions/${here.id}/queue`,
	);
	const [action, number] = args;
	if (!action) {
		if (items.length === 0) return "No prompt waits.";
		return items
			.map((item, index) => `${index + 1}. ${item.text.slice(0, 120)}`)
			.join("\n");
	}
	const item = items[Number(number) - 1];
	if (!item) return `No waiting prompt ${number ?? ""}.`;
	if (action === "take") {
		await call($, `/sessions/${here.id}/queue/${item.uuid}/cancel`, {});
		return "Taken back.";
	}
	if (action === "send") {
		await call($, `/sessions/${here.id}/queue/${item.uuid}/send`, {});
		return "Sent now.";
	}
	return "Use: /leverage queue [take|send] <n>";
}

async function files($: EngineInterface, path: string): Promise<string> {
	const at = here.id
		? `/sessions/${here.id}/files?path=${quoted(path)}`
		: `/spaces/${space()}/files?path=${quoted(path)}`;
	const listed = await call<{ entries: Entry[]; truncated?: boolean }>($, at);
	if (listed.entries.length === 0) return "No files here.";
	const lines = listed.entries.map(
		(entry) => `${entry.path}${entry.type === "dir" ? "/" : ""}`,
	);
	return [...lines, ...(listed.truncated ? ["…more"] : [])].join("\n");
}

// A file of the session, or of the space before a session starts.
async function readFile($: EngineInterface, path: string): Promise<FileRead> {
	return call<FileRead>(
		$,
		here.id
			? `/sessions/${here.id}/file?path=${quoted(path)}`
			: `/spaces/${space()}/file?path=${quoted(path)}`,
	);
}

// Shows a file in the transcript, or saves it in the working folder.
async function readOrSave(
	$: EngineInterface,
	action: "read" | "save",
	path: string,
): Promise<string> {
	if (!path) return `Name the file: /leverage ${action} <path>`;
	const file = await readFile($, path);
	if (action === "save") {
		if (file.content === undefined) return "Leverage cannot read that file.";
		const name = path.split("/").at(-1) ?? "output";
		await $.fs.write(name, file.content);
		return `Saved ${name}.`;
	}
	if (file.isBinary || file.content === undefined)
		return "Not a text file. /leverage save keeps it here.";
	return file.content.length > SHOWN_CHARS
		? `${file.content.slice(0, SHOWN_CHARS)}\n…`
		: file.content;
}

async function run($: EngineInterface, args: string): Promise<string> {
	const [action = "", ...rest] = args.trim().split(/\s+/);
	const tail = args.trim().slice(action.length).trim();
	if (action === "help") return HELP;
	if (action === "connectors") {
		const connectors = await call<{ name: string; disabled: boolean }[]>(
			$,
			"/connectors",
		);
		return connectors.length === 0
			? "No connectors in this workspace."
			: connectors
					.map((one) => `${one.disabled ? "○" : "●"} ${one.name}`)
					.join("\n");
	}
	if (!here.id && action === "files") return files($, tail);
	if (!here.id && (action === "read" || action === "save"))
		return readOrSave($, action, tail);
	if (!here.id) return "Send a first prompt, or open a session with /leverage.";
	switch (action) {
		case "approvals":
			return approvals($);
		case "rename":
			if (!tail) return "Name the session: /leverage rename <title>";
			await call($, `/sessions/${here.id}/rename`, { title: tail });
			$.ui.status(tail);
			return `Renamed the session to ${tail}.`;
		case "archive":
			await call($, `/sessions/${here.id}/archive`, {});
			return "Archived. /leverage restore brings it back.";
		case "restore":
			await call($, `/sessions/${here.id}/restore`, {});
			return "Restored.";
		case "model":
			return model($, rest);
		case "queue":
			return queue($, rest);
		case "outputs": {
			const outputs = await call<string[]>($, `/sessions/${here.id}/outputs`);
			return outputs.length === 0
				? "The last turn wrote no files."
				: `${outputs.join("\n")}\n/leverage read <path> shows one; /leverage save <path> keeps it here.`;
		}
		case "files":
			return files($, tail);
		case "find": {
			if (!tail) return "Name part of the file: /leverage find <name>";
			const found = await call<string[]>(
				$,
				`/sessions/${here.id}/find?name=${quoted(tail)}`,
			);
			return found.length === 0 ? "No file matches." : found.join("\n");
		}
		case "read":
		case "save":
			return readOrSave($, action, tail);
		case "run": {
			if (!tail) return "Name the command: /leverage run <command>";
			const ran = await call<{ exitCode: number; output: string }>(
				$,
				`/sessions/${here.id}/run`,
				{ command: tail },
			);
			const output =
				ran.output.length > SHOWN_CHARS
					? `${ran.output.slice(-SHOWN_CHARS)}`
					: ran.output;
			return `${output}${output.endsWith("\n") || !output ? "" : "\n"}exit ${ran.exitCode}`;
		}
		case "changes": {
			const repos = await call<
				{
					name: string;
					branch: string | null;
					changes: {
						path: string;
						state: string;
						additions: number;
						deletions: number;
					}[];
					unpublished: number;
					pullRequest: {
						number: number;
						url: string;
						state: string;
						draft: boolean;
					} | null;
				}[]
			>($, `/sessions/${here.id}/changes`);
			if (repos.length === 0) return "This session has no repository.";
			return repos
				.map((repo) => {
					const head = `${repo.name}${repo.branch ? ` (${repo.branch})` : ""}`;
					const pr = repo.pullRequest
						? `PR #${repo.pullRequest.number} ${repo.pullRequest.draft ? "draft" : repo.pullRequest.state}: ${repo.pullRequest.url}`
						: "No pull request.";
					const changed = repo.changes.map(
						(change) =>
							`  ${change.state} ${change.path} +${change.additions} -${change.deletions}`,
					);
					const unpublished =
						repo.unpublished > 0
							? [`  ${repo.unpublished} change(s) not in the pull request`]
							: [];
					return [
						head,
						...(changed.length ? changed : ["  no changes"]),
						...unpublished,
						pr,
					].join("\n");
				})
				.join("\n\n");
		}
		case "skills": {
			const skills = await call<{ name: string; description: string }[]>(
				$,
				`/sessions/${here.id}/skills`,
			);
			return skills.length === 0
				? "No skills."
				: `${skills.map((one) => `${one.name}  ${one.description}`).join("\n")}\n/leverage skill <name> <prompt> sends a prompt that loads one.`;
		}
		case "skill": {
			const [name, ...words] = rest;
			const prompt = words.join(" ");
			if (!name || !prompt) return "Use: /leverage skill <name> <prompt>";
			// The prompt goes through this window, so Claude Code draws its turn.
			here.skill = name;
			await $.prompt.submit({ text: prompt, asUser: true });
			return `Sent with the ${name} skill.`;
		}
		case "history": {
			if (tail === "more" && olderFrom === null) return "No older turns.";
			const from = tail === "more" ? `&before=${olderFrom}` : "";
			const page = await call<{
				messages: { author: string; text: string }[];
				before: number | null;
			}>($, `/sessions/${here.id}/history?turns=5${from}`);
			olderFrom = page.before;
			const text = page.messages
				.map((message) => `${message.author}: ${message.text}`)
				.join("\n\n");
			return `${text || "No turns yet."}${page.before === null ? "" : "\n\n/leverage history more shows older turns."}`;
		}
	}
	return HELP;
}

// `/leverage login` and `/leverage logout`: the token this plugin keeps in
// Claude Code's config. Login signs in in the browser, as `leverage login`
// does, and trades that sign-in for a Claude Code token of one workspace.

type Grant = {
	device_code: string;
	user_code: string;
	expires_in: number;
	interval: number;
};
type Workspace = { id: string; slug: string; name: string };

/** The browser sign-in that waits for its approval, if one does. */
let waiting: Timer | null = null;
/** Counts sign-ins; login and logout move it on, so an older one keeps nothing. */
let attempt = 0;

function stopWaiting() {
	waiting?.cancel();
	waiting = null;
	attempt++;
}

async function accessFile($: EngineInterface): Promise<string | null> {
	return accessPath(
		await $.env.get("CLAUDE_CONFIG_DIR"),
		await $.env.get("HOME"),
	);
}

async function cliHasToken($: EngineInterface): Promise<boolean> {
	const file = cliConfigPath(
		await $.env.get("LEVERAGE_CONFIG_DIR"),
		await $.env.get("XDG_CONFIG_HOME"),
		await $.env.get("HOME"),
	);
	const config = file ? await $.fs.read(file).catch(() => "{}") : "{}";
	return keptToken(config) !== null;
}

function send(
	$: EngineInterface,
	url: string,
	body?: unknown,
	token?: string,
): Promise<HttpResponse> {
	return $.http.fetch(url, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			"content-type": "application/json",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

// Opens the approval page. Where no browser opens, the reply has the link.
async function browse($: EngineInterface, link: string) {
	for (const opener of ["open", "xdg-open"]) {
		const opened = await $.process
			.run([opener, link], { timeoutMs: 5000 })
			.catch(() => null);
		if (opened?.exitCode === 0) return;
	}
}

// Keeps the token where only this person reads it, and connects this window.
async function keep(
	$: EngineInterface,
	url: string,
	token: string,
	live: () => boolean,
): Promise<string> {
	const checked = await send(
		$,
		`${url}/api/claude/workspace`,
		undefined,
		token,
	);
	if (checked.status === 401) return "Leverage refused that token.";
	if (!checked.ok) return `Leverage answered ${checked.status}.`;
	const { workspace } = JSON.parse(checked.text) as { workspace: string };
	const file = await accessFile($);
	if (!file) return "No home folder to keep the token in.";
	if (!live()) return "";
	const saved = `${JSON.stringify({ url, token }, null, "\t")}\n`;
	// Windows keeps a profile's files to its owner, and has no sh.
	const written = /^[A-Za-z]:/.test(file)
		? await $.fs.write(file, saved).then(
				() => ({ exitCode: 0 }),
				() => null,
			)
		: await $.process
				.run(
					[
						"/bin/sh",
						"-c",
						'umask 077 && mkdir -p "$(dirname "$1")" && cat > "$1" && chmod 600 "$1"',
						"sh",
						file,
					],
					{ stdin: saved },
				)
				.catch(() => null);
	if (written?.exitCode !== 0) return `Could not keep the token in ${file}.`;
	if (!live()) {
		await $.process.run(["rm", "-f", file]).catch(() => null);
		return "";
	}
	// A new token may name another workspace: nothing of the last one stays.
	disconnect();
	await update($, { plugin: "leverage", key: "tree" }, () => null);
	connectSaved(saved);
	void $.ui.open({ id: PANE, title: "Leverage" });
	return `Signed in to ${workspace}. /leverage opens the pane.`;
}

// The workspace named, the only one, or the one the person picks.
async function choose(
	$: EngineInterface,
	workspaces: Workspace[],
	named: string,
): Promise<Workspace | string> {
	if (named) {
		const found =
			workspaces.find((one) => one.slug === named) ??
			workspaces.find((one) => one.name === named);
		return found ?? `No workspace ${named}.`;
	}
	if (workspaces.length === 1) return workspaces[0] as Workspace;
	// Claude Code's dialog shows four at most.
	if (workspaces.length > 4) {
		const slugs = workspaces.map((one) => one.slug).join(", ");
		return `Name the workspace: /leverage login <workspace>. Yours: ${slugs}.`;
	}
	// Two workspaces may share a name, never a slug.
	const labels = workspaces.map((one) =>
		workspaces.filter((other) => other.name === one.name).length > 1
			? `${one.name} (${one.slug})`
			: one.name,
	);
	const picked = await $.ui
		.ask("Which Leverage workspace?", { header: "Leverage", options: labels })
		.catch(() => "");
	return workspaces[labels.indexOf(picked)] ?? "Sign-in stopped.";
}

// Trades the browser sign-in for a Claude Code token of one workspace.
async function trade(
	$: EngineInterface,
	url: string,
	access: string,
	named: string,
	live: () => boolean,
): Promise<string> {
	const listed = await send($, `${url}/api/workspaces`, undefined, access);
	if (!listed.ok) return `Leverage answered ${listed.status}.`;
	const workspaces = JSON.parse(listed.text) as Workspace[];
	if (workspaces.length === 0)
		return "Your Leverage account has no workspace yet.";
	const chosen = await choose($, workspaces, named);
	if (typeof chosen === "string") return chosen;
	if (!live()) return "";
	const minted = await send(
		$,
		`${url}/api/workspaces/${chosen.id}/claude/token`,
		{},
		access,
	);
	if (!minted.ok) return `Leverage answered ${minted.status}.`;
	return keep(
		$,
		url,
		(JSON.parse(minted.text) as { token: string }).token,
		live,
	);
}

// Asks every few seconds whether the person approved the code.
function awaitApproval(
	$: EngineInterface,
	url: string,
	grant: Grant,
	named: string,
) {
	let asked = 0;
	let skip = 0;
	let busy = false;
	const mine = attempt;
	const live = () => mine === attempt;
	const end = (text: string) => {
		timer.cancel();
		if (waiting === timer) waiting = null;
		if (live() && text) $.ui.toast(text, { timeoutMs: 8000 });
	};
	const timer = $.clock.every(grant.interval * 1000, async () => {
		if (busy) return;
		if (skip > 0) {
			skip--;
			return;
		}
		if (++asked * grant.interval > grant.expires_in)
			return end("The sign-in code expired. /leverage login starts again.");
		busy = true;
		try {
			// A code is good once, so its answer is always read to the end. A
			// network error leaves the code waiting: the next tick asks again.
			const res = await send($, `${url}/api/cli/auth/token`, {
				device_code: grant.device_code,
			}).catch(() => null);
			if (!res) return;
			// Not approved yet, or Leverage is busy: ask again later.
			if (res.status === 428 || res.status >= 500) return;
			if (res.status === 429) {
				skip = 1;
				return;
			}
			if (res.status === 410 && res.text.includes("denied"))
				return end("Sign-in denied.");
			if (res.status === 410 || res.status === 404)
				return end("The sign-in code expired. /leverage login starts again.");
			if (!res.ok) return end(`Leverage answered ${res.status}.`);
			timer.cancel();
			const { access_token } = JSON.parse(res.text) as {
				access_token: string;
			};
			end(await trade($, url, access_token, named, live));
		} catch (error) {
			end(`Leverage: ${(error as Error).message}`);
		} finally {
			busy = false;
		}
	});
	waiting = timer;
}

/** `/leverage login [workspace]`. A token is never typed: the transcript keeps commands. */
async function login($: EngineInterface, arg: string): Promise<string> {
	if (connectedBy() === "launched")
		return "This window runs with the token leverage claude started it with.";
	stopWaiting();
	if (!(await accessFile($))) return "No home folder to keep the token in.";
	const url = leverageHost(await $.env.get("LEVERAGE_HOST"));
	const started = await send($, `${url}/api/cli/auth/device`, {
		client_name: "Claude Code",
	});
	if (started.status === 429)
		return "Leverage asks you to wait a minute, then sign in again.";
	if (!started.ok) return `Leverage answered ${started.status}.`;
	const grant = JSON.parse(started.text) as Grant;
	const link = `${url}/device?user_code=${encodeURIComponent(grant.user_code)}`;
	await browse($, link);
	awaitApproval($, url, grant, arg);
	return `Confirm ${grant.user_code} in the browser: ${link}`;
}

/** `/leverage logout`: forgets the token and leaves Leverage in this window. */
async function logout($: EngineInterface): Promise<string> {
	if (connectedBy() === "launched")
		return "This window runs with the token leverage claude started it with.";
	stopWaiting();
	const file = await accessFile($);
	if (file && (await $.fs.exists(file).catch(() => false))) {
		const removed = await $.process.run(["rm", "-f", file]).catch(() => null);
		if (removed?.exitCode !== 0) await $.fs.write(file, "{}\n");
	}
	disconnect();
	await $.ui.close({ id: PANE }).catch(() => {});
	$.ui.status(undefined);
	// The token itself ends only when Leverage revokes it.
	const revoke = "Leverage Settings → Integrations revokes the token.";
	return (await cliHasToken($))
		? `Signed out here. ${revoke} The Leverage CLI keeps its own: leverage logout ends it.`
		: `Signed out. ${revoke}`;
}

export function registerCommands(on: On) {
	on("command.run", { command: "leverage" }, async ($, e) => {
		const [action = "", ...rest] = e.args.trim().split(/\s+/);
		try {
			if (action === "login") return { text: await login($, rest.join(" ")) };
			if (action === "logout") return { text: await logout($) };
		} catch (error) {
			return { text: `Leverage: ${(error as Error).message}` };
		}
		if (!isReachable())
			return { text: "Not signed in to Leverage. /leverage login signs in." };
		if (!e.args.trim()) {
			await $.ui.open({ id: PANE, title: "Leverage" });
			return { text: "Leverage pane opened. /leverage help lists the rest." };
		}
		try {
			return { text: await run($, e.args) };
		} catch (error) {
			return { text: `Leverage: ${(error as Error).message}` };
		}
	});
}
