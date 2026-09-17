# featherBI

featherBI is an agent-authored dashboard shared as a portable artifact. Recipients inspect and filter local data and may replace it with compatible data without authoring the dashboard themselves.

## Language

### Dashboard and sharing

**Dashboard**: A declared set of filters, named queries, and visual components presenting a coherent view of data.

**Config**: The versioned declarative definition of a dashboard's sources, filters, queries, and layout.
_Avoid_: Generated application code.

**Author**: The person or agent defining the dashboard and preparing its distributable artifact.

**Recipient**: A person opening a shared dashboard to inspect, filter, or replace its data, rather than edit its queries or layout.

**Artifact**: The distributable dashboard, delivered as a ZIP bundle.

**ZIP bundle**: An artifact containing an HTML viewer and separate data files that the recipient extracts and explicitly selects.

**Upload mode**: The delivery mode in which the recipient selects local files for the dashboard. “Upload” does not mean transferring those files to a server.

### Authoring

**Dashboard project**: The source-controlled YAML, SQL, and optional style files from which deterministic tooling produces a dashboard artifact.
_Avoid_: Generated runtime files as authoring source.

**Dashboard draft**: The current generated preview used by an author and agent during the feedback loop; it is not the approved distributable until verification succeeds.

**Data profile**: A bounded description of source structure and data characteristics used to inform dashboard design without copying the complete dataset into agent context.

**Metric**: A named aggregation with an agreed analytical meaning and display format.
_Avoid_: Any numeric field or chart value.

**Dimension**: A named field or derived category by which metrics may be filtered or grouped.

**Renderer preset**: A coherent default presentation mode, such as standard featherBI components or Perspective-first exploration, independent of the selected visual theme.

**SQL playground**: An ephemeral recipient workspace for bounded read-only queries; its contents do not modify the dashboard project.

### Data and coherent results

**Source**: A named logical input with a declared format and column schema; its identity is independent of any particular selected file.
_Avoid_: Filename as a synonym for source identity.

**Remote source**: A source declared by a read-only `s3://` (S3-compatible) or `https://` URI rather than a local file; its identity remains the logical source ID.
_Avoid_: Treating the URI or bucket name as the source identity.

**Source delivery mode**: Whether a source ships materialized in the ZIP bundle (`packaged`) or is read live from its URI at open time (`live`).

**Authoring credential source**: Where authoring obtains remote credentials — the AWS credential chain or a gitignored `.env` created from `.env.example`; never project files or artifacts.

**Compatible data**: Input matching a source's declared format and schema, including its types and nullability rules.

**Dataset**: The combined source assignments used by a dashboard, including unchanged sources during partial replacement.

**Source generation**: One identifiable set of source inputs and their logical views, considered together for activation or retirement.

**Candidate generation**: A proposed source generation that has not yet been published as active.

**Active generation**: The source generation underlying the currently published dashboard state.

**Replacement**: An explicit change to one or more source assignments, accepted together with refreshed filter defaults and results or rejected while preserving the prior active state.
_Avoid_: Live filesystem refresh.

**Filter revision**: A coherent filter state whose results belong together; it is distinct from newer requested filters still awaiting results.

**Query**: A named authored selection of declared sources with declared filter parameters, consumed by dashboard components.

**Component**: A declared KPI, chart, heatmap, or table bound to a named query's result fields.

### AP inspection scenario

**Inspection record**: One input row in the AP scenario, not necessarily a unique device, test, or production unit.
_Avoid_: Unit, unique test.

**Selected population**: The inspection records satisfying the dashboard's active filters.

**G0003 presence**: A non-null G0003 value in an inspection record; presence does not establish code validity or a failure.
_Avoid_: Failure rate.

**Not marked as last measurement**: An inspection record whose last-measurement flag is false, excluding null flags.
_Avoid_: Retest rate.

**Station activity**: The count of inspection records attributed to a station, without a claim about utilization, performance, or downtime.
