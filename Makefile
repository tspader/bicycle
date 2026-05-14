CC ?= cc
CFLAGS ?= -std=c99 -Ivendor/include -Isrc -static

TOOL_DIR = build/tools

TOOLS = build
TOOL_BINARIES = $(addprefix $(TOOL_DIR)/, $(TOOLS))

tools: $(TOOL_BINARIES)

$(TOOL_DIR)/%: tools/%.c | $(TOOL_DIR)
	$(CC) $(CFLAGS) -o $@ $<

$(TOOL_DIR):
	mkdir -p $(TOOL_DIR)

clean:
	rm -rf $(TOOL_DIR)

.PHONY: tools clean

# ── arch-installer web UI ────────────────────────────────────────────
CACHE_DIR := .cache
ISO       := $(CACHE_DIR)/installer.iso

.PHONY: iso vm vm-stop vm-ssh vm-sync vm-console installer-help installer-clean

installer-help:
	@echo "make iso         - build the custom Arch live ISO"

iso: $(ISO)

$(ISO):
	tools/build-iso.sh

installer-clean:
	rm -rf $(CACHE_DIR)
