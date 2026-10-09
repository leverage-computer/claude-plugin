/** Someone else who has the Leverage session open, and the apps they use. */
export type Viewer = { name: string; state: "active" | "idle"; apps: string[] };
/** Who else has the session open, and the names of those who type in it. */
export type Room = { viewers: Viewer[]; typing: string[] };

export type PaneSession = { id: string; title: string; status: string };
export type PaneChannel = {
	id: string;
	name: string;
	sessions: PaneSession[];
};
export type WorkspaceTree = {
	workspace: string;
	attached: string;
	channels: PaneChannel[];
	direct: PaneSession[];
};

declare module "claude-code" {
	interface PluginState {
		leverage: {
			tree: WorkspaceTree | null;
			search: string;
			more: string[];
			people: Room;
		};
	}
}
