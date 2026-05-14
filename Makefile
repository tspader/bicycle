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
	rm -rf $(TOOL_DIR) build/alpm-poc

.PHONY: tools clean bicycle

# ── bicycle binary ───────────────────────────────────────────────────
# Relies on tools/build (run separately) producing:
#   build/pacman/libalpm_objlib.a, build/sqlite3.o
BICYCLE_BIN  := build/alpm-poc
BICYCLE_SRC  := src/main.c
BICYCLE_LIBS := build/pacman/libalpm_objlib.a build/sqlite3.o
BICYCLE_LDLIBS := -larchive -lacl -lexpat -lzstd -llz4 -lbz2 -lz -llzma -lssl -lcrypto
BICYCLE_CFLAGS := -O0 -g -Ivendor/include -I/usr/include

bicycle: $(BICYCLE_BIN)

$(BICYCLE_BIN): $(BICYCLE_SRC) $(BICYCLE_LIBS) | build
	$(CC) $(BICYCLE_CFLAGS) $(BICYCLE_SRC) $(BICYCLE_LIBS) -pthread -o $@ $(BICYCLE_LDLIBS)

build:
	mkdir -p build

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
