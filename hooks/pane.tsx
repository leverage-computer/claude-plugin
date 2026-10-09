import type { EngineInterface, On } from "claude-code";
import { atom, read, update } from "claude-code";

import type { PaneSession, WorkspaceTree } from "../types";
import {
	becomeClient,
	follow,
	here,
	isClient,
	isReachable,
	LEVERAGE_TOOLS,
	leverageRequest,
} from "./client";

// The Leverage pane, drawn as Claude's session sidebar: the workspace's
// channels and their sessions. A press on a session moves this window to
// that session.

export const PANE = "leverage";
let isRefreshing = false;
const tree = atom({ plugin: "leverage", key: "tree" } as const, null);
/** The text the session titles must hold; empty lists them all. */
const search = atom({ plugin: "leverage", key: "search" } as const, "");
/** The spaces that list all their sessions, not the first few. */
const more = atom({ plugin: "leverage", key: "more" } as const, [] as string[]);
/** How many sessions a space lists before its "more" row. */
const FEW = 8;

// As in Claude's sidebar, only a session that works or waits shows a mark.
const MARK: Record<string, string> = {
	active: "claude",
	running: "claude",
	awaiting_input: "permission",
};

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
}

/** A row's fill when it is the session here, or under the pointer. */
const LIT: Record<string, string> = {
	terminal: "userMessageBackground",
	other: "promptBorderShimmer",
};
/** No color: a row's border that only rounds its fill. */
const CLEAR = "#00000000";

export function registerPane(on: On) {
	on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
		const elements = $.ui.resolve(e);
		const { Box, Text, Button } = elements;
		const isTerminal = e.surface === "terminal";
		// A phone has no text field: it lists every session.
		const Input = "Input" in elements ? elements.Input : null;
		const lit = isTerminal ? LIT.terminal : LIT.other;
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
					Connecting to Leverage… If it never does, /leverage login signs in.
				</Text>
			);
		}

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

		/** A one-column mark in a theme color, or the room for one. */
		const mark = (key: string, color: string | undefined, glyph = "●") => (
			<Box key={key} width={1} flexShrink={0}>
				{color ? <Text color={color}>{glyph}</Text> : null}
			</Box>
		);

		const row = (session: PaneSession) => {
			const isHere = session.id === data.attached;
			return (
				<Box
					key={`row-${session.id}`}
					flexDirection="row"
					alignItems="center"
					gap={1}
					paddingX={1}
					{...(isTerminal
						? {}
						: {
								minHeight: 1.5,
								borderStyle: "round",
								borderColor: CLEAR,
								paddingY: 0,
							})}
					{...(isHere ? { backgroundColor: lit } : {})}
					hover={{ backgroundColor: lit }}
				>
					{mark(`mark-${session.id}`, MARK[session.status])}
					<Box flexGrow={1} flexShrink={1} minWidth={0}>
						<Button
							key={isHere ? `here-${session.id}` : `s-${session.id}`}
							plain
							label={session.title}
							hover={{ backgroundColor: CLEAR }}
							onPress={() => (isHere ? refresh($) : attach(session))}
						/>
					</Box>
				</Box>
			);
		};

		const sessions = (owner: string, list: PaneSession[]) => {
			const listed = open.includes(owner) ? list : list.slice(0, FEW);
			return [
				...listed.map(row),
				...(list.length > listed.length
					? [
							<Box key={`more-row-${owner}`} paddingLeft={4}>
								<Button
									key={`more-${owner}`}
									label={`${list.length - listed.length} more`}
									plain
									dimColor
									onPress={() =>
										void update($, more, (ids) => [...(ids ?? []), owner])
									}
								/>
							</Box>,
						]
					: []),
			];
		};

		/** A space's name. */
		const heading = (key: string, name: string) => (
			<Box key={key} paddingX={1} marginTop={1}>
				<Text dimColor bold>
					{name}
				</Text>
			</Box>
		);

		return (
			<Box flexDirection="column">
				<Box
					flexDirection="row"
					alignItems="center"
					justifyContent="space-between"
					gap={2}
					paddingX={1}
				>
					<Text bold wrap="truncate">
						{data.workspace}
					</Text>
					{Input ? (
						<Input
							key="search"
							placeholder="Search sessions"
							value={asked}
							onSubmit={async (value: string) => {
								await update($, search, () => value.trim());
								await refresh($);
							}}
						/>
					) : null}
				</Box>
				{data.channels.map((channel) => (
					<Box key={channel.id} flexDirection="column">
						{heading(`heading-${channel.id}`, `#${channel.name}`)}
						{sessions(channel.id, channel.sessions)}
						{channel.sessions.length === 0 ? (
							<Box paddingLeft={4}>
								<Text dimColor>No sessions yet</Text>
							</Box>
						) : null}
					</Box>
				))}
				{data.direct.length > 0 && (
					<Box flexDirection="column">
						{heading("heading-direct", "Private")}
						{sessions("direct", data.direct)}
					</Box>
				)}
			</Box>
		);
	});
}
