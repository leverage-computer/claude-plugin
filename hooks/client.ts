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

/** Where Leverage is, unless LEVERAGE_HOST names another. */
const PRODUCTION = "https://app.leverage.computer";

let connection: Connection | null = null;
/** Where the connection came from: `leverage claude`, `/leverage login` or the CLI's config. */
let source: "launched" | "saved" | "kept" | null = null;

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
	source = "launched";
	isClientWindow = true;
	return true;
}

/**
 * Takes the Claude Code token the Leverage CLI keeps in its config, so any
 * window, as Claude Desktop's, lists the sessions in the pane. The window
 * runs a session's turns only once the person opens one there.
 */
export function connectKept(config: string): boolean {
	const kept = keptToken(config);
	if (!kept) return false;
	connection = { ...kept, space: null };
	source = "kept";
	return true;
}

/** The Claude Code token in the Leverage CLI's config, and its host; or null. */
export function keptToken(
	config: string,
): { url: string; token: string } | null {
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
		return null;
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
		return { url: host.replace(/\/+$/, ""), token };
	}
	return null;
}

/**
 * Takes the token `/leverage login` saved in Claude Code's config. Like the
 * CLI's, it lists the sessions in the pane until the person opens one.
 */
export function connectSaved(saved: string): boolean {
	let parsed: { url?: string; token?: string };
	try {
		parsed = JSON.parse(saved);
	} catch {
		return false;
	}
	if (!parsed.url || !parsed.token) return false;
	connection = {
		url: parsed.url.replace(/\/+$/, ""),
		token: parsed.token,
		space: null,
	};
	source = "saved";
	return true;
}

const isAbsolute = (path: string) => /^(\/|[A-Za-z]:[\\/])/.test(path);

/**
 * The file `/leverage login` keeps its token in, in Claude Code's config; or
 * null with no home folder, so no token is ever read from or left in a project.
 */
export function accessPath(
	configDir: string | undefined,
	home: string | undefined,
): string | null {
	const dir = configDir || (home ? `${home}/.claude` : "");
	return isAbsolute(dir) ? `${dir}/leverage.json` : null;
}

/** The Leverage CLI's config file; or null with no home folder. */
export function cliConfigPath(
	configDir: string | undefined,
	xdg: string | undefined,
	home: string | undefined,
): string | null {
	const dir =
		configDir ||
		(xdg ? `${xdg}/leverage` : home ? `${home}/.config/leverage` : "");
	return isAbsolute(dir) ? `${dir}/config.json` : null;
}

/** The Leverage `/leverage login` signs in to: LEVERAGE_HOST's, or the app. */
export function leverageHost(named: string | undefined): string {
	const host = named?.trim();
	if (!host) return PRODUCTION;
	try {
		const url = new URL(/^[a-z]+:\/\//i.test(host) ? host : `https://${host}`);
		return /^https?:$/.test(url.protocol) ? url.origin : PRODUCTION;
	} catch {
		return PRODUCTION;
	}
}

/** Leaves Leverage: this window is Claude Code's own again. */
export function disconnect() {
	connection = null;
	source = null;
	isClientWindow = false;
	follow("", 0);
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

export function connectedBy() {
	return source;
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
