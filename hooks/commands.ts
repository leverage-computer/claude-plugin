import type { EngineInterface, On } from "claude-code";

import { here, isReachable, leverageRequest, space } from "./client";
import { PANE } from "./pane";

// `/leverage <action>`: what the other Leverage apps do with a session,
// done on the session this window shows. Bare, it opens the pane.

const HELP = `/leverage                 open the pane: spaces, sessions, connections
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

export function registerCommands(on: On) {
	on("command.run", { command: "leverage" }, async ($, e) => {
		if (!isReachable()) {
			return {
				text: "No Leverage here yet. Run leverage claude once in a terminal: it keeps the token this plugin reads.",
			};
		}
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
