Bicycle is something between a tool and a distro, built on top of Arch, that lets you declare your machine declaratively but use it regularly.

# outline
- `src/pollers/fs` A poller that reconciles the filesystem state against what pacman reports as known, like aconfmgr
- `src/installer` The installer web UI
- `src/daemon` The main Bicycle daemon

# rules
- Never comment code. Code with newly added comments will be rejected outright

# rules (general)
- Don't volunteer recommendations, next steps, or "what I'd do" verdicts. Answer the question asked. If the user wants a recommendation, they'll ask for one.
- Never propose follow up tasks to the user unless explicitly asked. The user always drives.
- Never leave "things to verify" When designing or exploring; you have full access to the filesystem. Proactively and thoroughly everything you can by yourself, autonomously.
- Never speculate or make assumptions about code; find specific, precise answers by looking through source code, especially for libraries you're using.
- Always verify empirically that scripts, build changes, tests, etc. work as intended. Do not give the user something you haven't verified.
- Never ask the user to trace through or verify code. Your job is to be thorough and be autonomous.
- Prefer more direct responses with less context; always include important context, but if something isn't immediately relevant to the user's request, do not put it in your response.
  - The user greatly prefers to ask follow ups rather than slog through walls of text

