# Excalidraw for OpenCloud

An [Excalidraw](https://excalidraw.com/) drawing application integrated as a native [OpenCloud](https://opencloud.eu/) web extension. Create, edit and collaborate on `.excalidraw` drawings directly within OpenCloud.

## Features

- Create new Excalidraw drawings from the "New" menu
- Open and edit existing `.excalidraw` files
- **Real-time collaboration** – multiple users can edit the same drawing simultaneously
- Auto-save support via OpenCloud's AppWrapperRoute
- Read-only mode for shared files
- Export drawings to various formats
- Locale-aware UI based on the user's OpenCloud language preference
- Public-link support with guest display names

## Installation

1. Download the latest release archive from the [Releases](https://github.com/opencloud-eu/web-app-excalidraw/releases) page.
2. Extract the archive into your OpenCloud web assets directory:
   ```bash
   unzip web-app-excalidraw.zip -d /var/lib/opencloud/web/assets/apps/excalidraw/
   ```
3. Restart OpenCloud to pick up the new extension.

### Fonts

Excalidraw font assets are vendored in `public/excalidraw/fonts/` and served locally at runtime. No external CDN or CSP allowances are required.

## Configuration

### Extension App Config

The extension is configured through OpenCloud's app configuration system (typically `apps.yaml`). Add a section for `excalidraw` under `web` → `config` → `apps`:

```yaml
web:
  config:
    apps:
      - excalidraw:
          collabServerEnabled: true
          collabServerUrl: ''
          autoSaveIntervalMinutes: 5
```

| Option | Type | Default | Description |
|---|---|---|---|
| `collabServerEnabled` | `boolean` | `false` | Enable real-time collaboration features. When `false`, the editor runs in single-user mode. |
| `collabServerUrl` | `string` | `""` (auto) | URL of the collaboration server. Leave empty to auto-detect using the current origin with the path `/excalidraw-collab/`. Set an explicit URL when the collab server is hosted on a different domain. |
| `autoSaveIntervalMinutes` | `number` | `5` | Interval in minutes between automatic saves (min: 1, max: 60). |

### Collaboration Server

The collab server is a standalone Node.js service that brokers real-time WebSocket connections between editors. It authenticates users via OIDC (for logged-in users) and public-link token validation (for guests).

#### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3002` | HTTP port the server listens on. |
| `PATH_PREFIX` | No | `""` | URL path prefix when running behind a reverse proxy (e.g. `/excalidraw-collab/`). |
| `CORS_ORIGIN` | **Yes** | – | Allowed CORS origin for the frontend (e.g. `https://cloud.example.com`). Set to `*` for development only. |
| `OIDC_ISSUER` | **Yes** | – | OIDC issuer URL. Typically the OpenCloud server URL (e.g. `https://cloud.example.com`). Used for JWT validation and OIDC discovery. |
| `OIDC_AUDIENCE` | No | `null` | Expected `aud` claim in JWT tokens. When not set, audience validation is skipped. |
| `OC_URL` | No | Same as `OIDC_ISSUER` | OpenCloud base URL. Used for validating public-link share tokens. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | `"1"` | Set to `"0"` to skip TLS certificate verification (development only). |

#### Redis (Optional – for Horizontal Scaling)

Without Redis the collab server uses an in-memory adapter and can only run as a single instance. To run multiple replicas, configure one of the Redis modes below:

| Variable | Description |
|---|---|
| `REDIS_URL` | Standalone Redis connection URL (e.g. `redis://localhost:6379`). |
| `REDIS_CLUSTER_NODES` | Comma-separated list of Redis Cluster nodes (`host:port,host:port`). Supports IPv6 bracket notation. |
| `REDIS_SENTINELS` | Comma-separated list of Sentinel nodes (`host:port,host:port`). |
| `REDIS_SENTINEL_MASTER_NAME` | Sentinel master name. Defaults to `mymaster`. |
| `REDIS_PASSWORD` | Redis password (used for standalone, cluster, and sentinel modes). |
| `REDIS_SENTINEL_PASSWORD` | Separate password for Sentinel authentication. |
| `REDIS_SENTINEL_TLS` | Set to `"true"` to enable TLS for Sentinel connections. |

> **Note:** Only one Redis mode can be active. The server checks for `REDIS_CLUSTER_NODES` first, then `REDIS_SENTINELS`, and finally `REDIS_URL`.

### OpenCloud Reverse Proxy

OpenCloud needs a proxy route so the browser can reach the collab server through the same origin. Add the following to your OpenCloud proxy configuration (e.g. `proxy.yaml`):

```yaml
additional_policies:
  - name: default
    routes:
      - endpoint: /excalidraw-collab/
        backend: http://excalidraw-collab:3002
        unprotected: true
```

The route must be `unprotected` because the collab server handles its own authentication via OIDC tokens and public-link validation.

### Collaboration Behavior

- **Project spaces**: Collaboration is automatically enabled for all users with access to the space.
- **Personal spaces**: Collaboration activates only when a file has been explicitly shared with other users.
- **Public links**: Guest users are prompted for a display name before joining a collaborative session. The name is stored in the browser session.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/installation) (see `packageManager` field in `package.json` for the exact version)
- Docker and Docker Compose (for local dev server)

### Setup

```bash
pnpm install
pnpm build:w
```

### Local Development Server

```bash
docker compose up
```

This starts:
- **OpenCloud** at `https://host.docker.internal:9200` (credentials: `admin` / `admin`)
- **Collab server** on port 3002 (proxied through OpenCloud at `/excalidraw-collab/`)
- **Traefik** reverse proxy with auto-generated TLS certificates

The development `docker-compose.yml` mounts `./dist` into the OpenCloud container and pre-configures `apps.yaml` and `proxy.yaml` so collaboration works out of the box.

### Build for Production

```bash
pnpm build
```

The production build is output to the `dist/` directory.

### Building Docker Images

**Extension frontend:**
```bash
docker build -t excalidraw-extension .
```

**Collab server:**
```bash
docker build -t excalidraw-collab ./collab-server
```

### Testing

```bash
# Extension unit tests
pnpm test:unit

# Collab server tests
cd collab-server && npm test
```

## License

[Apache-2.0](LICENSE)
