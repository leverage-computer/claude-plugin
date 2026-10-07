import type { HttpInit } from "claude-code";

// Where this window reaches Leverage, shared by the plugin's modules. Each
// module calls $.http.fetch itself: the engine follows $ only within one file.

export type Connection = {
	/** The app origin. The plugin's routes are under `/api/claude`. */
	url: string;
	/** A Claude Code token, which names the person and the workspace. */
	token: string;
	/** The space whose first prompt starts a session. */
	space: string | null;
};

let connection: Connection | null = null;

/** The session this window shows, and the last row it read. */
export const here = {
	id: "",
	cursor: 0,
	turnId: null as string | null,
	/** A turn stopped here. Its remaining rows are not drawn. */
	skip: null as string | null,
	/** Approvals this window already asked, so none is asked twice. */
	known: new Set<string>(),
	/** The question this person answers in Claude Code's own dialog. */
	question: null as string | null,
	/** The tool calls the remote turn made. Any other call runs here. */
	calls: new Set<string>(),
	/** The last row the prompt and notice poll read. */
	polled: 0,
	/** A skill the next prompt sent from this window loads. */
	skill: null as string | null,
	/** When this person last told Leverage they type; 0 when they do not. */
	typedAt: 0,
	/** Each Leverage subagent and the last row of it drawn, by its Agent call. */
	agents: new Map<string, Subagent>(),
	/** The same subagents, by the Claude Code agent that runs each. */
	loops: new Map<string, Subagent>(),
};

/** A Leverage subagent that Claude Code runs as its own agent. */
export type Subagent = { task: string; cursor: number };

/** The prompts this window sent or already drew. */
export const drawn = new Set<string>();

/** Whether this window runs a Leverage session's turns, not only the pane. */
let isClientWindow = false;

/**
 * Takes the connection `leverage claude` starts Claude Code with. Such a
 * window runs a session's turns at once.
 */
export function connectLaunched(env: {
	url: string | undefined;
	token: string | undefined;
	space: string | undefined;
	session: string | undefined;
}): boolean {
	if (!env.url || !env.token) return false;
	connection = {
		url: env.url.replace(/\/+$/, ""),
		token: env.token,
		space: env.space || null,
	};
	if (env.session) here.id = env.session;
	isClientWindow = true;
	return true;
}

/**
 * Takes the Claude Code token the Leverage CLI keeps in its config, so any
 * window, as Claude Desktop's, lists the sessions in the pane. The window
 * runs a session's turns only once the person opens one there.
 */
export function connectKept(config: string): boolean {
	let parsed: {
		currentHost?: string;
		hosts?: Record<
			string,
			{
				workspaceId?: string;
				accessTokens?: Record<string, Record<string, string>>;
			}
		>;
	};
	try {
		parsed = JSON.parse(config);
	} catch {
		return false;
	}
	const hosts = parsed.hosts ?? {};
	// The signed-in host first, then any other that keeps one.
	for (const host of [parsed.currentHost, ...Object.keys(hosts)]) {
		if (!host) continue;
		const profile = hosts[host];
		const token = profile?.workspaceId
			? profile.accessTokens?.claude?.[profile.workspaceId]
			: undefined;
		if (!token) continue;
		connection = { url: host.replace(/\/+$/, ""), token, space: null };
		return true;
	}
	return false;
}

/** From now on, this window runs the turns of the session it follows. */
export function becomeClient() {
	isClientWindow = true;
}

// Remote tools drawn as tools of this mod. Others go to `remote_tool`.
export const MIRRORED = [
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

/** The tools a window that runs Leverage's turns registers, as registered. */
export const LEVERAGE_TOOLS = [...MIRRORED, "remote_tool"].map((name) => ({
	name,
	description: `${name}, run by the Leverage session.`,
	inputSchema: { type: "object" as const, additionalProperties: true },
}));

/** Whether the pane and /leverage can reach Leverage. */
export function isReachable(): boolean {
	return connection !== null;
}

/** Whether this window runs a Leverage session's turns. */
export function isClient(): boolean {
	return connection !== null && isClientWindow;
}

export function space(): string | null {
	return connection?.space ?? null;
}

/** Moves this window to a session. Later steps read after `cursor`. */
export function follow(id: string, cursor: number) {
	here.id = id;
	here.cursor = cursor;
	here.polled = cursor;
	here.turnId = null;
	here.skip = null;
	here.known.clear();
	here.question = null;
	here.typedAt = 0;
	here.agents.clear();
	here.loops.clear();
}

export function leverageRequest(
	path: string,
	body?: unknown,
): [string, HttpInit] {
	if (!connection) throw new Error("This window is not connected to Leverage.");
	return [
		`${connection.url}/api/claude${path}`,
		{
			method: body === undefined ? "GET" : "POST",
			headers: {
				authorization: `Bearer ${connection.token}`,
				"content-type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		},
	];
}
