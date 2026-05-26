CC ?= cc
CFLAGS ?= -std=c99 -Ivendor/include -Isrc -static

TOOL_DIR = build/tools

TOOLS = build
TOOL_BINARIES = $(addprefix $(TOOL_DIR)/, $(TOOLS))

.PHONY: all
all: bicycle

tools: $(TOOL_BINARIES)

$(TOOL_DIR)/%: tools/%.c | $(TOOL_DIR)
	$(CC) $(CFLAGS) -o $@ $<

$(TOOL_DIR):
	mkdir -p $(TOOL_DIR)

clean:
	rm -rf $(TOOL_DIR) build/alpm-poc build/fs

.PHONY: tools clean bicycle

# ── bicycle binary ───────────────────────────────────────────────────
# Relies on tools/build (run separately) producing:
#   build/pacman/libalpm_objlib.a, build/sqlite3.o
BICYCLE_BIN  := build/alpm-poc
BICYCLE_DIR  := src/pollers/fs
BICYCLE_SRC  := $(wildcard $(BICYCLE_DIR)/*.c)
BICYCLE_OBJ  := $(BICYCLE_SRC:$(BICYCLE_DIR)/%.c=build/fs/%.o)
BICYCLE_LIBS := build/pacman/libalpm_objlib.a build/sqlite3.o
BICYCLE_LDLIBS := -larchive -lacl -lexpat -lzstd -llz4 -lbz2 -lz -llzma -lssl -lcrypto
BICYCLE_CFLAGS := -O0 -g -Ivendor/include -I$(BICYCLE_DIR) -I/usr/include

bicycle: $(BICYCLE_BIN)

build/fs:
	mkdir -p build/fs

build/fs/%.o: $(BICYCLE_DIR)/%.c | build/fs
	$(CC) $(BICYCLE_CFLAGS) -c $< -o $@

$(BICYCLE_BIN): $(BICYCLE_OBJ) $(BICYCLE_LIBS) | build
	$(CC) $(BICYCLE_CFLAGS) $(BICYCLE_OBJ) $(BICYCLE_LIBS) -pthread -o $@ $(BICYCLE_LDLIBS)

build:
	mkdir -p build

# ── arch-installer web UI ────────────────────────────────────────────
CACHE_DIR := .cache
ISO       := $(CACHE_DIR)/installer.iso

.PHONY: iso pkg vm vm-stop vm-ssh vm-sync vm-console installer-help installer-clean

installer-help:
	@echo "make iso         - build the custom Arch live ISO"
	@echo "make pkg         - build the bicycle pacman package only"

iso: $(ISO)

$(ISO):
	tools/build-iso.sh

pkg:
	bun tools/src/pkg.ts
	@ls build/pkg/*.pkg.tar.zst

installer-clean:
	rm -rf $(CACHE_DIR)
