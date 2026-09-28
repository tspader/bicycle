Bicycle is something between a tool and a distro, built on top of Arch, that lets you declare your machine declaratively but use it regularly.

# model

A machine is declared by a tree: `bicycle.yml`, `files/`, `apps/`, `secrets/`, `recipients`, `ignore.yml`. The daemon is the only thing that reads the tree or changes the machine, and it runs as root. Everything else, the `bicycle` CLI included, asks it over HTTP.

A reconciler makes one part of the machine match the tree: `plan` says what differs as diffs and changes nothing, `all` applies. They run in `Reconcilers.ORDER`: groups before users so custom groups exist for membership, users before dirs and files so owners exist, services and apps last. A detector is an executable that reports what the tree does not declare; its findings are kept under the state directory and read back by `plan`. A kind is anything that plans: every reconciler but `app`, and every detector.

What must stay true of the reconcilers:

- files: a missing `files/` is nothing to do, never everything deleted. A plan that hit an error applies what it has and prunes nothing. `.age` is decrypted before `.tpl` is rendered, so `x.tpl.age` is an encrypted template and `x.age.tpl` is refused. Anything carrying secret material lands 0600 unless a descriptor gives a mode. A descriptor consumes the sibling it sources; a descriptor that fails consumes every candidate sibling
- users: a password is set only when the user is created, from stdin, and never when it is empty. A live user's uid is never changed
- sudoers: the drop-in is validated by `visudo` under a name sudo skips, and only then renamed into place
- app: a port is allocated once per app from 20000-20999 and kept; an app with no `http` gives its port back
- whatever the daemon writes into the tree is owned by the owner of the directory it lands in

Work is a job: `reconcile` some reconcilers, reconcile one `app`, or `scan` with some detectors. A request, a change in the tree and boot only record a job; `Jobs.tick` is the only place one starts, and what a running job reports is applied on the next tick. What changes the machine runs one job at a time, scans run beside it. The same work asked for while it is still queued is one job, and a job from the watcher waits until the tree has been quiet for `Watch.QUIET`. Everything a job's work logs is kept on the job; a job that threw or logged an error has failed.

# layout

- `src/shared`, `@bicycle/shared`: the schemas of the tree and of a diff, shared with the installer
- `src/core`, `@bicycle/core`: the reconcilers, detectors and kinds, and what they are made of. It knows nothing of HTTP, config or the environment: every function takes a `Host` or a `Paths`
  - `Host` is the machine: its `Paths`, a log, a clock, and `exec` and `spawn` for every process. `Host.real` is the only implementation
  - `Paths.of(roots)` is where everything is, given the tree, the state directory, the run directory, the root of the machine, the age key and the scanner
- `src/daemon`, `@bicycle/daemon`: the one long-running process, its config and its client. Paths below are under its `src/`
  - `index.ts` is `Daemon.run(config, vars)`, which wires the host, the queue, the watcher, the tick and both listeners, and `Daemon.once(config, vars, only)`, which reconciles with no daemon
  - `config.ts` is `Config.init(vars)`, the one loader; `Config.parse` is the pure half
  - `jobs.ts` is the queue and `Jobs.tick`; `worker.ts` does a job's work against core; `watch.ts` turns a changed file into work
  - `client.ts` is `Client(url)`, typed by the schemas the routes reply with
  - `api/` is the JSON API under `/api`, one file per kind of route; `error.ts` is what a request can be refused with, replied as `{ error, ...data }`
  - `web/` is the Datastar UI on its own listener. Its session is a value made per `Web.routes`
- `src/cli`, `@bicycle/cli`: the `bicycle` CLI, `@spader/zargs` over yargs, one file per command. `main.ts` is the bin and the only composition root: it is what `bun build --compile` turns into `/usr/bin/bicycle`, so it hands the CLI the daemon's two entry points along with the client
- `src/datastar`, `src/ui`: what the web UIs share
- `src/installer`: the installer web UI
- `src/pacman`: the Arch package
- `tools`: build scripts

# boundaries

A module is imported by its package's name and never by a relative path. A module is one file until it needs more, then a directory with an `index.ts`. What a package lets others import is the list in its `package.json` `exports`; each package names its own modules, and those of the packages it depends on, through `paths` in its `tsconfig.json`.

A failure that reaches a caller is a `Fail.Error`: a kind from a closed set and the data that kind carries. It lives with what raises it. What a reconciler cannot do it logs through the host and carries on.

Only `src/cli/src/main.ts` reads the environment. Tests pass values; no test writes `process.env`.

# config

`/etc/bicycle.json`, or the file named by `BICYCLE_CONFIG`; every key optional, an unknown key refused. The environment is on top of the file, and a blank variable is unset. The daemon and the CLI read the same file, so the CLI finds the daemon without being told.

- `etc`, `BICYCLE_ETC`: the tree, default `/etc/bicycle`
- `state`, `BICYCLE_VAR`: default `/var/lib/bicycle`
- `run`, `BICYCLE_RUN`: default `/run/bicycle`
- `root`, `BICYCLE_HOST_ROOT`: the root of the machine, default `/`
- `key`, `AGE_KEY`: the age identity, default `age.key` in the tree
- `scanner`, `BICYCLE_FS_SCANNER`: the fs detector, default `bicycle-fs-scan`
- `host` and `port`, `BICYCLE_HOST` and `BICYCLE_PORT`: where the API listens, default `127.0.0.1:7777`
- `web.host` and `web.port`, `BICYCLE_WEB_HOST` and `BICYCLE_WEB_PORT`: where the web UI listens, default `127.0.0.1:8081`
- `daemon`, `BICYCLE_DAEMON_URL`: the API base URL clients call, default `http://$host:$port`
- `level`, `LOG_LEVEL`: default `info`

The API is not authenticated, reads secrets and changes the machine as root, so it must only ever listen on loopback. The web UI is a separate listener so that an ingress route to it does not reach the API.

# commands

- `bun run typecheck`
- `bun run test`
- `bun run daemon`
- `make pkg`
- `bicycle diff [--only kind...] [--json]`
- `bicycle reconcile [--only reconciler...]`
- `bicycle scan [--only detector...] [--timeout-mins n] [--foreground]`
- `bicycle jobs [id] [-n limit]`
- `bicycle secret set|get|ls|rm`
- `bicycle daemon run|once`

# tests

Tests live in a package's `test/`, flat, next to the harness `test/testing.ts`; `src/` holds no test code. A nested source flattens with dots (`src/api/jobs.ts` is `test/api.jobs.test.ts`). Tests are tables of cases with one executor per table via `Testing.each`. An error case expects the kind.

Core's tests run the real reconcilers against a sandbox: `Testing.within` makes a tree, a root and a state directory under a temporary directory, and a `Host.real` whose `PATH` puts shims for `pacman`, `systemctl`, `docker` and `getent` first. The daemon's queue is tested by ticking it by hand with a clock that only moves when told.

# rules

- Functional core, imperative shell
- Never comment code. Code with newly added comments will be rejected outright
- Never import by a relative path
- zod schemas for anything parsed from outside the process
- Single quotes, no semicolons
- @.llm/AGENTS.md may have additional machine specific instructions
