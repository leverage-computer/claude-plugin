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
import { connect, follow, here, leverageRequest } from "./client";

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
	const connected = connect({
		url: await $.env.get("LEVERAGE_CLAUDE_URL"),
		token: await $.env.get("LEVERAGE_CLAUDE_TOKEN"),
		space: await $.env.get("LEVERAGE_CLAUDE_SPACE"),
		session: await $.env.get("LEVERAGE_CLAUDE_SESSION"),
	});
	if (!connected) return;
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

export function registerPane(on: On) {
	on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
		const elements = $.ui.resolve(e);
		const { Box, Text, Button, Link } = elements;
		// A phone has no text field or picker: it lists every session, and the
		// model shows as text.
		const Input = "Input" in elements ? elements.Input : null;
		const Select = "Select" in elements ? elements.Select : null;
		const asked = await read($, search);
		const open = await read($, more);
		// The first drawing starts the refresh. A timer outlives this dispatch.
		if (!isRefreshing) {
			isRefreshing = true;
			void refresh($);
			$.clock.every(5000, () => refresh($));
		}
		const data = await read($, tree);
		if (!data) return <Text dimColor>Connecting to Leverage…</Text>;
		const shown = await read($, panel);

		const attach = async (session: PaneSession) => {
			if (session.id === data.attached) return;
			// The window starts at the session's newest row.
			const opened = await call<{ id: string; cursor: number }>(
				$,
				`/sessions/${session.id}`,
			);
			follow(opened.id, opened.cursor);
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

		const section = (key: string, title: string, children: RenderChildren) => (
			<Box key={key} flexDirection="column" marginTop={1}>
				<Text dimColor>{title}</Text>
				{children}
			</Box>
		);

		const sessionPanel = (session: PaneSession) => {
			if (!shown || shown.session !== session.id)
				return <Text dimColor> Reading the session…</Text>;
			const at = `/sessions/${session.id}`;
			const model = shown.models.find((one) => one.id === shown.model);
			const decide = (approval: Approval, decision: string) => {
				// Decided here, Claude Code's dialog does not ask it again.
				here.known.add(approval.id);
				return act($, `/approvals/${approval.id}`, { decision });
			};
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
												<Box flexDirection="row" gap={1}>
													<Button
														key={`allow-${approval.id}`}
														label="Allow"
														variant="primary"
														onPress={() => decide(approval, "once")}
													/>
													<Button
														key={`allow-session-${approval.id}`}
														label="Allow for the session"
														onPress={() => decide(approval, "session")}
													/>
													<Button
														key={`reject-${approval.id}`}
														label="Reject"
														onPress={() => decide(approval, "reject")}
													/>
												</Box>
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
									<Box
										key={`queued-${queued.uuid}`}
										flexDirection="row"
										gap={1}
									>
										<Box flexGrow={1}>
											<Text wrap="truncate">{queued.text}</Text>
										</Box>
										<Button
											key={`send-${queued.uuid}`}
											label="Send now"
											plain
											onPress={() => act($, `${at}/queue/${queued.uuid}/send`)}
										/>
										<Button
											key={`take-${queued.uuid}`}
											label="Take back"
											plain
											dimColor
											onPress={() =>
												act($, `${at}/queue/${queued.uuid}/cancel`)
											}
										/>
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
								shown.outputs.map((path) => (
									<Button
										key={`output-${path}`}
										label={path}
										plain
										dimColor
										onPress={() => save($, path)}
									/>
								)),
							)
						: null}
					{shown.changes.length > 0
						? section(
								"changes",
								"Changes",
								shown.changes.map((repository) => (
									<Text key={`repo-${repository.name}`} wrap="truncate">
										{repository.name}
										<Text dimColor>
											{repository.branch ? ` on ${repository.branch}` : ""} ·{" "}
											{repository.changes.length} files
										</Text>
										{repository.pullRequest ? (
											<Text>
												{" · "}
												<Link
													href={repository.pullRequest.url}
													label={`#${repository.pullRequest.number}`}
												/>
											</Text>
										) : null}
									</Text>
								)),
							)
						: null}
					<Box flexDirection="row" gap={1} marginTop={1}>
						{!AT_REST.has(session.status) ? (
							<Button
								key="stop"
								label="Stop"
								plain
								onPress={() => act($, `${at}/stop`)}
							/>
						) : null}
						<Button
							key="compact"
							label="Compact"
							plain
							dimColor
							onPress={() => act($, `${at}/compact`)}
						/>
						<Button
							key="archive"
							label="Archive"
							plain
							dimColor
							onPress={() => act($, `${at}/archive`)}
						/>
					</Box>
				</Box>
			);
		};

		const row = (session: PaneSession) => {
			const isHere = session.id === data.attached;
			const [first, ...others] = session.viewers ?? [];
			const typing = session.typing ?? [];
			return (
				<Box key={`session-${session.id}`} flexDirection="column">
					<Box
						key={`row-${session.id}`}
						flexDirection="row"
						gap={1}
						paddingX={1}
						{...(isHere ? { backgroundColor: "userMessageBackground" } : {})}
						hover={{ backgroundColor: "userMessageBackground" }}
					>
						<Text color={MARK[session.status] ?? "inactive"}>
							{MARK[session.status] ? "●" : " "}
						</Text>
						<Box flexGrow={1}>
							<Button
								key={`s-${session.id}`}
								plain
								dimColor={!isHere}
								label={session.title}
								onPress={() => attach(session)}
							/>
						</Box>
						{typing.length > 0 ? (
							<Text dimColor italic wrap="truncate">
								{firstName(typing[0] ?? "")} types…
							</Text>
						) : first ? (
							<Text wrap="truncate">
								<Text color={first.state === "idle" ? "warning" : "success"}>
									●
								</Text>
								<Text dimColor>
									{" "}
									{firstName(first.name)}
									{others.length ? ` +${others.length}` : ""}
								</Text>
							</Text>
						) : null}
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
							<Box key={`more-row-${owner}`} paddingX={1}>
								<Button
									key={`more-${owner}`}
									plain
									dimColor
									label={`  ${list.length - listed.length} more`}
									onPress={() =>
										update($, more, (ids) => [...(ids ?? []), owner])
									}
								/>
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
				<Box paddingX={1}>
					<Text dimColor>{data.workspace}</Text>
				</Box>
				{searchBox}
				{data.channels.map((channel) => (
					<Box key={channel.id} flexDirection="column" marginTop={1}>
						<Box paddingX={1}>
							<Text dimColor>#{channel.name}</Text>
						</Box>
						{channel.sessions.length === 0 && (
							<Box paddingX={1}>
								<Text dimColor> no sessions</Text>
							</Box>
						)}
						{sessions(channel.id, channel.sessions)}
						<Box paddingX={1}>
							<Text dimColor wrap="truncate">
								{channel.connections.length === 0
									? "  no connections"
									: `  ↳ ${channel.connections.join(" · ")}`}
							</Text>
						</Box>
					</Box>
				))}
				{data.direct.length > 0 && (
					<Box flexDirection="column" marginTop={1}>
						<Box paddingX={1}>
							<Text dimColor>Direct sessions</Text>
						</Box>
						{sessions("direct", data.direct)}
					</Box>
				)}
			</Box>
		);
	});
}
