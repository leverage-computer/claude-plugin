import type { EngineInterface, On } from "claude-code";
import { atom, read, update } from "claude-code";

import type { PaneSession, WorkspaceTree } from "../types";
import { connect, follow, here, leverageRequest } from "./client";

// The Leverage pane: the workspace's channels, their sessions and connections.
// A press on a session moves this window to that session.

export const PANE = "leverage";
let isRefreshing = false;
const tree = atom({ plugin: "leverage", key: "tree" } as const, null);
/** The text the session titles must hold; empty lists them all. */
const search = atom({ plugin: "leverage", key: "search" } as const, "");
/** The spaces that list all their sessions, not the first few. */
const more = atom({ plugin: "leverage", key: "more" } as const, [] as string[]);
/** How many sessions a space lists before its "more" row. */
const FEW = 8;

const GLYPH: Record<string, string> = { active: "●", idle: "○", failed: "✕" };

async function call<T>(
	$: EngineInterface,
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await $.http.fetch(...leverageRequest(path, body));
	if (!res.ok) throw new Error(`Leverage answered ${res.status}`);
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
}

export function registerPane(on: On) {
	on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
		const { Box, Text, Button } = $.ui.resolve(e);
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
		const row = (session: PaneSession) => (
			<Button
				key={`s-${session.id}`}
				plain
				dimColor={session.id !== data.attached && session.status !== "active"}
				label={`${GLYPH[session.status] ?? "○"} ${session.title}${session.id === data.attached ? "  ← here" : ""}`}
				onPress={() => attach(session)}
			/>
		);

		const sessions = (owner: string, list: PaneSession[]) => {
			const shown = open.includes(owner) ? list : list.slice(0, FEW);
			return [
				...shown.map(row),
				...(list.length > shown.length
					? [
							<Button
								key={`more-${owner}`}
								plain
								dimColor
								label={`  ${list.length - shown.length} more`}
								onPress={() =>
									update($, more, (ids) => [...(ids ?? []), owner])
								}
							/>,
						]
					: []),
			];
		};
		// A phone has no text field, so it lists every session.
		const elements = $.ui.resolve(e);
		const Input = "Input" in elements ? elements.Input : null;
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
			<Box flexDirection="column">
				<Text bold>{data.workspace}</Text>
				{searchBox}
				{data.channels.map((channel) => (
					<Box key={channel.id} flexDirection="column" marginTop={1}>
						<Text bold>#{channel.name}</Text>
						{channel.sessions.length === 0 && (
							<Text dimColor> no sessions</Text>
						)}
						{sessions(channel.id, channel.sessions)}
						<Text dimColor>
							{channel.connections.length === 0
								? " no connections"
								: ` ↳ ${channel.connections.join(" · ")}`}
						</Text>
					</Box>
				))}
				{data.direct.length > 0 && (
					<Box flexDirection="column" marginTop={1}>
						<Text bold>Direct sessions</Text>
						{sessions("direct", data.direct)}
					</Box>
				)}
			</Box>
		);
	});
}
