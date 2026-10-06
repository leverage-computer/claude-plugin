import type { EngineInterface, Register } from "claude-code";
import { update } from "claude-code";

import type { Room, WorkspaceTree } from "../types";
import {
	connect,
	drawn,
	follow,
	here,
	isConnected,
	leverageRequest,
	space,
} from "./client";
import { registerCommands } from "./commands";
import { PANE, registerPane } from "./pane";
import { registerPeople } from "./people";

// Makes this Claude Code session a client of one Leverage session. The turn
// runs in the Leverage sandbox. This process draws it and never calls a model.

type Block =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| { kind: "tool"; id: string; name: string; input: Record<string, unknown> };
type Waiting = {
	writable: boolean;
	approvals: { id: string; tool: string; input: unknown }[];
	question: string | null;
};
type Step =
	| {
			blocks: Block[];
			stop: "tool_use" | "end_turn";
			cursor: number;
			turnId: string | null;
			/** The tokens the Leverage session's context holds. */
			context: number | null;
			question: string | null;
	  }
	| {
			pending: true;
			waiting?: Waiting;
			/** The text the agent is writing, which no row holds yet. */
			live?: { id: string; kind: "text" | "reasoning"; text: string }[];
	  };
type Result =
	| { content: string; isError: boolean }
	| { pending: true; progress?: string; seen?: number };

// Remote tools with a local twin whose output shape the mod can build.
const NATIVE = new Set(["Bash", "Read", "Edit", "Write"]);
// Remote tools drawn as tools of this mod. Others go to `remote_tool`.
const MIRRORED = [
	"Grep",
	"Glob",
	"Task",
	"Agent",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
	"NotebookEdit",
	"Skill",
	"ExitPlanMode",
	"ToolSearch",
	"leverage_execute",
];
const usage = (context: number | null) => ({
	input_tokens: context ?? 0,
	output_tokens: 0,
	cache_creation_input_tokens: 0,
	cache_read_input_tokens: 0,
	model: "leverage",
});
/** The window's status line: the session's title, or its space. */
let shown = "Leverage";
/** The rows already shown as notices, by position. */
const noticed = new Set<number>();
/** The background commands still running, by task id. */
const running = new Set<string>();
/** The people the last prompt poll saw, as sent, so an unchanged room draws nothing. */
let seenRoom = "";
/** Prompts asked to wait, still in Claude Code's queue, oldest first. */
const waiting: { text: string; skills: { name: string }[]; pasted: boolean }[] =
	[];

/** The status line: the session, and what runs in the background. */
function line(): string {
	return running.size > 0
		? `${shown} · ${running.size} in the background`
		: shown;
}
const CHOICES = ["Once", "This session", "Always", "Reject"];
const DECISIONS: Record<string, string> = {
	Once: "once",
	"This session": "session",
	Always: "always",
	Reject: "reject",
};

async function call<T>(
	$: EngineInterface,
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await $.http.fetch(...leverageRequest(path, body));
	if (!res.ok) {
		throw new Error(
			res.status === 401
				? "Leverage refused this Claude Code token. Run leverage claude again."
				: `Leverage answered ${res.status}: ${res.text}`,
		);
	}
	return JSON.parse(res.text) as T;
}

// The session's title, or its space until the first prompt starts one.
async function showLabel($: EngineInterface) {
	let label = "";
	if (here.id) {
		label = (await call<{ title: string }>($, `/sessions/${here.id}`)).title;
	} else if (space()) {
		const tree = await call<WorkspaceTree>($, "/workspace");
		const channel = tree.channels.find((one) => one.id === space());
		label = channel ? `#${channel.name}` : "";
	}
	// The engine shows the plugin name before the line.
	shown = label || "Leverage";
	$.ui.status(line());
}

// Asks each call that waits on this person, in Claude Code's own dialog.
async function askApprovals($: EngineInterface, waiting: Waiting) {
	for (const pending of waiting.approvals) {
		if (here.known.has(pending.id)) continue;
		here.known.add(pending.id);
		if (!waiting.writable) {
			$.ui.status(`${shown} · waiting for approval of ${pending.tool}`);
			continue;
		}
		let answer: string;
		try {
			answer = await $.ui.ask(
				`Allow ${pending.tool} to run in Leverage? ${JSON.stringify(pending.input).slice(0, 300)}`,
				{ header: "Approval", options: CHOICES },
			);
		} catch {
			$.ui.toast("Not decided. /leverage approvals asks again.");
			continue;
		}
		// Text typed under Other rejects the call, and Leverage passes it on.
		const decision = DECISIONS[answer] ?? "reject";
		await call($, `/approvals/${pending.id}`, {
			decision,
			...(DECISIONS[answer] ? {} : { reason: answer }),
		});
	}
}

// Reads the session's last turns into one notice, so an opened window has context.
async function showHistory($: EngineInterface) {
	const { messages } = await call<{
		messages: { author: string; text: string }[];
	}>($, `/sessions/${here.id}/history`);
	if (messages.length === 0) return;
	const text = messages
		.map((message) => `${message.author}: ${message.text}`)
		.join("\n\n");
	await $.session.append({
		message: {
			type: "system",
			content: [{ type: "text", text: `Earlier in this session:\n\n${text}` }],
		},
	});
}

// Sends a prompt of this window. The first one starts the session, named
// here so a retried start makes no second one.
async function send(
	$: EngineInterface,
	prompt: {
		text: string;
		images: { filename: string; dataUrl: string }[];
		skills: { name: string }[];
		steer?: boolean;
	},
) {
	const uuid = crypto.randomUUID();
	drawn.add(uuid);
	if (here.id) {
		await call($, `/sessions/${here.id}/messages`, { ...prompt, uuid });
		return;
	}
	const { steer: _, ...first } = prompt;
	const started = await call<{ id: string; cursor: number }>($, "/sessions", {
		id: crypto.randomUUID(),
		channelId: space(),
		...first,
		uuid,
	});
	follow(started.id, started.cursor);
	await showLabel($);
}

// Opens the session in this window: its history, and it reads as read.
async function open($: EngineInterface) {
	await call($, `/sessions/${here.id}/read`, {});
	await showHistory($);
}

function localName(name: string): string {
	// Claude Code asks it in its own dialog.
	if (NATIVE.has(name) || name === "AskUserQuestion") return name;
	const short = name.replace(/^mcp__leverage__/, "");
	return MIRRORED.includes(short)
		? `mcp__leverage__${short}`
		: "mcp__leverage__remote_tool";
}

function localInput(name: string, block: Extract<Block, { kind: "tool" }>) {
	return localName(name) === "mcp__leverage__remote_tool"
		? { name: block.name, input: block.input }
		: block.input;
}

function lines(text: string): string[] {
	return text === "" ? [] : text.split("\n");
}

// The images of the prompt just added to this session, as data URLs.
async function lastImages($: EngineInterface) {
	const messages = await $.session.messages({ as: "api" });
	const prompt = [...messages]
		.reverse()
		.find((message) => message.role === "user");
	return (prompt?.content ?? []).flatMap((block, index) => {
		const source = block.source as
			| { type?: string; media_type?: string; data?: string }
			| undefined;
		if (block.type !== "image" || source?.type !== "base64") return [];
		return [
			{
				filename: `image-${index + 1}.${source.media_type?.split("/")[1] ?? "png"}`,
				dataUrl: `data:${source.media_type};base64,${source.data}`,
			},
		];
	});
}

// Where an edit's new text starts in its file, read back from the session.
async function editLine($: EngineInterface, input: Record<string, unknown>) {
	const path = String(input.file_path ?? "");
	const after = String(input.new_string ?? "");
	if (!path.startsWith("/work/") || !after) return 1;
	try {
		const file = await call<{ content?: string }>(
			$,
			`/sessions/${here.id}/file?path=${encodeURIComponent(path.slice("/work/".length))}`,
		);
		const at = file.content?.indexOf(after) ?? -1;
		return at < 0 ? 1 : (file.content ?? "").slice(0, at).split("\n").length;
	} catch {
		return 1;
	}
}

/** Above this many line pairs an edit draws as all removed, then all added. */
const DIFF_LIMIT = 250_000;

// The lines both sides keep show as context; the rest as removed and added.
function lineDiff(before: string[], after: string[]): string[] {
	const n = before.length;
	const m = after.length;
	if (n * m > DIFF_LIMIT) {
		return [...before.map((l) => `-${l}`), ...after.map((l) => `+${l}`)];
	}
	// kept[i][j]: how many lines the rest of both sides have in common.
	const kept = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0),
	);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			kept[i]![j] =
				before[i] === after[j]
					? kept[i + 1]![j + 1]! + 1
					: Math.max(kept[i + 1]![j]!, kept[i]![j + 1]!);
		}
	}
	const out: string[] = [];
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && before[i] === after[j]) {
			out.push(` ${before[i]}`);
			i++;
			j++;
		} else if (i < n && (j === m || kept[i + 1]![j]! >= kept[i]![j + 1]!)) {
			out.push(`-${before[i]}`);
			i++;
		} else {
			out.push(`+${after[j]}`);
			j++;
		}
	}
	return out;
}

// Builds the output shape each native tool's schema demands. `line` is where
// an edit starts in its file.
function nativeResult(
	tool: string,
	input: Record<string, unknown>,
	content: string,
	line = 1,
) {
	const path = String(input.file_path ?? "");
	switch (tool) {
		case "Bash":
			return { stdout: content, stderr: "", interrupted: false };
		case "Read": {
			const body = content.replace(/^\s*\d+\t/gm, "");
			const count = lines(body).length;
			return {
				type: "text",
				file: {
					filePath: path,
					content: body,
					numLines: count,
					startLine: Number(input.offset ?? 1),
					totalLines: count,
				},
			};
		}
		case "Edit": {
			const before = lines(String(input.old_string ?? ""));
			const after = lines(String(input.new_string ?? ""));
			return {
				filePath: path,
				oldString: String(input.old_string ?? ""),
				newString: String(input.new_string ?? ""),
				originalFile: null,
				structuredPatch: [
					{
						oldStart: line,
						oldLines: before.length,
						newStart: line,
						newLines: after.length,
						lines: lineDiff(before, after),
					},
				],
				userModified: false,
				replaceAll: input.replace_all === true,
			};
		}
		case "Write":
			return {
				type: "create",
				filePath: path,
				content: String(input.content ?? ""),
				structuredPatch: [],
				originalFile: null,
			};
	}
	return content;
}

export const register: Register = (on) => {
	registerPane(on);
	registerCommands(on);
	registerPeople(on);

	on("session.start", async ($, e, next) => {
		const result = await next(e);
		const connected = connect({
			url: await $.env.get("LEVERAGE_CLAUDE_URL"),
			token: await $.env.get("LEVERAGE_CLAUDE_TOKEN"),
			space: await $.env.get("LEVERAGE_CLAUDE_SPACE"),
			session: await $.env.get("LEVERAGE_CLAUDE_SESSION"),
		});
		if (!connected) return result;
		for (const name of [...MIRRORED, "remote_tool"]) {
			await $.tool.register({
				name,
				description: `${name}, run by the Leverage session.`,
				inputSchema: { type: "object", additionalProperties: true },
			});
		}
		// A window opened on a session starts at its newest row.
		if (here.id) {
			const opened = await call<{ id: string; cursor: number }>(
				$,
				`/sessions/${here.id}`,
			);
			follow(opened.id, opened.cursor);
			await open($);
		}
		await showLabel($);
		await $.command.register({
			name: "leverage",
			description: "The Leverage session: pane, approvals, files, model…",
			argumentHint: "[help]",
		});
		void $.ui.open({ id: PANE, title: "Leverage" });
		// Turns started from another client open a turn here, so both show it.
		$.clock.every(1500, async () => {
			if (!here.id) return;
			const { prompts, notices, last, viewers, typing } = await call<
				{
					prompts: {
						uuid: string;
						author: string;
						text: string;
						images: number;
						steer: boolean;
					}[];
					notices: {
						seq: number;
						text: string;
						task?: { id: string; running: boolean };
					}[];
					last: number;
				} & Room
			>($, `/sessions/${here.id}/prompts?after=${here.polled}`);
			here.polled = Math.max(here.polled, last);
			// An older Leverage sends no room.
			const room: Room = { viewers: viewers ?? [], typing: typing ?? [] };
			if (JSON.stringify(room) !== seenRoom) {
				seenRoom = JSON.stringify(room);
				await update($, { plugin: "leverage", key: "people" }, () => room);
			}
			// A row the window does not draw, as a compaction, shows as a notice.
			for (const notice of notices) {
				if (noticed.has(notice.seq)) continue;
				noticed.add(notice.seq);
				if (notice.task?.running) running.add(notice.task.id);
				else if (notice.task) running.delete(notice.task.id);
				$.ui.status(line());
				await $.session
					.append({
						message: {
							type: "system",
							content: [{ type: "text", text: notice.text }],
						},
					})
					.catch(() => {});
			}
			for (const p of prompts) {
				if (drawn.has(p.uuid)) continue;
				drawn.add(p.uuid);
				// A teammate's steer joins the running turn; Claude Code only shows it.
				if (p.steer) {
					await $.session
						.append({
							message: {
								type: "system",
								content: [
									{
										type: "text",
										text: `${p.author} (in Leverage) adds: ${p.text}`,
									},
								],
							},
						})
						.catch(() => {});
					continue;
				}
				// Claude Code takes no image from a plugin, so the prompt says it has some.
				const images =
					p.images > 0
						? ` [${p.images} image${p.images > 1 ? "s" : ""} in Leverage]`
						: "";
				await $.prompt.submit({
					text: `${p.author} (in Leverage): ${p.text}${images}`,
					asUser: true,
				});
			}
		});
		return result;
	});

	on("prompt.submit", async ($, e, next) => {
		// A plugin's prompt is a teammate's, already sent, unless it carries a skill.
		if (!isConnected() || (e.origin.kind === "plugin" && !here.skill)) {
			return next(e);
		}
		const skills = here.skill ? [{ name: here.skill }] : [];
		here.skill = null;
		// A sent prompt ends the typing the others see.
		if (here.typedAt && here.id) {
			here.typedAt = 0;
			void call($, `/sessions/${here.id}/typing`, { active: false }).catch(
				() => {},
			);
		}
		const pasted =
			e.attachments?.some((item) => item.type === "image") ?? false;
		// Asked to wait (ctrl+x enter), it stays in Claude Code's queue, where it
		// can be taken back, and goes to Leverage when its own turn starts.
		if (e.turnId && e.wait) {
			waiting.push({ text: e.text, skills, pasted });
			return next(e);
		}
		// Typed over a running turn, it steers that turn in Leverage too. Its
		// images enter the session only later, so a steer goes without them.
		const steer = Boolean(e.turnId);
		const result = pasted && !steer ? await next(e) : null;
		const images = pasted && !steer ? await lastImages($) : [];
		await send($, { text: e.text, images, skills, steer });
		return result ?? next(e);
	});

	// A prompt that waited in Claude Code's queue goes when its turn starts.
	on("turn.start", async ($, e, next) => {
		const result = await next(e);
		if (!isConnected()) return result;
		const at = waiting.findIndex((one) => one.text === e.text);
		if (at < 0) return result;
		const [prompt] = waiting.splice(at, 1);
		if (!prompt) return result;
		const images = prompt.pasted ? await lastImages($) : [];
		await send($, { text: prompt.text, images, skills: prompt.skills });
		return result;
	});

	// Esc here stops the turn in the sandbox too.
	on("turn.complete", async ($, e, next) => {
		if (isConnected() && here.id && e.reason === "aborted") {
			here.skip = here.turnId;
			await call($, `/sessions/${here.id}/stop`, {});
		}
		return next(e);
	});

	// The Leverage session holds the context, so it compacts, not this window.
	on("session.compact", async ($, e, next) => {
		if (!isConnected()) return next(e);
		if (e.trigger !== "manual" || !here.id) {
			return { skip: "The Leverage session compacts itself." };
		}
		await call($, `/sessions/${here.id}/compact`, {});
		return { skip: "Leverage is compacting this session." };
	});

	// One window shows one Leverage session, so these act on Leverage.
	on("command.run", { command: "rename" }, async ($, e, next) => {
		if (!isConnected() || !here.id) return next(e);
		const title = e.args.trim();
		if (!title) return { text: "Name the session: /rename <title>" };
		await call($, `/sessions/${here.id}/rename`, { title });
		await showLabel($);
		return { text: `Renamed the Leverage session to ${title}.` };
	});
	on("command.run", { command: "resume" }, ($, e, next) =>
		isConnected()
			? { text: "/leverage opens another Leverage session in this window." }
			: next(e),
	);

	on("turn.step", async function* ($, e, next) {
		if (!isConnected()) return yield* next(e);
		let step: Exclude<Step, { pending: true }>;
		// Each message drawn as it arrives, at the block index it took.
		const streamed: {
			id: string;
			kind: "text" | "thinking";
			text: string;
			index: number;
		}[] = [];
		let index = 0;
		for (;;) {
			if (next.signal.aborted) throw new Error("aborted");
			const skip = here.skip ? `&skip=${here.skip}` : "";
			const known =
				here.known.size > 0 ? `&known=${[...here.known].join(",")}` : "";
			const drawn = streamed.map((entry) => `${entry.id}:${entry.text.length}`);
			const shown =
				drawn.length > 0 ? `&shown=${encodeURIComponent(drawn.join(","))}` : "";
			const answer = await call<Step>(
				$,
				`/sessions/${here.id}/step?after=${here.cursor}&stream=true${skip}${known}${shown}`,
			);
			if (!("pending" in answer)) {
				step = answer;
				break;
			}
			if (answer.waiting) await askApprovals($, answer.waiting);
			for (const live of answer.live ?? []) {
				let entry = streamed.find((one) => one.id === live.id);
				if (!entry) {
					const kind = live.kind === "reasoning" ? "thinking" : "text";
					entry = { id: live.id, kind, text: "", index: index++ };
					streamed.push(entry);
				}
				if (!live.text.startsWith(entry.text)) continue;
				const piece = live.text.slice(entry.text.length);
				entry.text = live.text;
				if (piece) yield { kind: entry.kind, index: entry.index, text: piece };
			}
		}
		here.cursor = step.cursor;
		here.turnId = step.turnId;
		here.question = step.question;
		// A first turn names the session.
		if (step.stop === "end_turn") void showLabel($);
		let answer = "";
		const toolUses: { name: string; input: unknown }[] = [];
		let matched = 0;
		for (const block of step.blocks) {
			if (block.kind === "text" || block.kind === "thinking") {
				if (block.kind === "text") answer += block.text;
				// A message streamed already gets the rest of its text.
				const rest = streamed.slice(matched);
				const entry = rest.find((one) => one.kind === block.kind);
				if (entry && block.text.startsWith(entry.text)) {
					matched = streamed.indexOf(entry) + 1;
					const piece = block.text.slice(entry.text.length);
					if (piece)
						yield { kind: block.kind, index: entry.index, text: piece };
				} else {
					yield { kind: block.kind, index: index++, text: block.text };
				}
			} else {
				const name = localName(block.name);
				const input = localInput(name, block);
				here.calls.add(block.id);
				toolUses.push({ name, input });
				yield { kind: "tool", index, id: block.id, name };
				yield { kind: "input", index: index++, json: JSON.stringify(input) };
			}
		}
		yield { kind: "stop", stopReason: step.stop, usage: usage(step.context) };
		return {
			turnId: e.turnId,
			index: e.index,
			answer,
			toolUses,
			stopReason: step.stop,
			usage: usage(step.context),
		};
	});

	on("tool.call", async ($, e, next) => {
		const id = e.tool_use_id ?? "";
		if (!isConnected() || !here.calls.has(id)) return next(e);
		const asked = here.question === id;
		if (asked) here.question = null;
		if (e.tool === "AskUserQuestion" && asked) {
			// Claude Code asks it; Leverage takes the answers as the web app does.
			const answered = await next(e);
			const answers =
				(answered as { result?: { answers?: Record<string, string> } }).result
					?.answers ?? {};
			// Answered in another app meanwhile: Leverage keeps that answer.
			await call($, `/sessions/${here.id}/answers`, {
				toolUseId: id,
				answers,
			}).catch(() => {});
			return answered;
		}
		if (e.tool === "mcp__leverage__ExitPlanMode" && asked) {
			const answer = await $.ui
				.ask("Approve this plan?", {
					header: "Plan",
					options: ["Approve", "Request changes"],
				})
				.catch(() => "");
			if (answer) {
				const plan = answer === "Approve" ? "approved" : "changes_requested";
				await call($, `/sessions/${here.id}/answers`, {
					toolUseId: id,
					answers: { plan },
				});
			}
		}
		const name = String(e.tool).replace(/^mcp__leverage__/, "");
		$.ui.status(`${line()} · ${name} runs in Leverage`);
		// The tool's own progress shows on the status line until its result.
		let seen = 0;
		let result: Exclude<Result, { pending: true }>;
		for (;;) {
			if (next.signal.aborted) throw new Error("aborted");
			const answer = await call<Result>(
				$,
				`/sessions/${here.id}/results/${encodeURIComponent(id)}?stream=true&seen=${seen}`,
			);
			if (!("pending" in answer)) {
				result = answer;
				break;
			}
			if (answer.progress !== undefined) {
				seen = answer.seen ?? seen;
				const progress = answer.progress.trim().split("\n").at(-1) ?? "";
				$.ui.status(`${line()} · ${name}: ${progress.slice(0, 120)}`);
			}
		}
		$.ui.status(line());
		if (e.tool === "AskUserQuestion") {
			// Answered in another app: the answers read as that app's reply.
			const input = e as { questions?: unknown[] };
			return {
				result: {
					questions: input.questions ?? [],
					answers: {},
					response: result.content,
				} as never,
			};
		}
		if (result.isError) return { deny: result.content };
		const { tool, tool_use_id: _, ...input } = e as Record<string, unknown>;
		const line = tool === "Edit" ? await editLine($, input) : 1;
		const shaped = NATIVE.has(String(tool))
			? nativeResult(String(tool), input, result.content, line)
			: result.content;
		return { result: shaped as never };
	});
};
