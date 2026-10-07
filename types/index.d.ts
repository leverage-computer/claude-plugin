/** Someone else who has the Leverage session open, and the apps they use. */
export type Viewer = { name: string; state: "active" | "idle"; apps: string[] };
/** Who else has the session open, and the names of those who type in it. */
export type Room = { viewers: Viewer[]; typing: string[] };

export type PaneSession = { id: string; title: string; status: string } & Room;
export type PaneChannel = {
	id: string;
	name: string;
	sessions: PaneSession[];
	connections: string[];
};
export type WorkspaceTree = {
	workspace: string;
	attached: string;
	channels: PaneChannel[];
	direct: PaneSession[];
};

export type Model = { id: string; label: string; efforts: string[] };
/** A call that waits on a person's approval. */
export type Approval = { id: string; tool: string; input: unknown };
/** A prompt that waits for the running turn to end. */
export type Queued = { uuid: string; text: string };
/** A subagent the last turn started. */
export type PanelAgent = {
	task: string;
	description: string;
	type: string | null;
	running: boolean;
	status: string | null;
};
/** A repository the session changed, and its pull request. */
export type Repository = {
	name: string;
	branch: string | null;
	changes: { path: string }[];
	pullRequest: { number: number; url: string } | null;
};

/** What the pane shows under the session this window shows. */
export type SessionPanel = {
	session: string;
	model: string | null;
	effort: string | null;
	models: Model[];
	approvals: Approval[];
	/** Whether this person may answer what waits. */
	writable: boolean;
	/** A question waits, which Claude Code's own dialog asks. */
	question: boolean;
	queue: Queued[];
	agents: PanelAgent[];
	outputs: string[];
	changes: Repository[];
};

declare module "claude-code" {
	interface PluginState {
		leverage: {
			tree: WorkspaceTree | null;
			search: string;
			more: string[];
			people: Room;
			panel: SessionPanel | null;
		};
	}
}
