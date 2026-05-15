#if !defined(BC_BC_H)
#define BC_BC_H

// sp.h declares its "implementation" helpers as SP_IMP / SP_PRIVATE, both
// defaulting to `static`. That works for a single-TU build but breaks any
// other TU that calls them. Force external linkage so the one TU with
// SP_IMPLEMENTATION (main.c) provides the symbols for the rest. Both macros
// live in the same `#if !defined(SP_PRIVATE)` block in sp.h, so we pre-define
// both to skip that block; sp.h also re-uses one of them inconsistently
// (line 7617), so both must be extern to keep the prototype/definition
// linkage consistent.
#define SP_PRIVATE
#define SP_IMP

#include "sp.h"
#include "sp_prompt.h"

// Restore SP_PRIVATE to `static` for our own code below — sp.h is done with it.
#undef SP_PRIVATE
#define SP_PRIVATE static

// Forward-declare alpm_handle_t so bc_t can hold a pointer without us having
// to #include <alpm.h> here. Including the system header from bc.h is awkward
// because our local pollers/fs/alpm.h would shadow it through -I search.
// Each .c that calls libalpm includes <alpm.h> itself.
typedef struct _alpm_handle_t alpm_handle_t;

#include <archive.h>
#include <archive_entry.h>
#include <openssl/evp.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>
#include "sqlite3.h"

#define bc_try_goto(expr, err, label) do { err = (expr); if (err) goto label; } while (0)
#define bc_try(expr) do { bc_err_t _bc_result = (expr); if (_bc_result) return _bc_result; } while (0)
#define bc_alpm_for(it, list) for (alpm_list_t* it = list; it; it = alpm_list_next(it))

#define BC_NUM_WORKERS       8
#define BC_ARENA_BLOCK_SIZE  (4u * 1024u * 1024u)
#define BC_QUEUE_CAPACITY    4096u
#define BC_WRITE_BATCH       1024u
#define BC_HASH_BUF_SIZE     (1u * 1024u * 1024u)

typedef enum {
  BC_OK,
  BC_ERR,
  BC_ERR_SQLITE_EXEC,
  BC_ERR_SQLITE_PREPARE,
} bc_err_t;

typedef struct {
  u64 dev;
  u64 ino;
} bc_file_key_t;

typedef struct {
  s64 mtime_sec;
  s64 mtime_nsec;
  s64 ctime_sec;
  s64 ctime_nsec;
  s64 size;
  u8  sha256 [32];
} bc_file_meta_t;

typedef sp_ht(bc_file_key_t, bc_file_meta_t) bc_file_cache_t;

typedef struct {
  sp_str_t pkg;
  sp_str_t path;
  sp_fs_kind_t kind;
  s64 size;
  s32 mode;
  s32 uid;
  s32 gid;
  s64 mtime;
  u8  sha256 [32];
  bool have_hash;
  sp_str_t target;
} bc_mtree_entry_t;

typedef sp_str_ht(bc_mtree_entry_t) bc_mtree_ht_t;

// Work items are just borrowed string slices into bc->work.arena. The arena
// is a plain bump allocator owned by bc_t, populated by the producer before
// workers spawn (well, concurrently with their consumption) and torn down
// only after every worker has joined.
typedef sp_str_t bc_work_t;

typedef enum {
  BC_WRITE_FILE    = 1,
  BC_WRITE_FINDING = 2,
} bc_write_kind_t;

typedef enum {
  BC_FINDING_MODIFIED_META    = 1,
  BC_FINDING_MODIFIED_CONTENT = 2,
  BC_FINDING_MISSING          = 3,
  BC_FINDING_UNTRACKED        = 4,
  BC_FINDING_STRAY            = 5,
} bc_finding_kind_t;

typedef struct {
  bc_file_key_t  key;
  bc_file_meta_t meta;
  sp_str_t       path;
} bc_write_file_t;

typedef struct {
  bc_finding_kind_t kind;
  sp_str_t path;
  sp_str_t pkg;
  sp_str_t detail;
  s64 created_at;
} bc_write_finding_t;

typedef struct {
  bc_write_kind_t kind;
  union {
    bc_write_file_t    file;
    bc_write_finding_t finding;
  };
} bc_write_t;

typedef struct {
  sp_str_t root;
  sp_str_t db;
  sp_str_t cache;
} bc_paths_t;

typedef struct bc_t bc_t;

#include "queue.h"

typedef bc_queue(bc_work_t)  bc_work_queue_t;
typedef bc_queue(bc_write_t) bc_write_queue_t;

typedef struct {
  bc_t*           bc;
  u32             id;
  sp_thread_t     thread;
  sp_mem_arena_t* arena;
  EVP_MD_CTX*     md_ctx;
  u8*             hash_buf;
  u64             hits;
  u64             misses;
  u64             hashed;
  u64             errors;
  u64             findings;
} bc_worker_t;

typedef struct {
  bc_t*       bc;
  sqlite3*    sql;
  sp_thread_t thread;
  u64         writes;
  bc_err_t    err;
} bc_writer_t;

struct bc_t {
  sp_mem_t mem;
  alpm_handle_t* alpm;
  sqlite3* sql;
  bc_paths_t paths;
  u64 num_packages;
  u64 num_files;
  u64 num_visited;
  u64 num_strays;
  u64 run_id;

  bc_file_cache_t files;

  struct {
    bc_mtree_ht_t   ht;
    sp_mem_arena_t* arena;
    u64             decoded;
    u64             cached;
    u64             entries;
  } mtree;

  struct {
    bc_work_queue_t queue;
    sp_mem_arena_t* arena;
  } work;

  bc_write_queue_t write;

  bc_worker_t workers [BC_NUM_WORKERS];
  bc_writer_t writer;

  sp_prompt_ctx_t* prompt;
  sp_atomic_s32_t files_scanned;
  sp_atomic_s32_t cancel;

  struct {
    u64 mtree;
    u64 alpm;
    u64 strays;
    u64 total;
  } timings;
};

#endif
