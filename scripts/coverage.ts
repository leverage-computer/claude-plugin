// How much of hooks/ the tests run. `claude plugin test` measures none, and
// the hooks run where no coverage tool sees them, so this tests a copy of
// the plugin whose hooks count what runs, and whose tests read the counts
// back through a command when each ends.

import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSync } from "@babel/core";
import libCoverage, { type FileCoverageData } from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reporters from "istanbul-reports";

type Counts = Record<string, Pick<FileCoverageData, "s" | "f" | "b">>;

const root = join(import.meta.dirname, "..");
const copy = mkdtempSync(join(tmpdir(), "leverage-coverage-"));
const MARK = "__coverage__ ";
/** What makes a state value, which the engine reads in the source. */
const STATE = new Set(["atom", "derive", "memberOf"]);

/** Each hooks file, as it was before any test ran. */
const files: Record<string, FileCoverageData> = {};

mkdirSync(join(copy, ".claude-plugin"));
cpSync(
	join(root, ".claude-plugin/plugin.json"),
	join(copy, ".claude-plugin/plugin.json"),
);
cpSync(join(root, "types"), join(copy, "types"), { recursive: true });
mkdirSync(join(copy, "hooks"));
for (const name of readdirSync(join(root, "hooks"))) {
	const source = join(root, "hooks", name);
	if (!/\.tsx?$/.test(name)) continue;
	const out = transformSync(readFileSync(source, "utf8"), {
		filename: source,
		cwd: root,
		babelrc: false,
		configFile: false,
		presets: [
			[
				"@babel/preset-typescript",
				{ isTSX: name.endsWith(".tsx"), allExtensions: true },
			],
		],
		plugins: [
			// The engine finds each state atom as `const x = atom(...)`.
			() => ({
				visitor: {
					Program(program) {
						program.traverse({
							VariableDeclaration(path) {
								const init = path.node.declarations[0]?.init;
								if (
									init?.type === "CallExpression" &&
									init.callee.type === "Identifier" &&
									STATE.has(init.callee.name)
								)
									path.addComment("leading", " istanbul ignore next ");
							},
						});
					},
				},
			}),
			[
				"istanbul",
				{
					// The hooks' environment has no Function constructor.
					coverageGlobalScope: "globalThis",
					coverageGlobalScopeFunc: false,
					useInlineSourceMaps: false,
					onCover: (path: string, data: FileCoverageData) => {
						files[path] = data;
					},
				},
			],
		],
	});
	writeFileSync(join(copy, "hooks", name), out?.code ?? "");
}
// The copy's hooks hand a test the counts when it asks.
writeFileSync(
	join(copy, "hooks/hooks.json"),
	JSON.stringify({ modules: ["./coverage.ts"] }),
);
writeFileSync(
	join(copy, "hooks/coverage.ts"),
	`import { register as plugin } from "./register";
export const register = (on, options) => {
	on("command.run", { command: "__coverage" }, () => {
		const all = globalThis.__coverage__ ?? {};
		const counts = {};
		for (const [path, { s, f, b }] of Object.entries(all)) counts[path] = { s, f, b };
		return { text: JSON.stringify(counts) };
	});
	return plugin(on, options);
};
`,
);
// The copy's tests print the counts as each ends.
mkdirSync(join(copy, "tests"));
for (const name of readdirSync(join(root, "tests"))) {
	const test = readFileSync(join(root, "tests", name), "utf8");
	writeFileSync(
		join(copy, "tests", name),
		test.replaceAll('"claude-code/testing"', '"./kit"'),
	);
}
writeFileSync(
	join(copy, "tests/kit.ts"),
	`import { test as kitTest } from "claude-code/testing";
export * from "claude-code/testing";
export const test = (name, ...rest) => {
	const body = rest.pop();
	return kitTest(name, ...rest, async ($, on) => {
		try {
			await body($, on);
		} finally {
			const { text } = await $.command.run({ command: "__coverage", args: "" });
			console.log(${JSON.stringify(MARK)} + text);
		}
	});
};
`,
);

const run = spawnSync("claude", ["plugin", "test", copy], {
	encoding: "utf8",
	maxBuffer: 1 << 30,
});
rmSync(copy, { recursive: true, force: true });
const output = `${run.stdout}\n${run.stderr}`;
if (run.status !== 0) {
	process.stdout.write(output);
	process.exit(run.status ?? 1);
}

const total = libCoverage.createCoverageMap({});
for (const file of Object.values(files)) total.addFileCoverage(file);
const reports = output.split("\n").filter((line) => line.startsWith(MARK));
if (reports.length === 0) {
	process.stdout.write(output);
	throw new Error("no test reported what it ran");
}
for (const line of reports) {
	const counts = JSON.parse(line.slice(MARK.length)) as Counts;
	for (const [path, count] of Object.entries(counts)) {
		const file = files[path];
		if (file) total.merge({ [path]: { ...file, ...count } });
	}
}

const context = libReport.createContext({
	dir: join(root, "coverage"),
	coverageMap: total,
});
for (const reporter of ["text", "lcovonly"] as const)
	reporters.create(reporter).execute(context);
