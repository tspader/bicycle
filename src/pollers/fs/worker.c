#include "worker.h"
#include "queue.h"

SP_PRIVATE bool bc_worker_lstat(bc_worker_t* w, sp_str_t path, struct stat* out) {
  c8 buf [SP_PATH_MAX];
  if (path.len >= SP_PATH_MAX) { w->errors++; return false; }
  sp_mem_copy(buf, path.data, path.len);
  buf[path.len] = '\0';
  return lstat(buf, out) == 0;
}

SP_PRIVATE sp_str_t bc_worker_readlink(sp_mem_t arena_mem, sp_str_t path) {
  c8 cpath [SP_PATH_MAX];
  if (path.len >= SP_PATH_MAX) return (sp_str_t)sp_zero;
  sp_mem_copy(cpath, path.data, path.len);
  cpath[path.len] = '\0';

  c8 tgt [SP_PATH_MAX];
  ssize_t n = readlink(cpath, tgt, sizeof(tgt));
  if (n < 0) return (sp_str_t)sp_zero;
  // readlink filling the buffer means the real target was truncated; treat
  // it as failure rather than silently comparing a truncated string.
  if ((u64)n >= sizeof(tgt)) return (sp_str_t)sp_zero;
  return sp_str_copy(arena_mem, (sp_str_t){ .data = tgt, .len = (u32)n });
}

SP_PRIVATE bool bc_worker_hash_file(bc_worker_t* w, sp_str_t path, u8 out [32]) {
  c8 cpath [SP_PATH_MAX];
  if (path.len >= SP_PATH_MAX) return false;
  sp_mem_copy(cpath, path.data, path.len);
  cpath[path.len] = '\0';

  s32 fd = open(cpath, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return false;

  if (!EVP_DigestInit_ex(w->md_ctx, EVP_sha256(), SP_NULLPTR)) { close(fd); return false; }
  for (;;) {
    ssize_t n = read(fd, w->hash_buf, BC_HASH_BUF_SIZE);
    if (n == 0) break;
    if (n < 0) { close(fd); return false; }
    if (!EVP_DigestUpdate(w->md_ctx, w->hash_buf, (size_t)n)) { close(fd); return false; }
  }
  close(fd);

  u32 outlen = 0;
  if (!EVP_DigestFinal_ex(w->md_ctx, out, &outlen) || outlen != 32) return false;
  w->hashed++;
  return true;
}

SP_PRIVATE void bc_worker_emit_finding(bc_worker_t* w, sp_mem_t mem, bc_finding_kind_t kind, sp_str_t path, sp_str_t pkg) {
  bc_write_t out = sp_zero;
  out.kind = BC_WRITE_FINDING;
  out.finding.kind = kind;
  out.finding.path = sp_str_copy(mem, path);
  out.finding.pkg = pkg;
  out.finding.created_at = (s64)sp_tm_now_epoch().s;
  bc_queue_push(&w->bc->write, out);
  w->findings++;
}

// Compare on-disk stat against an mtree entry. Returns a comma-joined detail
// string of mismatched fields, allocated in arena_mem, or {0,0} if everything
// matches.
SP_PRIVATE sp_str_t bc_worker_compare_meta(sp_mem_t arena_mem, sp_str_t path,
                                           const struct stat* st,
                                           const bc_mtree_entry_t* e) {
  sp_str_t parts [8];
  u32 n = 0;

  sp_fs_kind_t actual_kind;
  if      (S_ISREG(st->st_mode))  actual_kind = SP_FS_KIND_FILE;
  else if (S_ISDIR(st->st_mode))  actual_kind = SP_FS_KIND_DIR;
  else if (S_ISLNK(st->st_mode))  actual_kind = SP_FS_KIND_SYMLINK;
  else                            actual_kind = SP_FS_KIND_NONE;

  if (actual_kind != e->kind) {
    // When kinds disagree, every other field comparison is noise — emit just
    // the kind delta and let the operator look at the file.
    parts[n++] = sp_fmt(arena_mem, "kind={} expected={}",
                        sp_fmt_int(actual_kind), sp_fmt_int(e->kind)).value;
    return sp_str_join_n(arena_mem, parts, n, sp_str_lit(", "));
  }
  if ((s32)(st->st_mode & 07777) != e->mode) {
    parts[n++] = sp_fmt(arena_mem, "mode={} expected={}",
                        sp_fmt_int((s32)(st->st_mode & 07777)),
                        sp_fmt_int(e->mode)).value;
  }
  if ((s32)st->st_uid != e->uid) {
    parts[n++] = sp_fmt(arena_mem, "uid={} expected={}",
                        sp_fmt_int((s32)st->st_uid), sp_fmt_int(e->uid)).value;
  }
  if ((s32)st->st_gid != e->gid) {
    parts[n++] = sp_fmt(arena_mem, "gid={} expected={}",
                        sp_fmt_int((s32)st->st_gid), sp_fmt_int(e->gid)).value;
  }
  // pacman only tracks size on regular files.
  if (actual_kind == SP_FS_KIND_FILE && e->kind == SP_FS_KIND_FILE && st->st_size != e->size) {
    parts[n++] = sp_fmt(arena_mem, "size={} expected={}",
                        sp_fmt_int((s64)st->st_size), sp_fmt_int(e->size)).value;
  }
  if (actual_kind == SP_FS_KIND_SYMLINK && e->kind == SP_FS_KIND_SYMLINK && e->target.len) {
    sp_str_t actual_target = bc_worker_readlink(arena_mem, path);
    if (!sp_str_equal(actual_target, e->target)) {
      parts[n++] = sp_fmt(arena_mem, "target={.q} expected={.q}",
                          sp_fmt_str(actual_target), sp_fmt_str(e->target)).value;
    }
  }

  if (n == 0) return (sp_str_t)sp_zero;
  return sp_str_join_n(arena_mem, parts, n, sp_str_lit(", "));
}

s32 bc_worker_fn(void* userdata) {
  bc_worker_t* w = (bc_worker_t*)userdata;
  bc_t* bc = w->bc;
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(w->arena);

  bc_work_t path;
  u32 local_processed = 0;
  while (bc_queue_pop(&bc->work.queue, &path)) {
    if (sp_atomic_s32_get(&bc->cancel)) break;
    s32 scanned = sp_atomic_s32_add(&bc->files_scanned, 1) + 1;
    if (bc->prompt) {
      sp_prompt_send_progress_u64(bc->prompt, (u64)scanned);
      if ((local_processed++ & 0xFF) == 0) {
        sp_prompt_send_status_str(bc->prompt, path);
      }
    }
    struct stat st;

    if (!bc_worker_lstat(w, path, &st)) {
      // alpm thinks this path is owned, but lstat failed. Look up the mtree
      // entry so we can name the owning pkg in the finding.
      u64 idx;
      bc_mtree_entry_t* e = sp_str_ht_get_ex(bc->mtree.ht, path, idx);
      sp_str_t pkg = e ? e->pkg : (sp_str_t)sp_zero;
      bc_worker_emit_finding(w, arena_mem, BC_FINDING_MISSING, path, pkg);
      continue;
    }

    // 2b: compare every owned file against its mtree entry, regardless of
    // whether the inode cache will hit. This catches mode/uid/gid drift even
    // when content hasn't changed.
    u64 mt_idx;
    bc_mtree_entry_t* mt = sp_str_ht_get_ex(bc->mtree.ht, path, mt_idx);
    if (mt) {
      sp_str_t detail = bc_worker_compare_meta(arena_mem, path, &st, mt);
      if (detail.len) {
        bc_worker_emit_finding(w, arena_mem, BC_FINDING_MODIFIED_META, path, mt->pkg);
      }
    } else {
      bc_worker_emit_finding(w, arena_mem, BC_FINDING_UNTRACKED, path, sp_zero_s(sp_str_t));
    }

    // Directories and symlinks have no content cache; skip.
    if (!S_ISREG(st.st_mode)) continue;

    bc_file_key_t key = { .dev = (u64)st.st_dev, .ino = (u64)st.st_ino };
    u64 cache_idx;
    bc_file_meta_t* hit = sp_ht_get_ex(bc->files, key, cache_idx);
    if (hit
        && hit->mtime_sec  == (s64)st.st_mtim.tv_sec
        && hit->mtime_nsec == (s64)st.st_mtim.tv_nsec
        && hit->ctime_sec  == (s64)st.st_ctim.tv_sec
        && hit->ctime_nsec == (s64)st.st_ctim.tv_nsec
        && hit->size       == (s64)st.st_size) {
      w->hits++;
      continue;
    }
    w->misses++;

    // 2c: cache miss → hash the file. The inode cache only kicks in once we
    // store this row, so even files we have no expected hash for get hashed
    // (and the result short-circuits the next run).
    u8 hash [32] = sp_zero;
    if (!bc_worker_hash_file(w, path, hash)) {
      w->errors++;
      continue;
    }
    if (mt && mt->have_hash && sp_sys_memcmp(hash, mt->sha256, 32) != 0) {
      bc_worker_emit_finding(w, arena_mem, BC_FINDING_MODIFIED_CONTENT, path, mt->pkg);
    }

    bc_write_t out = sp_zero;
    out.kind = BC_WRITE_FILE;
    out.file.key = key;
    out.file.meta.mtime_sec = (s64)st.st_mtim.tv_sec;
    out.file.meta.mtime_nsec = (s64)st.st_mtim.tv_nsec;
    out.file.meta.ctime_sec = (s64)st.st_ctim.tv_sec;
    out.file.meta.ctime_nsec = (s64)st.st_ctim.tv_nsec;
    out.file.meta.size = (s64)st.st_size;
    sp_mem_copy(out.file.meta.sha256, hash, 32);
    out.file.path = sp_str_copy(arena_mem, path);

    bc_queue_push(&bc->write, out);
  }
  return BC_OK;
}
