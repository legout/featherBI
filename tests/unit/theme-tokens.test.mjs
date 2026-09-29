import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileProject } from "../../authoring/compiler.mjs";
import { validateConfig } from "../../contract/config.mjs";
import { bakeTheme, validateThemeTokens } from "../../authoring/theme-tokens.mjs";

const VALID_TOKENS = `version: 1
font: Custom Feather Sans, sans-serif
fontMono: '"Custom Mono", monospace'
radius: 10
surface: "#000028"
surface2: "#0d0d40"
text: "#e6e9f8"
textDim: "#8f96c4"
border: "#262660"
accent: "#00e6dc"
accentContrast: "#000028"
success: "#00ffb9"
warning: "#ffb35c"
danger: "#ff6b8a"
chart:
  palette: ["#00e6dc", "#00ffb9", "#009999", "#8f8ff0", "#66d9ff"]
`;

function tokensYaml(...replacements) {
	return replacements.reduce(
		(yaml, [find, replace]) => yaml.replace(find, replace),
		VALID_TOKENS,
	);
}

function invalid(yaml, ...expected) {
	assert.throws(
		() => validateThemeTokens(yaml, "theme.tokens.yaml"),
		(error) => {
			assert.match(error.message, /^theme\.tokens\.yaml:\d+:\d+: /);
			for (const fragment of expected) assert.ok(error.message.includes(fragment), `expected ${fragment} in ${error.message}`);
			return true;
		},
	);
}

async function themeProject({ yaml, tokens }) {
	const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-theme-"));
	await mkdir(path.join(dir, "queries"));
	await writeFile(
		path.join(dir, "dashboard.yaml"),
		`project: 1
title: Theme dashboard
${yaml ?? ""}
sources:
  - id: inspections
    type: json
    file: inspections.json
    schema:
      station: {type: string, nullable: false}
filters: []
relationships: []
queries:
  total:
    sql: queries/total.sql
    params: []
layout:
  - id: total
    type: kpi
    query: total
    label: Total
    field: value
    x: 1
    y: 1
    width: 12
    height: 1
`,
		"utf8",
	);
	await writeFile(
		path.join(dir, "queries", "total.sql"),
		"SELECT count(*) AS value FROM inspections\n",
		"utf8",
	);
	if (tokens !== null)
		await writeFile(path.join(dir, "theme.tokens.yaml"), tokens ?? VALID_TOKENS, "utf8");
	return path.join(dir, "dashboard.yaml");
}

test("TT-01: valid tokens normalize defaults and bake a complete theme bundle", () => {
	const tokens = validateThemeTokens(
		tokensYaml(
			["version: 1\n", ""],
			["font: Custom Feather Sans, sans-serif\n", ""],
			["fontMono: '\"Custom Mono\", monospace'\n", ""],
			["radius: 10\n", ""],
		),
		"theme.tokens.yaml",
	);
	assert.equal(tokens.version, 1);
	assert.equal(tokens.font, "Inter, ui-sans-serif, system-ui, sans-serif");
	assert.equal(tokens.fontMono, undefined);
	assert.equal(tokens.radius, 8);

	const baked = bakeTheme(tokens);
	assert.equal(baked.name, "custom");
	// Scoped CSS variables: tokens, defaults, and AG Grid mappings from one source.
	assert.match(baked.css, /:root,\n#dashboard \{/);
	assert.match(baked.css, /--fb-surface: #000028;/);
	assert.match(baked.css, /--fb-surface-2: #0d0d40;/);
	assert.match(baked.css, /--fb-radius: 8px;/);
	assert.match(baked.css, /--fb-font: Inter, ui-sans-serif, system-ui, sans-serif;/);
	assert.doesNotMatch(baked.css, /--fb-font-mono/);
	assert.match(baked.css, /--ag-background-color: #000028;/);
	assert.match(baked.css, /--ag-header-background-color: #0d0d40;/);
	assert.match(baked.css, /--ag-border-color: #262660;/);
	assert.match(baked.css, /--ag-foreground-color: #e6e9f8;/);
	// Complete ECharts theme: palette, text, axis, split lines, heatmap range.
	assert.deepEqual(baked.echarts.color, [
		"#00e6dc",
		"#00ffb9",
		"#009999",
		"#8f8ff0",
		"#66d9ff",
	]);
	assert.equal(baked.echarts.textStyle.color, "#8f96c4");
	assert.equal(baked.echarts.legend.textStyle.color, "#8f96c4");
	for (const axis of ["categoryAxis", "valueAxis"]) {
		assert.equal(baked.echarts[axis].axisLine.lineStyle.color, "#262660");
		assert.equal(baked.echarts[axis].axisLabel.color, "#8f96c4");
		assert.equal(baked.echarts[axis].splitLine.lineStyle.color, "rgba(38, 38, 96, 0.35)");
	}
	// heatMin defaults to surface2; the heat max is the palette head.
	assert.deepEqual(baked.echarts.visualMap.inRange.color, ["#0d0d40", "#00e6dc"]);

	const withMono = bakeTheme(validateThemeTokens(VALID_TOKENS, "theme.tokens.yaml"));
	assert.match(withMono.css, /--fb-font-mono: "Custom Mono", monospace;/);
	assert.match(withMono.css, /--fb-radius: 10px;/);
});

test("TT-02: unknown token keys fail naming the file and key", () => {
	invalid(tokensYaml(['danger: "#ff6b8a"', 'danger: "#ff6b8a"\nserif: Arial']), 'unknown theme token key "serif"');
	invalid(
		tokensYaml(["  palette:", "  palette:\n  heatScale: 2"]),
		'unknown theme token key "heatScale"',
	);
});

test("TT-02: invalid colors fail naming the key and value", () => {
	invalid(tokensYaml(['surface: "#000028"', 'surface: "purple"']), '"surface"', "#rgb, #rrggbb, or rgba()");
	invalid(tokensYaml(['accent: "#00e6dc"', "accent: 5"]), '"accent"', "#rgb, #rrggbb, or rgba()");
	invalid(tokensYaml(['text: "#e6e9f8"', 'text: "#00e6d"']), '"text"', "#rgb, #rrggbb, or rgba()");
	invalid(tokensYaml(['warning: "#ffb35c"', "warning: rgba(300, 0, 0, 1)"]), '"warning"', "#rgb, #rrggbb, or rgba()");
	invalid(tokensYaml(['success: "#00ffb9"', "success: rgba(0, 255, 185, 1.5)"]), '"success"', "#rgb, #rrggbb, or rgba()");
	// rgba() is accepted where the components are in range.
	const rgba = validateThemeTokens(
		tokensYaml(['surface: "#000028"', "surface: rgba(0, 0, 40, 1)"]),
		"theme.tokens.yaml",
	);
	assert.equal(rgba.surface, "rgba(0, 0, 40, 1)");
});

test("TT-02: unsafe font stacks fail naming the key", () => {
	invalid(tokensYaml(["font: Custom Feather Sans, sans-serif", "font: '@import \"evil.css\"'"]), '"font"');
	invalid(tokensYaml(["font: Custom Feather Sans, sans-serif", "font: Open Sans, url(https://evil.example/font.woff2)"]), '"font"');
	invalid(tokensYaml(["fontMono: '\"Custom Mono\", monospace'", 'fontMono: "https://evil.example/mono"']), '"fontMono"');
	invalid(tokensYaml(["fontMono: '\"Custom Mono\", monospace'", "fontMono: Font X, data:font/woff2;base64,e33d"]), '"fontMono"');
	invalid(
		tokensYaml(["font: Custom Feather Sans, sans-serif\n", "font: 'Arial; } #dashboard-status {'\n"]),
		'"font"',
	);
	invalid(tokensYaml(["font: Custom Feather Sans, sans-serif", "font: 'Arial /*'"]), '"font"');
});

test("TT-02: malformed radius and palette fail naming the key", () => {
	invalid(tokensYaml(["radius: 10", "radius: 25"]), '"radius"', "0 through 24");
	invalid(tokensYaml(["radius: 10", "radius: 2.5"]), '"radius"');
	invalid(
		tokensYaml(['  palette: ["#00e6dc", "#00ffb9", "#009999", "#8f8ff0", "#66d9ff"]', '  palette: ["#00e6dc", "#00ffb9"]']),
		'"chart.palette"',
		"3 through 8",
	);
	invalid(
		tokensYaml(['"#8f8ff0", "#66d9ff"', '"notacolor", "#66d9ff"']),
		'"chart.palette[3]"',
	);
	invalid(tokensYaml(["version: 1", "version: 2"]), '"version"', "must be 1");
	invalid(tokensYaml(['text: "#e6e9f8"\n', ""]), '"text"', "required");
});

test("themeTokens compiles a baked theme into the strict runtime config", async () => {
	const dashboard = await themeProject({ yaml: "themeTokens: theme.tokens.yaml" });
	const { config } = await compileProject(dashboard);
	assert.equal(typeof config.theme, "object");
	assert.equal(config.theme.name, "custom");
	assert.match(config.theme.css, /--fb-surface: #000028;/);
	assert.equal(config.theme.echarts.color[0], "#00e6dc");
	assert.equal(validateConfig(config).ok, true);
	// themeTokens alongside author theme.css stays allowed (TT-08 escape hatch).
	const withCss = await themeProject({
		yaml: "themeTokens: theme.tokens.yaml\nthemeCss: theme.css",
	});
	await writeFile(path.join(path.dirname(withCss), "theme.css"), "#dashboard-layout > section { background: #123456; }\n", "utf8");
	const escaped = await compileProject(withCss);
	assert.equal(typeof escaped.config.theme, "object");
	assert.equal(typeof escaped.config.themeCss, "string");
});

test("TT-04: themeTokens with a non-neutral legacy theme fails naming both fields", async () => {
	const dashboard = await themeProject({
		yaml: "theme: daisyui\nthemeTokens: theme.tokens.yaml",
	});
	await assert.rejects(compileProject(dashboard), (error) => {
		assert.match(error.message, /dashboard\.yaml:\d+:\d+: /);
		assert.ok(error.message.includes("themeTokens"), error.message);
		assert.ok(error.message.includes("theme: daisyui"), error.message);
		return true;
	});
});
