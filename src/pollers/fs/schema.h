#if !defined(BC_SCHEMA_H)
#define BC_SCHEMA_H

extern const char* bc_db_pragmas;
extern const char* bc_db_schema;

extern const char* bc_db_select_file_metadata;
extern const char* bc_db_upsert_file_metadata;
extern const char* bc_db_prune_file_metadata;

extern const char* bc_db_insert_finding;
extern const char* bc_db_select_findings_for_run;

extern const char* bc_db_insert_meta_run;
extern const char* bc_db_update_meta_run_elapsed;

extern const char* bc_db_select_mtree;
extern const char* bc_db_upsert_mtree;
extern const char* bc_db_select_mtree_entries;
extern const char* bc_db_insert_mtree_entry;
extern const char* bc_db_delete_mtree_entries;

#endif
