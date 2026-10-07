import type { EngineInterface, On } from "claude-code";
import { atom, read } from "claude-code";

import type { Room, Viewer } from "../types";
import { here, isClient, leverageRequest } from "./client";

// Who else is in the Leverage session, and who types there, above the prompt.
// The others see this person type, as in their own apps.

/** What the last prompt poll saw. */
const people = atom(
	{ plugin: "leverage", key: "people" } as const,
	{
		viewers: [],
		typing: [],
	} as Room,
);

/** Leverage forgets a typing signal after 5 s, so a typist sends it again sooner. */
const TYPING_MS = 3_000;

const APP: Record<string, string> = {
	"leverage/web": "web",
	"leverage/desktop": "desktop app",
	"leverage/mobile": "phone",
	"leverage/cli": "terminal",
	codex: "Codex",
	opencode: "OpenCode",
	claude: "Claude Code",
};

/** What shows after a name: " (idle, on web & Codex)". The web alone is not said. */
function about(viewer: Viewer): string {
	const apps = viewer.apps.filter((app) => Object.hasOwn(APP, app));
	const where = apps.some((app) => app !== "leverage/web")
		? `on ${apps.map((app) => APP[app]).join(" & ")}`
		: "";
	const parts = [viewer.state === "idle" ? "idle" : "", where].filter(Boolean);
	return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function typingLine(names: string[]): string {
	if (names.length === 1) return `${names[0]} is typing…`;
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are typing…`;
}

async function signal($: EngineInterface, active: boolean) {
	if (!here.id) return;
	await $.http
		.fetch(...leverageRequest(`/sessions/${here.id}/typing`, { active }))
		.catch(() => {});
}

export function registerPeople(on: On) {
	on("prompt.edit", async ($, e, next) => {
		const box = await next(e);
		if (!isClient() || !here.id) return box;
		const now = await $.clock.now();
		if (!box.text.trim()) {
			if (here.typedAt) void signal($, false);
			here.typedAt = 0;
		} else if (now - here.typedAt > TYPING_MS) {
			here.typedAt = now;
			void signal($, true);
		}
		return box;
	});

	on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
		if (!isClient() || e.props.hasSurvey) return next(e);
		const { viewers, typing } = await read($, people);
		if (viewers.length === 0 && typing.length === 0) return next(e);
		const { Box, Text } = $.ui.resolve(e);
		return (
			<Box flexDirection="column">
				{viewers.length > 0 ? (
					<Text wrap="truncate">
						{viewers.map((viewer, at) => (
							<Text key={viewer.name}>
								{at > 0 ? " · " : ""}
								<Text color={viewer.state === "idle" ? "warning" : "success"}>
									{viewer.state === "idle" ? "◐" : "●"}
								</Text>{" "}
								{viewer.name}
								<Text dimColor>{about(viewer)}</Text>
							</Text>
						))}
					</Text>
				) : null}
				{typing.length > 0 ? (
					<Text dimColor italic>
						{typingLine(typing)}
					</Text>
				) : null}
			</Box>
		);
	});
}
