static const char* bc_db_select_file_metadata =
  "SELECT dev, ino, mtime_sec, mtime_nsec, ctime_sec, ctime_nsec, size, sha256 "
  "FROM file_metadata;";

static const char* bc_db_upsert_file_metadata =
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
