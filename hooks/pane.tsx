import type { EngineInterface, On, RenderChildren } from "claude-code";
import { atom, read, update } from "claude-code";

import type {
	Approval,
	Model,
	PaneSession,
	PanelAgent,
	Queued,
	Repository,
	SessionPanel,
	WorkspaceTree,
} from "../types";
import {
	becomeClient,
	follow,
	here,
	isClient,
	isReachable,
	LEVERAGE_TOOLS,
	leverageRequest,
	origin,
} from "./client";

// The Leverage pane, drawn as Claude's session sidebar: the workspace's
// channels, their sessions, who else is in each, and their connections.
// A press on a session moves this window to that session. Under the session
// this window shows, the pane shows and drives it: model, approvals, queue,
// subagents, outputs and changes.

export const PANE = "leverage";
let isRefreshing = false;
const tree = atom({ plugin: "leverage", key: "tree" } as const, null);
/** The text the session titles must hold; empty lists them all. */
const search = atom({ plugin: "leverage", key: "search" } as const, "");
/** The spaces that list all their sessions, not the first few. */
const more = atom({ plugin: "leverage", key: "more" } as const, [] as string[]);
const panel = atom({ plugin: "leverage", key: "panel" } as const, null);
/** How many sessions a space lists before its "more" row. */
const FEW = 8;

// As in Claude's sidebar, only a session that works or waits shows a mark.
const MARK: Record<string, string> = {
	active: "claude",
	running: "claude",
	awaiting_input: "permission",
};
const AT_REST = new Set(["idle", "failed", "stopped"]);
/** The shown session's status at the last read: a change reads it again. */
let lastStatus: string | null = null;
let models: Model[] | null = null;

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

async function refresh($: EngineInterface) {
	if (!isReachable()) return;
	const asked = await read($, search);
	const next = await call<Omit<WorkspaceTree, "attached">>(
		$,
		`/workspace${asked ? `?query=${encodeURIComponent(asked)}` : ""}`,
	);
	await update($, tree, () => ({ ...next, attached: here.id }));
	const status = [
		...next.channels.flatMap((one) => one.sessions),
		...next.direct,
	].find((session) => session.id === here.id)?.status;
	const shown = await read($, panel);
	// A session at rest changes only when its status does.
	if (
		here.id &&
		(shown?.session !== here.id ||
			status !== lastStatus ||
			!AT_REST.has(status ?? ""))
	) {
		lastStatus = status ?? null;
		await readPanel($, here.id);
	}
}

/** Reads what the pane shows under the session this window shows. */
async function readPanel($: EngineInterface, id: string) {
	// A part Leverage cannot answer stays empty; the rest still shows.
	const part = <T,>(path: string, empty: T) =>
		call<T>($, path).catch(() => empty);
	const at = `/sessions/${id}`;
	const [session, waiting, queue, agents, outputs, changes] = await Promise.all(
		[
			part<{ model: string | null; effort: string | null }>(at, {
				model: null,
				effort: null,
			}),
			part<{ writable: boolean; approvals: Approval[]; question: unknown }>(
				`${at}/waiting`,
				{ writable: false, approvals: [], question: null },
			),
			part<Queued[]>(`${at}/queue`, []),
			part<PanelAgent[]>(`${at}/agents`, []),
			part<string[]>(`${at}/outputs`, []),
			part<Repository[]>(`${at}/changes`, []),
		],
	);
	models ??= await part<Model[]>("/models", []);
	// The window may have moved on while this read.
	if (id !== here.id) return;
	await update($, panel, () => ({
		session: id,
		model: session.model,
		effort: session.effort,
		models: models ?? [],
		approvals: waiting.approvals,
		writable: waiting.writable,
		question: Boolean(waiting.question),
		queue,
		agents,
		outputs,
		changes,
	}));
}

/** Runs one action on the session this window shows, then reads it again. */
async function act($: EngineInterface, path: string, body: unknown = {}) {
	const id = here.id;
	try {
		await call($, path, body);
	} catch (error) {
		$.ui.toast(`Leverage refused: ${(error as Error).message}`);
	}
	if (id) await readPanel($, id);
}

/** Keeps an output in the working folder, as /leverage save does. */
async function save($: EngineInterface, path: string) {
	try {
		const file = await call<{ content?: string }>(
			$,
			`/sessions/${here.id}/file?path=${encodeURIComponent(path)}`,
		);
		if (file.content === undefined) {
			$.ui.toast("Leverage cannot read that file.");
			return;
		}
		const name = path.split("/").at(-1) ?? "output";
		await $.fs.write(name, file.content);
		$.ui.toast(`Saved ${name}.`);
	} catch (error) {
		$.ui.toast(`Leverage refused: ${(error as Error).message}`);
	}
}

/** One line of what a waiting call would do: its command, else its input. */
function summary(approval: Approval) {
	const input = (approval.input ?? {}) as Record<string, unknown>;
	const shown =
		typeof input.command === "string"
			? input.command
			: typeof input.file_path === "string"
				? input.file_path
				: JSON.stringify(input);
	return `${approval.tool}: ${shown}`;
}

const firstName = (name: string) => name.split(" ")[0] ?? name;

/** Text that markdown draws as written. */
const plain = (text: string) =>
	text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, "\\$&");

const FACES = [
	"#d97757",
	"#6a9bcc",
	"#788c5d",
	"#9b87c4",
	"#c6613f",
	"#5f9ea0",
];

/** A teammate's face: their initials on a color their name picks. */
function face(name: string, idle: boolean): string {
	const initials = name
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase()
		.replace(/[<>&"']/g, "");
	let hash = 0;
	for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	const color = FACES[hash % FACES.length];
	return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="9" fill="${color}" opacity="${idle ? 0.45 : 1}"/><text x="9" y="12.2" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="7.5" font-weight="600" fill="#fff">${initials}</text></svg>`;
}

/** Something the person can press: a label and what it runs. */
type Press = { key: string; label: string; run: () => unknown };

export function registerPane(on: On) {
	on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
		const elements = $.ui.resolve(e);
		const { Box, Text, Button, Markdown } = elements;
		// A phone has no text field or picker: it lists every session, and the
		// model shows as text. Only a desktop draws pictures.
		const Input = "Input" in elements ? elements.Input : null;
		const Select = "Select" in elements ? elements.Select : null;
		const Svg =
			e.surface !== "terminal" && "Svg" in elements ? elements.Svg : null;
		// A desktop draws every Button as a native button, so beyond the
		// terminal a press is a link in Claude's own text.
		const asLinks = e.surface !== "terminal";
		const asked = await read($, search);
		const open = await read($, more);
		// The first drawing starts the refresh. A timer outlives this dispatch.
		if (!isRefreshing) {
			isRefreshing = true;
			void refresh($);
			$.clock.every(5000, () => refresh($));
		}
		const data = await read($, tree);
		if (!data) {
			return (
				<Text dimColor wrap="wrap">
					Connecting to Leverage… Run leverage claude once in a terminal if it
					never does: the pane reads the token it keeps.
				</Text>
			);
		}
		const shown = await read($, panel);
		const web = `${origin()}/w/${encodeURIComponent(data.workspace)}`;
		/** A session's page in Leverage: where its links point. */
		const page = (id: string) => `${web}/session/${encodeURIComponent(id)}`;

		/** Presses in a row: links in Claude's text, or plain terminal buttons. */
		const presses = (
			key: string,
			base: string,
			items: Press[],
			isDim = true,
		) => {
			if (!asLinks) {
				return (
					<Box key={key} flexDirection="row" gap={2} flexWrap="wrap">
						{items.map((item) => (
							<Button
								key={item.key}
								plain
								dimColor={isDim}
								label={item.label}
								onPress={() => void item.run()}
							/>
						))}
					</Box>
				);
			}
			const href = (item: Press) => `${base}#${encodeURIComponent(item.key)}`;
			return (
				<Markdown
					key={key}
					dimColor={isDim}
					text={items
						.map((item) => `[${plain(item.label)}](${href(item)})`)
						.join(" · ")}
					pressableLinks={items.map(href)}
					onLinkPress={(link) =>
						void items.find((item) => href(item) === link.href)?.run()
					}
				/>
			);
		};

		const attach = async (session: PaneSession) => {
			if (session.id === data.attached) return;
			// The window starts at the session's newest row.
			const opened = await call<{ id: string; cursor: number }>(
				$,
				`/sessions/${session.id}`,
			);
			follow(opened.id, opened.cursor);
			// From here the window runs the session's turns in Leverage.
			if (!isClient()) {
				for (const tool of LEVERAGE_TOOLS) await $.tool.register(tool);
				becomeClient();
			}
			// One window mirrors one session, so the old transcript goes.
			await $.command.run({ command: "clear" });
			$.ui.status(session.title);
			// Opened, it reads as read, and its last turns show as one notice.
			await call($, `/sessions/${session.id}/read`, {});
			const { messages } = await call<{
				messages: { author: string; text: string }[];
			}>($, `/sessions/${session.id}/history`);
			if (messages.length > 0) {
				const text = messages
					.map((message) => `${message.author}: ${message.text}`)
					.join("\n\n");
				await $.session.append({
					message: {
						type: "system",
						content: [
							{ type: "text", text: `Earlier in this session:\n\n${text}` },
						],
					},
				});
			}
			await refresh($);
		};

		/** Who else has the session open: their faces, or who types. */
		const people = (session: PaneSession) => {
			const viewers = session.viewers ?? [];
			const typing = session.typing ?? [];
			if (typing.length > 0) {
				return (
					<Text dimColor italic wrap="truncate">
						{firstName(typing[0] ?? "")} types…
					</Text>
				);
			}
			if (viewers.length === 0) return null;
			if (Svg) {
				return (
					<Box flexDirection="row" gap={0}>
						{viewers.slice(0, 3).map((viewer) => (
							<Svg
								source={face(viewer.name, viewer.state === "idle")}
								alt={`${viewer.name} has it open`}
								width={18}
								height={18}
							/>
						))}
						{viewers.length > 3 ? (
							<Text dimColor> +{viewers.length - 3}</Text>
						) : null}
					</Box>
				);
			}
			const [first, ...others] = viewers;
			return (
				<Text wrap="truncate">
					<Text color={first?.state === "idle" ? "warning" : "success"}>●</Text>
					<Text dimColor>
						{" "}
						{firstName(first?.name ?? "")}
						{others.length ? ` +${others.length}` : ""}
					</Text>
				</Text>
			);
		};

		const section = (key: string, title: string, children: RenderChildren) => (
			<Box key={`${key}-section`} flexDirection="column" marginTop={1}>
				<Text dimColor>{title}</Text>
				{children}
			</Box>
		);

		const sessionPanel = (session: PaneSession) => {
			if (!shown || shown.session !== session.id)
				return (
					<Box paddingLeft={3}>
						<Text dimColor>Reading the session…</Text>
					</Box>
				);
			const at = `/sessions/${session.id}`;
			const base = page(session.id);
			const model = shown.models.find((one) => one.id === shown.model);
			const decide = (approval: Approval, decision: string) => {
				// Decided here, Claude Code's dialog does not ask it again.
				here.known.add(approval.id);
				return act($, `/approvals/${approval.id}`, { decision });
			};
			const changes = shown.changes.map((repository) => {
				const files = repository.changes.length;
				const pull = repository.pullRequest
					? ` · [#${repository.pullRequest.number}](${repository.pullRequest.url})`
					: "";
				return `**${plain(repository.name)}**${repository.branch ? ` on \`${repository.branch}\`` : ""} · ${files} ${files === 1 ? "file" : "files"}${pull}`;
			});
			return (
				<Box flexDirection="column" paddingLeft={3} paddingRight={1}>
					{section(
						"model",
						"Model",
						Select && shown.models.length > 0 ? (
							<Box flexDirection="row" gap={1} flexWrap="wrap">
								<Select
									key="model"
									options={shown.models.map((one) => ({
										value: one.id,
										label: one.label,
									}))}
									{...(shown.model ? { value: shown.model } : {})}
									onSelect={(value: string) =>
										act($, `${at}/model`, {
											model: value,
											// The effort carries over when the new model has it.
											effort: shown.models
												.find((one) => one.id === value)
												?.efforts.includes(shown.effort ?? "")
												? shown.effort
												: null,
										})
									}
								/>
								{model && model.efforts.length > 0 ? (
									<Select
										key="effort"
										options={model.efforts.map((effort) => ({ value: effort }))}
										{...(shown.effort ? { value: shown.effort } : {})}
										onSelect={(value: string) =>
											act($, `${at}/model`, { model: model.id, effort: value })
										}
									/>
								) : null}
							</Box>
						) : (
							<Text>
								{model?.label ?? shown.model ?? "The space's default"}
								{shown.effort ? ` · ${shown.effort}` : ""}
							</Text>
						),
					)}
					{shown.approvals.length > 0 || shown.question
						? section(
								"waiting",
								"Waiting on you",
								<Box flexDirection="column">
									{shown.approvals.map((approval) => (
										<Box key={`approval-${approval.id}`} flexDirection="column">
											<Text wrap="truncate">{summary(approval)}</Text>
											{shown.writable ? (
												presses(
													`decide-${approval.id}`,
													base,
													[
														{
															key: `allow-${approval.id}`,
															label: "Allow",
															run: () => decide(approval, "once"),
														},
														{
															key: `allow-session-${approval.id}`,
															label: "Allow for this session",
															run: () => decide(approval, "session"),
														},
														{
															key: `reject-${approval.id}`,
															label: "Reject",
															run: () => decide(approval, "reject"),
														},
													],
													false,
												)
											) : (
												<Text dimColor>The session's owner answers this.</Text>
											)}
										</Box>
									))}
									{shown.question ? (
										<Text dimColor>A question waits in the session.</Text>
									) : null}
								</Box>,
							)
						: null}
					{shown.queue.length > 0
						? section(
								"queue",
								"Queue",
								shown.queue.map((queued) => (
									<Box key={`queued-${queued.uuid}`} flexDirection="column">
										<Text wrap="truncate">{queued.text}</Text>
										{presses(`queue-${queued.uuid}`, base, [
											{
												key: `send-${queued.uuid}`,
												label: "Send now",
												run: () => act($, `${at}/queue/${queued.uuid}/send`),
											},
											{
												key: `take-${queued.uuid}`,
												label: "Take back",
												run: () => act($, `${at}/queue/${queued.uuid}/cancel`),
											},
										])}
									</Box>
								)),
							)
						: null}
					{shown.agents.length > 0
						? section(
								"agents",
								"Subagents",
								shown.agents.map((agent) => (
									<Text key={`agent-${agent.task}`} wrap="truncate">
										<Text color={agent.running ? "claude" : "inactive"}>
											{agent.running ? "●" : "○"}
										</Text>{" "}
										{agent.description || "Subagent"}
										<Text dimColor>
											{agent.type ? ` · ${agent.type}` : ""}
											{agent.status ? ` · ${agent.status}` : ""}
										</Text>
									</Text>
								)),
							)
						: null}
					{shown.outputs.length > 0
						? section(
								"outputs",
								"Outputs",
								presses(
									"outputs-list",
									base,
									shown.outputs.map((path) => ({
										key: `output-${path}`,
										label: path,
										run: () => save($, path),
									})),
									false,
								),
							)
						: null}
					{changes.length > 0
						? section(
								"changes",
								"Changes",
								<Markdown key="changes-list" text={changes.join("  \n")} />,
							)
						: null}
					<Box marginTop={1}>
						{presses("actions", base, [
							...(!AT_REST.has(session.status)
								? [
										{
											key: "stop",
											label: "Stop",
											run: () => act($, `${at}/stop`),
										},
									]
								: []),
							{
								key: "compact",
								label: "Compact",
								run: () => act($, `${at}/compact`),
							},
							{
								key: "archive",
								label: "Archive",
								run: () => act($, `${at}/archive`),
							},
						])}
					</Box>
				</Box>
			);
		};

		const row = (session: PaneSession) => {
			const isHere = session.id === data.attached;
			const link = page(session.id);
			const title = isHere ? (
				<Text bold wrap="truncate">
					{session.title}
				</Text>
			) : asLinks ? (
				<Markdown
					key={`s-${session.id}`}
					text={`[${plain(session.title)}](${link})`}
					pressableLinks={[link]}
					onLinkPress={() => void attach(session)}
				/>
			) : (
				<Button
					key={`s-${session.id}`}
					plain
					dimColor
					label={session.title}
					onPress={() => attach(session)}
				/>
			);
			return (
				<Box key={`session-${session.id}`} flexDirection="column">
					<Box
						key={`row-${session.id}`}
						flexDirection="row"
						alignItems="center"
						gap={1}
						paddingX={1}
						{...(isHere ? { backgroundColor: "userMessageBackground" } : {})}
						hover={{ backgroundColor: "userMessageBackground" }}
					>
						<Text color={MARK[session.status] ?? "inactive"}>
							{MARK[session.status] ? "●" : " "}
						</Text>
						<Box flexGrow={1} flexShrink={1}>
							{title}
						</Box>
						{people(session)}
					</Box>
					{isHere ? sessionPanel(session) : null}
				</Box>
			);
		};

		const sessions = (owner: string, list: PaneSession[]) => {
			const listed = open.includes(owner) ? list : list.slice(0, FEW);
			return [
				...listed.map(row),
				...(list.length > listed.length
					? [
							<Box key={`more-row-${owner}`} paddingX={1} paddingLeft={3}>
								{presses(`more-${owner}`, web, [
									{
										key: `more-${owner}`,
										label: `${list.length - listed.length} more`,
										run: () =>
											update($, more, (ids) => [...(ids ?? []), owner]),
									},
								])}
							</Box>,
						]
					: []),
			];
		};
		const searchBox = Input ? (
			<Input
				key="search"
				placeholder="Search sessions"
				value={asked}
				onSubmit={async (value: string) => {
					await update($, search, () => value.trim());
					await refresh($);
				}}
			/>
		) : null;

		return (
			<Box flexDirection="column" paddingX={1}>
				<Box paddingX={1} marginBottom={1}>
					<Text bold>{data.workspace}</Text>
				</Box>
				{searchBox}
				{data.channels.map((channel) => (
					<Box key={channel.id} flexDirection="column" marginTop={1}>
						<Box paddingX={1}>
							<Text dimColor>#{channel.name}</Text>
						</Box>
						{sessions(channel.id, channel.sessions)}
						{channel.sessions.length === 0 ? (
							<Box paddingX={1} paddingLeft={3}>
								<Text dimColor>No sessions yet</Text>
							</Box>
						) : null}
						{channel.connections.length > 0 ? (
							<Box paddingX={1} paddingLeft={3}>
								<Text dimColor wrap="truncate">
									{channel.connections.join(" · ")}
								</Text>
							</Box>
						) : null}
					</Box>
				))}
				{data.direct.length > 0 && (
					<Box flexDirection="column" marginTop={1}>
						<Box paddingX={1}>
							<Text dimColor>Private</Text>
						</Box>
						{sessions("direct", data.direct)}
					</Box>
				)}
			</Box>
		);
	});
}
