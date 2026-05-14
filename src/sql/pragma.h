static const char* bc_db_pragmas =
  "PRAGMA journal_mode = WAL;"
  "PRAGMA synchronous = NORMAL;"
  "PRAGMA temp_store = MEMORY;"
  "PRAGMA foreign_keys = ON;"
  "PRAGMA busy_timeout = 5000;";
