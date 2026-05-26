Bicycle is something between a tool and a distro, built on top of Arch, that lets you declare your machine declaratively but use it regularly.

# outline
- `src/pollers/fs` A poller that reconciles the filesystem state against what pacman reports as known, like aconfmgr
- `src/installer` The installer web UI
- `src/daemon` The main Bicycle daemon

# rules
- Never comment code. Code with newly added comments will be rejected outright
