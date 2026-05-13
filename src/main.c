#define SP_IMPLEMENTATION
#include "sp.h"

#include <alpm.h>
#include <alpm_list.h>

void bc_check_alpm(alpm_errno_t err) {
  if (err) {
    sp_log("alpm returner error {.red}: {}", sp_fmt_int(err), sp_fmt_str(alpm_strerror(err)));
    SP_EXIT_FAILURE();
  }
}

typedef struct {
  const c8* root;
  const c8* db;
} bc_paths_t;

#define bc_alpm_for(it, list) for (alpm_list_t* it = list; it; it = alpm_list_next(it))

int main(int argc, char **argv) {
  sp_mem_t mem = sp_mem_os_new();
  sp_mem_arena_marker_t s = sp_mem_begin_scratch();

  bc_paths_t paths = {
    .root = "/",
    .db = "/var/lib/pacman"
  };

  sp_log("libalpm version: {.cyan}", sp_fmt_str(alpm_version()));

	alpm_errno_t err = 0;
	alpm_handle_t* a = alpm_initialize(paths.root, paths.db, &err);
  bc_check_alpm(err);

	alpm_db_t* db = alpm_get_localdb(a);
	alpm_list_t* cache = alpm_db_get_pkgcache(db);

	u64 num_packages = alpm_list_count(cache);
  sp_log("installed packages: {.cyan}", sp_fmt_uint(num_packages));

  bc_alpm_for(it, cache) {
    alpm_pkg_t* pkg = it->data;
    sp_log("{:<32} {.gray}", sp_fmt_cstr(alpm_pkg_get_name(pkg)), sp_fmt_cstr(alpm_pkg_get_version(pkg)));
  }

	alpm_release(a);
	return 0;
}
