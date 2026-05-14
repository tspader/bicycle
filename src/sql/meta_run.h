static const char* bc_db_insert_meta_run =
  "INSERT INTO meta_run (started_at, action, db_mtime) VALUES (?, ?, ?);";

static const char* bc_db_update_meta_run_elapsed =
  "UPDATE meta_run SET elapsed = ? WHERE run_id = ?;";
