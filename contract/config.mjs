/**
 * featherBI runtime config validator (strict contract v2).
 *
 * Public API:
 *   validateConfig(input) -> {ok: true, value: input}
 *                          | {ok: false, issues: [{path, code, message}]}
 *   looksLikeCredentialMaterial(value) -> boolean
 *
 * looksLikeCredentialMaterial is the one shared secret-looking
 * URI/query-parameter detection used by this validator, the authoring
 * compiler, and the packager preflight.
 *
 * Structural validation uses the build-time generated Ajv 8 standalone
 * validator; no schema compilation happens at runtime. Runtime contract v1
 * is removed: only `contract: 2` documents are accepted.
 * On top of the schema this module enforces the cross-field rules a JSON
 * Schema alone cannot express:
 *   - reserved and empty file/schema names,
 *   - case-insensitive column-name uniqueness,
 *   - filter/source/column reference resolution and kind/type combinations,
 *     including calendar-valid date and timezone-naive timestamp defaults,
 *   - the filter-to-parameter namespace (<id>, <id>_from, <id>_to) with
 *     collision detection and query parameter admission,
 *   - component query references, table query exclusivity, annotation
 *     dates, and 12-column grid bounds without overlap.
 *
 * validateConfig never mutates its input and never throws for an invalid
 * config; only genuine runtime defects raise exceptions. Dictionaries are
 * Map-based so prototype-like column names ("__proto__", "constructor") are
 * treated as ordinary own-property names and never pollute prototypes.
 *
 * SQL placeholder discovery is intentionally NOT performed here; the query
 * engine owns statement-level admission in a later plan.
 */

import validateV2 from "../.generated/validate-config-v2.mjs";

const SECRET_PARAMETER = /(?:^|[^a-z])(?:x[-_]?amz[-_]?(?:credential|signature|security[-_]?token)|access[-_]?key|secret(?:[-_]?access[-_]?key)?|session[-_]?token|credential|password|private[-_]?key)(?:$|[^a-z])/i;

/**
 * True when a value carries secret-looking credential material (AWS SigV4
 * query parameters, access keys, passwords, and friends). Callers pass the
 * component already in scope: the query/fragment portion of a remote URI
 * (everything after the first `?` or `#`) for URI admission, or the whole
 * string for endpoints, so each admission boundary keeps its existing
 * explicit userinfo check, scan scope, and diagnostics.
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeCredentialMaterial(value) {
  return SECRET_PARAMETER.test(value);
}

/** @typedef {{path: string, code: string, message: string}} ConfigIssue */

/**
 * Selectable result fields a component family can supply from one
 * clicked plotted mark. Gauge has none; scalar marks are not selections.
 * Shared by the runtime validator, the authoring compiler, and the viewer
 * path that resolves mark clicks, so every layer agrees on one field set.
 * Perspective supplies its grouped and split fields; aggregated columns and
 * other Perspective fields are not mark selections.
 * @param {object} component
 * @returns {string[]}
 */
export function selectableFields(component) {
  if (component.type === "perspective")
    return [
      ...(component.perspective?.groupBy ?? []),
      ...(component.perspective?.splitBy ?? []),
    ];
  if (["pie", "donut", "treemap"].includes(component.type))
    return [component.name].filter(Boolean);
  if (component.type === "sankey")
    return [component.source, component.target].filter(Boolean);
  if (component.type === "heatmap")
    return [component.xField ?? component.x, component.yField ?? component.y].filter(Boolean);
  if (component.type === "boxplot") return [component.xField].filter(Boolean);
  if (["bar", "line", "area", "scatter"].includes(component.type))
    return [
      component.xField ?? component.x,
      ...(component.series ? [component.series] : []),
    ].filter(Boolean);
  return [];
}

/**
 * The primary emitted field an `interactionDimension` applies to.
 * @param {object} component
 * @returns {string | undefined}
 */
export function componentInteractionField(component) {
  if (["pie", "donut", "treemap"].includes(component.type))
    return component.name;
  if (component.type === "sankey") return component.source;
  return component.xField ?? component.x;
}

/**
 * Validate a runtime config document.
 * @param {unknown} input
 * @returns {{ok: true, value: object} | {ok: false, issues: ConfigIssue[]}}
 */
export function validateConfig(input) {
  const issues = [];
  if (!validateV2(input)) {
    for (const error of validateV2.errors ?? []) {
      issues.push(toStructuralIssue(error));
    }
    if (issues.length > 0) {
      return { ok: false, issues };
    }
  }
  collectSemanticIssues(/** @type {object} */ (input), issues);
  return issues.length === 0
    ? { ok: true, value: input }
    : { ok: false, issues };
}

/** @param {{instancePath?: string, keyword?: string, params?: object, message?: string}} error */
function toStructuralIssue(error) {
  return {
    path: pointerToPath(error.instancePath ?? ""),
    code: `schema.${error.keyword}`,
    message: structuralMessage(error),
  };
}

/** Convert a JSON Pointer such as "/data/sources/0/file" into "data.sources[0].file". */
function pointerToPath(pointer) {
  if (pointer === "") {
    return "";
  }
  let out = "";
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      out += out === "" ? segment : `.${segment}`;
    } else if (/^\d+$/.test(segment)) {
      out += `[${segment}]`;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  return out;
}

/** @param {{keyword?: string, params?: object, message?: string}} error */
function structuralMessage(error) {
  const params = /** @type {Record<string, unknown>} */ (error.params ?? {});
  switch (error.keyword) {
    case "type":
      return `must be ${params.type}`;
    case "required":
      return `must have required property ${JSON.stringify(params.missingProperty)}`;
    case "additionalProperties":
      return `must not have additional property ${JSON.stringify(params.additionalProperty)}`;
    case "enum":
      return `must be one of: ${(params.allowedValues ?? [])
        .map((value) => JSON.stringify(value))
        .join(", ")}`;
    case "const":
      return `must be ${JSON.stringify(params.allowedValue)}`;
    case "pattern":
      return `must match pattern ${params.pattern}`;
    case "minLength":
      return `must be at least ${params.limit} character(s) long`;
    case "minimum":
      return `must be >= ${params.limit}`;
    case "maximum":
      return `must be <= ${params.limit}`;
    case "minItems":
      return `must have at least ${params.limit} item(s)`;
    case "minProperties":
      return `must have at least ${params.limit} propert(y/ies)`;
    case "propertyNames": {
      const name =
        params.propertyName === undefined
          ? ""
          : ` ${JSON.stringify(params.propertyName)}`;
      return `property name${name} is invalid`;
    }
    default:
      return error.message ?? "is invalid";
  }
}

/**
 * Cross-field checks on a structurally valid config document.
 * @param {object} config
 * @param {ConfigIssue[]} issues
 */
function collectSemanticIssues(config, issues) {
  const issue = (path, code, message) => issues.push({ path, code, message });

  const sources = new Map();
  for (const [index, source] of config.data.sources.entries()) {
    const basePath = `data.sources[${index}]`;
    if (sources.has(source.id)) {
      issue(
        `${basePath}.id`,
        "source.duplicate-id",
        `duplicate source id ${JSON.stringify(source.id)}`,
      );
    } else {
      sources.set(source.id, source);
    }
    if (source.file === "." || source.file === "..") {
      issue(
        `${basePath}.file`,
        "file.reserved",
        `file must not be "." or ".."`,
      );
    }
    if (Object.hasOwn(source, "content")) {
      issue(
        `${basePath}.content`,
        "source.content-not-allowed",
        "sources cannot contain content",
      );
    }
    if (source.remote) {
      const query = source.remote.uri.match(/[?#](.*)$/)?.[1] ?? "";
      if (
        /^[a-z][a-z0-9+.-]*:\/\/[^/@]*@/i.test(source.remote.uri) ||
        looksLikeCredentialMaterial(query)
      ) {
        issue(
          `${basePath}.remote.uri`,
          "remote.credentials-in-uri",
          "remote uri must not contain credentials or secret-looking query parameters",
        );
      }
      if (
        source.remote.endpoint &&
        (/^[a-z][a-z0-9+.-]*:\/\/[^/@]*@/i.test(source.remote.endpoint) ||
          looksLikeCredentialMaterial(source.remote.endpoint))
      ) {
        issue(
          `${basePath}.remote.endpoint`,
          "remote.credentials-in-endpoint",
          "remote endpoint must not contain credentials or secret-looking values",
        );
      }
    }
    const lowerToOriginal = new Map();
    for (const name of Object.keys(source.schema)) {
      if (name === "") {
        issue(
          `${basePath}.schema`,
          "column.empty-name",
          "source schema column name must not be empty",
        );
        continue;
      }
      const lower = name.toLowerCase();
      const original = lowerToOriginal.get(lower);
      if (original === undefined) {
        lowerToOriginal.set(lower, name);
      } else {
        issue(
          `${basePath}.schema`,
          "column.duplicate-case-insensitive",
          `columns ${JSON.stringify(original)} and ${JSON.stringify(name)} differ only by case`,
        );
      }
    }
  }

  const columnsBySource = new Map();
  for (const [id, source] of sources) {
    const columns = new Map();
    for (const name of Object.keys(source.schema)) {
      columns.set(name, source.schema[name]);
    }
    columnsBySource.set(id, columns);
  }

  const filterIds = new Set();
  for (const [index, filter] of config.filters.entries()) {
    if (filterIds.has(filter.id)) {
      issue(
        `filters[${index}].id`,
        "filter.duplicate-id",
        `duplicate filter id ${JSON.stringify(filter.id)}`,
      );
    } else {
      filterIds.add(filter.id);
    }
  }

  // Filter outputs define the query parameter namespace:
  // Scalar filters emit <id>; range filters emit <id>_from/<id>_to.
  const parameterOwner = new Map();
  for (const [index, filter] of config.filters.entries()) {
    const outputs =
      filter.kind === "date-range" || filter.kind === "numeric-range"
        ? [`${filter.id}_from`, `${filter.id}_to`]
        : [filter.id];
    for (const name of outputs) {
      const owner = parameterOwner.get(name);
      if (owner === undefined) {
        parameterOwner.set(name, filter.id);
      } else {
        issue(
          `filters[${index}].id`,
          "parameter.collision",
          `filter output parameter ${JSON.stringify(name)} collides with filter ${JSON.stringify(owner)}`,
        );
      }
    }
  }

  for (const [index, filter] of config.filters.entries()) {
    const basePath = `filters[${index}]`;
    const source = sources.get(filter.source);
    if (source === undefined) {
      issue(
        `${basePath}.source`,
        "source.unknown-id",
        `filter references unknown source ${JSON.stringify(filter.source)}`,
      );
    }
    const column =
      source === undefined
        ? undefined
        : columnsBySource.get(filter.source).get(filter.column);
    if (source !== undefined && column === undefined) {
      issue(
        `${basePath}.column`,
        "column.unknown",
        `filter references unknown column ${JSON.stringify(filter.column)} in source ${JSON.stringify(filter.source)}`,
      );
    }
    if (
      column !== undefined &&
      filter.kind === "text" &&
      column.type !== "string"
    ) {
      issue(
        basePath,
        "filter.column-type",
        `text filter requires a string column, found ${JSON.stringify(column.type)}`,
      );
    }
    if (
      column !== undefined &&
      filter.kind === "date-range" &&
      column.type !== "date" &&
      column.type !== "timestamp"
    ) {
      issue(
        basePath,
        "filter.column-type",
        `date-range filter requires a date or timestamp column, found ${JSON.stringify(column.type)}`,
      );
    }
    if (
      column !== undefined &&
      filter.kind === "numeric-range" &&
      !["integer", "number"].includes(column.type)
    ) {
      issue(
        basePath,
        "filter.column-type",
        `numeric-range filter requires an integer or number column, found ${JSON.stringify(column.type)}`,
      );
    }
    if (
      column !== undefined &&
      filter.kind === "boolean" &&
      column.type !== "boolean"
    ) {
      issue(
        basePath,
        "filter.column-type",
        `boolean filter requires a boolean column, found ${JSON.stringify(column.type)}`,
      );
    }
    validateFilterDefault(filter, column, basePath, issue);
  }

  for (const [queryId, query] of Object.entries(config.queries)) {
    const seen = new Set();
    for (const [index, param] of query.params.entries()) {
      if (!parameterOwner.has(param)) {
        issue(
          `queries.${queryId}.params[${index}]`,
          "parameter.unknown",
          `query ${JSON.stringify(queryId)} declares unknown parameter ${JSON.stringify(param)}`,
        );
      }
      if (seen.has(param)) {
        issue(
          `queries.${queryId}.params[${index}]`,
          "parameter.duplicate",
          `query ${JSON.stringify(queryId)} declares parameter ${JSON.stringify(param)} more than once`,
        );
      } else {
        seen.add(param);
      }
    }
  }

  const declaredComponentIds = new Set(config.layout.map(({ id }) => id));
  const alternatives = new Map();
  for (const [index, container] of config.layout.entries()) {
    for (const tab of container.tabs ?? []) {
      for (const componentId of tab.components ?? []) {
        if (!declaredComponentIds.has(componentId))
          issue(
            `layout[${index}].tabs`,
            "component.unknown-id",
            `tab references unknown component ${JSON.stringify(componentId)}`,
          );
        if (alternatives.has(componentId))
          issue(
            `layout[${index}].tabs`,
            "component.multiple-tabs",
            `component ${JSON.stringify(componentId)} belongs to more than one tab`,
          );
        alternatives.set(componentId, { owner: container.id, tab: tab.id });
      }
    }
  }
  const componentIds = new Set();
  for (const [index, component] of config.layout.entries()) {
    if (componentIds.has(component.id)) {
      issue(
        `layout[${index}].id`,
        "component.duplicate-id",
        `duplicate component id ${JSON.stringify(component.id)}`,
      );
    } else {
      componentIds.add(component.id);
    }
    if (component.x + component.width - 1 > 12) {
      issue(
        `layout[${index}].width`,
        "layout.out-of-bounds",
        "placement exceeds the 12-column grid",
      );
    }
    if (component.selectionDimensions) {
      const fields = selectableFields(component);
      const primary = componentInteractionField(component);
      for (const [field, dimensionId] of Object.entries(
        component.selectionDimensions,
      )) {
        const at = `layout[${index}].selectionDimensions.${field}`;
        if (!fields.includes(field)) {
          issue(
            at,
            "component.selection-field",
            `field ${JSON.stringify(field)} is not a selectable field of ${component.type} component ${JSON.stringify(component.id)}`,
          );
        }
        if (
          field === primary &&
          component.interactionDimension &&
          component.interactionDimension !== dimensionId
        ) {
          issue(
            at,
            "component.selection-conflict",
            `field ${JSON.stringify(field)} is already bound to interactionDimension ${JSON.stringify(component.interactionDimension)}`,
          );
        }
      }
    }
    for (let earlier = 0; earlier < index; earlier += 1) {
      const other = config.layout[earlier];
      const currentAlternative = alternatives.get(component.id);
      const priorAlternative = alternatives.get(other.id);
      const ownedAlternatives =
        currentAlternative &&
        priorAlternative &&
        currentAlternative.owner === priorAlternative.owner &&
        currentAlternative.tab !== priorAlternative.tab;
      if (
        !ownedAlternatives &&
        component.x < other.x + other.width &&
        other.x < component.x + component.width &&
        component.y < other.y + other.height &&
        other.y < component.y + component.height
      ) {
        issue(
          `layout[${index}]`,
          "layout.overlap",
          `placement overlaps component ${JSON.stringify(other.id)}`,
        );
      }
    }
  }

    // Owner-approved clarification: each table has an exclusive query ID.
  const tableQueryOwner = new Map();
  for (const component of config.layout) {
    if (
      component.type === "table" &&
      Object.hasOwn(config.queries, component.query) &&
      !tableQueryOwner.has(component.query)
    ) {
      tableQueryOwner.set(component.query, component.id);
    }
  }
  for (const [index, component] of config.layout.entries()) {
    if (!component.query) continue;
    if (!Object.hasOwn(config.queries, component.query)) {
      issue(
        `layout[${index}].query`,
        "query.unknown-id",
        `component references unknown query ${JSON.stringify(component.query)}`,
      );
      continue;
    }
    const owner = tableQueryOwner.get(component.query);
    if (owner !== undefined && owner !== component.id) {
      issue(
        `layout[${index}].query`,
        "query.table-exclusive",
        `query ${JSON.stringify(component.query)} is exclusively bound to table component ${JSON.stringify(owner)}`,
      );
    }
  }

  for (const [index, component] of config.layout.entries()) {
    if (component.type !== "bar" && component.type !== "line") {
      continue;
    }
    for (const [k, annotation] of (component.annotations ?? []).entries()) {
      if (!isValidCalendarDate(annotation.at)) {
        issue(
          `layout[${index}].annotations[${k}].at`,
          "date.invalid",
          `annotation date must be a valid YYYY-MM-DD calendar date, found ${JSON.stringify(annotation.at)}`,
        );
      }
    }
  }
}

/**
 * @param {object} filter structurally valid filter
 * @param {{type: string, nullable: boolean} | undefined} column
 * @param {string} basePath
 * @param {(path: string, code: string, message: string) => void} issue
 */
function validateFilterDefault(filter, column, basePath, issue) {
  const value = filter.default;
  const defaultPath = `${basePath}.default`;

  if (filter.kind === "date-range" || filter.kind === "numeric-range") {
    if (!isPlainObject(value)) {
      issue(
        defaultPath,
        "filter.default-type",
        "date-range default must be an object with kind 'latest-days' or 'fixed'",
      );
      return;
    }
    const keys = new Set(Object.keys(value));
    if (filter.kind === "date-range" && value.kind === "latest-days") {
      if (keys.size !== 2 || !keys.has("days")) {
        issue(
          defaultPath,
          "filter.default-type",
          "latest-days default must have exactly {kind, days}",
        );
        return;
      }
      if (!Number.isSafeInteger(value.days) || value.days < 1) {
        issue(
          `${defaultPath}.days`,
          "filter.default-type",
          "latest-days days must be a positive safe integer",
        );
      }
      return;
    }
    if (value.kind === "fixed") {
      if (keys.size !== 3 || !keys.has("from") || !keys.has("through")) {
        issue(
          defaultPath,
          "filter.default-type",
          "fixed default must have exactly {kind, from, through}",
        );
        return;
      }
      let valid = true;
      for (const key of ["from", "through"]) {
        const validValue =
          filter.kind === "numeric-range"
            ? typeof value[key] === "number" && Number.isFinite(value[key])
            : typeof value[key] === "string" && isValidCalendarDate(value[key]);
        if (!validValue) {
          issue(
            `${defaultPath}.${key}`,
            "date.invalid",
            `fixed range ${key} must be a valid ${filter.kind === "numeric-range" ? "number" : "YYYY-MM-DD calendar date"}`,
          );
          valid = false;
        }
      }
      if (valid && value.from > value.through) {
        issue(
          defaultPath,
          "date.reversed",
          "fixed range from must not be after through",
        );
      }
      return;
    }
    issue(
      defaultPath,
      "filter.default-type",
      `unsupported date-range default kind ${JSON.stringify(value.kind)}`,
    );
    return;
  }

  if (value === null) {
    return;
  }
  if (filter.kind === "multi-select") {
    if (!Array.isArray(value))
      issue(
        defaultPath,
        "filter.default-type",
        "multi-select default must be an array or null",
      );
    return;
  }
  if (filter.kind === "boolean") {
    if (typeof value !== "boolean")
      issue(
        defaultPath,
        "filter.default-type",
        "boolean filter default must be a boolean or null",
      );
    return;
  }
  if (filter.kind === "text") {
    if (typeof value !== "string") {
      issue(
        defaultPath,
        "filter.default-type",
        "text filter default must be a string or null",
      );
    }
    return;
  }
  if (column === undefined) {
    return;
  }
  switch (column.type) {
    case "string":
      if (typeof value !== "string") {
        issue(
          defaultPath,
          "filter.default-type",
          "select default for a string column must be a string or null",
        );
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        issue(
          defaultPath,
          "filter.default-type",
          "select default for a boolean column must be a boolean or null",
        );
      }
      break;
    case "integer":
      if (!Number.isSafeInteger(value)) {
        issue(
          defaultPath,
          "filter.default-type",
          "select default for an integer column must be a safe integer or null",
        );
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issue(
          defaultPath,
          "filter.default-type",
          "select default for a number column must be a finite number or null",
        );
      }
      break;
    case "date":
      if (typeof value !== "string" || !isValidCalendarDate(value)) {
        issue(
          defaultPath,
          "date.invalid",
          "select default for a date column must be a valid YYYY-MM-DD calendar date or null",
        );
      }
      break;
    case "timestamp":
      if (typeof value !== "string" || !isValidNaiveTimestamp(value)) {
        issue(
          defaultPath,
          "date.invalid",
          "select default for a timestamp column must be a timezone-naive ISO timestamp or null",
        );
      }
      break;
  }
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidCalendarDate(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= daysInMonth(year, month);
}

function daysInMonth(year, month) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Timezone-naive ISO date/time ("T" or space separator, optional 1–9 fraction
 * digits). Offset-bearing values are rejected, not silently shifted.
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidNaiveTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(
      value,
    );
  if (match === null) {
    return false;
  }
  const [, year, month, day, hour, minute, second] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return false;
  }
  return isValidCalendarDate(`${year}-${month}-${day}`);
}
