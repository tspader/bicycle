static const char* bc_db_select_mtree =
  "SELECT version, mtime FROM mtrees WHERE pkg = ?;";

static const char* bc_db_select_mtree_entries =
  "SELECT path, type, size, mode, uid, gid, mtime, sha256, target "
  "FROM mtree_entries WHERE pkg = ?;";

static const char* bc_db_upsert_mtree =
  "INSERT INTO mtrees (pkg, version, mtime) VALUES (?, ?, ?) "
  "ON CONFLICT(pkg) DO UPDATE SET "
  "  version = excluded.version, "
  "  mtime   = excluded.mtime;";

static const char* bc_db_delete_mtree_entries =
  "DELETE FROM mtree_entries WHERE pkg = ?;";

static const char* bc_db_insert_mtree_entry =
  "INSERT INTO mtree_entries "
  "(pkg, path, type, size, mode, uid, gid, mtime, sha256, target) "
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";
