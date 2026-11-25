# Remote snapshot (`--remote`)

**Status: unqualified until R4 (#84) passes.** Do not tell a user this mode works or is supported until this line says `verified`. Real AWS S3 has not been tried at all; only SeaweedFS is planned for qualification.

The HTML holds presigned GET URLs instead of the Parquet bytes. The snapshot tables live in an S3-compatible bucket (S3, SeaweedFS). Anyone with the file opens the dashboard until the links expire, from `file://` or a web server, without credentials. A refresh is a rebuild.

```sh
AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
  node scripts/featherbi.mjs build dashboard.yaml --remote s3://reports/q4 --expires 3d
```

## Flags

| Flag | Rule |
|---|---|
| `--remote s3://<bucket>/<prefix>` | Turns on remote mode. Cannot be combined with `--offline` or `--split`. All tables are remote. |
| `--expires <n>h\|<n>d` | Default `7d`; allowed `1h` to `7d` (the SigV4 maximum). |

- Bucket: 3-63 lowercase letters, digits, dots, hyphens. The prefix may be empty or nested, but not contain an empty segment (`a//b` is rejected).
- Each table is uploaded as `s3://<bucket>/<prefix>/<sha256>.parquet`, the hash of its bytes. An object that already exists is never uploaded or overwritten, so a second identical build sends no PUT.
- The build prints `remote data: N MB, downloaded by every viewer on open` and warns above 200 MB: aggregate in the source SQL. The 25 MB embedded warning does not apply.
- Before writing any HTML the build sends each URL a `Range: bytes=0-0` GET with `Origin: null`; it must return `206` with `Access-Control-Allow-Origin` of `null` or `*`. On failure nothing is written.

## Environment variables

Credentials come only from the environment, never from the config.

| Variable | Use |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Required. |
| `AWS_SESSION_TOKEN` | Optional. It is embedded in the presigned URLs in the HTML (owner decision, spec 0002 r3) and expires with them, possibly before `--expires`; the build warns. |
| `AWS_REGION` | Default `us-east-1`. |
| `AWS_ENDPOINT_URL` | For SeaweedFS and other non-AWS stores. Switches to path-style (`<endpoint>/<bucket>/…`); without it, AWS virtual-hosted style. |

The secret key never appears in the HTML, logs or errors.

## Bucket CORS rule

The page fetches the files with plain GET. From `file://` the browser sends `Origin: null`, so the rule must allow GET from any origin and expose `Content-Length` and `Content-Range`.

S3 (`aws s3api put-bucket-cors --bucket reports --cors-configuration file://cors.json`):

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["Content-Length", "Content-Range"]
    }
  ]
}
```

SeaweedFS accepts the same S3 API call; point it at the endpoint (`aws --endpoint-url http://seaweed.internal:8333 s3api put-bucket-cors …` with the JSON above). The S3 gateway may also take an allowed-origins start option (e.g. `weed s3 -allowedOrigins="*"`); that flag is unverified here, check `weed s3 -h`; R4 (#84) proves the snippets. A SeaweedFS instance may already send permissive CORS by default (seen in the #81 verification); the build's preflight tells you either way.

## Caveats

- **Bearer link.** Anyone holding the HTML can read the data until expiry. Treat the file like the data itself.
- **Session token.** With `AWS_SESSION_TOKEN` set, the token sits inside the URLs in the HTML.
- **Revocation.** Delete the objects (`s3://<bucket>/<prefix>/<sha256>.parquet`); the links then return 404. Old objects are never cleaned up for you.
- **No listing.** The bucket needs no public access; each URL grants GET on one object.
- **Not byte-identical.** Signatures and the expiry time depend on the build time.
- **Expiry.** The page shows "Data available until <time>". After expiry (viewer's clock, or any `403`) it shows "This dashboard's data link has expired. Ask the author to rebuild it." and runs no queries.
- **Opening.** Every viewer downloads all tables whole under one progress bar ("Loading data 34.0 / 120.0 MB"). A table that fails to load shows "Table “<name>” could not be loaded (HTTP <status>)…" and the other tiles keep working.
- Safari with `Origin: null` is untested.
