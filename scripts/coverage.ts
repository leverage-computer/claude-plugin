// How much of hooks/ the tests run. `claude plugin test` measures none, and
// the hooks run where no coverage tool sees them, so this tests a copy of
// the plugin whose hooks count what runs, and whose tests print the counts
// when each ends.

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
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reporters from "istanbul-reports";

const root = join(import.meta.dirname, "..");
const copy = mkdtempSync(join(tmpdir(), "leverage-coverage-"));

for (const dir of [".claude-plugin", "hooks", "types"])
	cpSync(join(root, dir), join(copy, dir), { recursive: true });

for (const name of readdirSync(join(root, "hooks"))) {
	if (!/\.tsx?$/.test(name)) continue;
	const filename = join(root, "hooks", name);
	// The engine reads each state value as `const x = atom(...)`, uncounted.
	const source = readFileSync(filename, "utf8").replace(
		/^(export )?const \w+ = (atom|derive|memberOf)\(/gm,
		"/* istanbul ignore next */ $&",
	);
	const out = transformSync(source, {
		filename,
		babelrc: false,
		configFile: false,
		presets: [
			[
				"@babel/preset-typescript",
				{ isTSX: name.endsWith(".tsx"), allExtensions: true },
			],
		],
		plugins: [
			[
				"istanbul",
				{
					// The hooks' environment has no Function constructor.
					coverageGlobalScope: "globalThis",
					coverageGlobalScopeFunc: false,
					useInlineSourceMaps: false,
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
	on("command.run", { command: "__coverage" }, () => ({
		text: JSON.stringify(globalThis.__coverage__),
	}));
	return plugin(on, options);
};
`,
);

// The copy's tests print the counts as each ends, in lines of 32 KB: one
// past 64 KB reaches the output cut in two.
mkdirSync(join(copy, "tests"));
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
			const id = Math.random().toString(36).slice(2);
			for (let at = 0; at < text.length; at += 32768)
				console.log("__coverage__", id, text.slice(at, at + 32768));
		}
	});
};
`,
);

// One test file at a time: files tested side by side print to one pipe,
// where their long lines interleave.
const total = libCoverage.createCoverageMap({});
for (const name of readdirSync(join(root, "tests"))) {
	const test = readFileSync(join(root, "tests", name), "utf8");
	const path = join(copy, "tests", name);
	writeFileSync(path, test.replaceAll('"claude-code/testing"', '"./kit"'));
	const run = spawnSync("claude", ["plugin", "test", copy], {
		encoding: "utf8",
		maxBuffer: 1 << 30,
	});
	rmSync(path);
	const output = `${run.stdout}\n${run.stderr}`;
	/** Each test's counts, by the id it printed them under. */
	const counts = new Map<string, string>();
	for (const [, id, part] of output.matchAll(/^__coverage__ (\S+) (.*)$/gm))
		counts.set(id, (counts.get(id) ?? "") + part);
	if (run.status !== 0 || counts.size === 0) {
		process.stdout.write(output);
		process.exit(run.status || 1);
	}
	for (const text of counts.values()) total.merge(JSON.parse(text));
}
rmSync(copy, { recursive: true, force: true });

const context = libReport.createContext({
	dir: join(root, "coverage"),
	coverageMap: total,
});
for (const reporter of ["text", "lcovonly"] as const)
	reporters.create(reporter).execute(context);
