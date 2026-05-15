#include "schema.h"

const char* bc_db_pragmas =
  "PRAGMA journal_mode = WAL;"
  "PRAGMA synchronous = NORMAL;"
  "PRAGMA temp_store = MEMORY;"
  "PRAGMA foreign_keys = ON;"
  "PRAGMA busy_timeout = 5000;";

const char* bc_db_schema =
  "CREATE TABLE IF NOT EXISTS file_metadata ("
  "  dev           INTEGER NOT NULL,"
  "  ino           INTEGER NOT NULL,"
  "  mtime_sec     INTEGER NOT NULL,"
  "  mtime_nsec    INTEGER NOT NULL,"
  "  ctime_sec     INTEGER NOT NULL,"
  "  ctime_nsec    INTEGER NOT NULL,"
  "  size          INTEGER NOT NULL,"
  "  sha256        BLOB    NOT NULL,"
  "  path          TEXT    NOT NULL,"
  "  last_seen_run INTEGER NOT NULL,"
  "  PRIMARY KEY (dev, ino)"
  ");"
  "CREATE TABLE IF NOT EXISTS mtrees ("
  "  pkg     TEXT    PRIMARY KEY,"
  "  version TEXT    NOT NULL,"
  "  mtime   INTEGER NOT NULL"
  ");"
  "CREATE TABLE IF NOT EXISTS mtree_entries ("
  "  pkg    TEXT    NOT NULL,"
  "  path   TEXT    NOT NULL,"
  "  type   INTEGER NOT NULL,"
  "  size   INTEGER,"
  "  mode   INTEGER,"
  "  uid    INTEGER,"
  "  gid    INTEGER,"
  "  mtime  INTEGER,"
  "  sha256 BLOB,"
  "  target TEXT,"
  "  PRIMARY KEY (pkg, path),"
  "  FOREIGN KEY (pkg) REFERENCES mtrees(pkg) ON DELETE CASCADE"
  ");"
  "CREATE TABLE IF NOT EXISTS meta_run ("
  "  run_id     INTEGER PRIMARY KEY AUTOINCREMENT,"
  "  started_at INTEGER NOT NULL,"
  "  action     TEXT    NOT NULL,"
  "  db_mtime   INTEGER,"
  "  elapsed    REAL"
  ");"
  "CREATE TABLE IF NOT EXISTS findings ("
  "  run_id     INTEGER NOT NULL,"
  "  kind       INTEGER NOT NULL,"
  "  detail     TEXT    NOT NULL,"
  "  path       TEXT    NOT NULL,"
  "  pkg        TEXT,"
  "  created_at INTEGER NOT NULL"
  ");"
  "CREATE INDEX IF NOT EXISTS findings_run ON findings(run_id);";

const char* bc_db_select_file_metadata =
  "SELECT dev, ino, mtime_sec, mtime_nsec, ctime_sec, ctime_nsec, size, sha256 "
  "FROM file_metadata;";

const char* bc_db_upsert_file_metadata =
  "INSERT INTO file_metadata "
  "(dev, ino, mtime_sec, mtime_nsec, ctime_sec, ctime_nsec, size, sha256, path, last_seen_run) "
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
  "ON CONFLICT(dev, ino) DO UPDATE SET "
  "  mtime_sec = excluded.mtime_sec, "
  "  mtime_nsec = excluded.mtime_nsec, "
  "  ctime_sec = excluded.ctime_sec, "
  "  ctime_nsec = excluded.ctime_nsec, "
  "  size = excluded.size, "
  "  sha256 = excluded.sha256, "
  "  path = excluded.path, "
  "  last_seen_run = excluded.last_seen_run;";

const char* bc_db_insert_finding =
  "INSERT INTO findings (run_id, kind, detail, path, pkg, created_at) "
  "VALUES (?, ?, ?, ?, ?, ?);";

const char* bc_db_select_findings_for_run =
  "SELECT kind, detail, path, pkg FROM findings WHERE run_id = ? ORDER BY rowid;";

const char* bc_db_prune_file_metadata =
  "DELETE FROM file_metadata WHERE last_seen_run < ?;";

const char* bc_db_insert_meta_run =
  "INSERT INTO meta_run (started_at, action, db_mtime) VALUES (?, ?, ?);";

const char* bc_db_update_meta_run_elapsed =
  "UPDATE meta_run SET elapsed = ? WHERE run_id = ?;";

const char* bc_db_select_mtree =
  "SELECT version, mtime FROM mtrees WHERE pkg = ?;";

const char* bc_db_upsert_mtree =
  "INSERT INTO mtrees (pkg, version, mtime) VALUES (?, ?, ?) "
  "ON CONFLICT(pkg) DO UPDATE SET "
  "  version = excluded.version, "
  "  mtime   = excluded.mtime;";

const char* bc_db_select_mtree_entries =
  "SELECT path, type, size, mode, uid, gid, mtime, sha256, target "
  "FROM mtree_entries WHERE pkg = ?;";

const char* bc_db_insert_mtree_entry =
  "INSERT INTO mtree_entries "
  "(pkg, path, type, size, mode, uid, gid, mtime, sha256, target) "
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";

const char* bc_db_delete_mtree_entries =
  "DELETE FROM mtree_entries WHERE pkg = ?;";
