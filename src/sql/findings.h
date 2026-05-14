static const char* bc_db_insert_finding =
  "INSERT INTO findings (run_id, kind, path, pkg, detail, created_at) "
  "VALUES (?, ?, ?, ?, ?, ?);";

static const char* bc_db_select_findings_for_run =
  "SELECT kind, path, pkg, detail FROM findings WHERE run_id = ? ORDER BY rowid;";
