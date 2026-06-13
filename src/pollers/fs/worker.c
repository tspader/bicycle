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

SP_PRIVATE sp_str_t bc_fs_kind_label(sp_fs_kind_t k) {
  switch (k) {
    case SP_FS_KIND_NONE:    return sp_str_lit("none");
    case SP_FS_KIND_FILE:    return sp_str_lit("file");
    case SP_FS_KIND_DIR:     return sp_str_lit("dir");
    case SP_FS_KIND_SYMLINK: return sp_str_lit("symlink");
  }
  return sp_str_lit("none");
}

SP_PRIVATE void bc_worker_push_finding(bc_worker_t* w, sp_mem_t mem, bc_write_finding_t finding, sp_str_t path, sp_str_t pkg) {
  bc_write_t out = sp_zero;
  out.kind = BC_WRITE_FINDING;
  out.finding = finding;
  out.finding.path = sp_str_copy(mem, path);
  out.finding.pkg = pkg;
  bc_queue_push(&w->bc->write, out);
  w->findings++;
}

SP_PRIVATE bool bc_worker_meta_diff(sp_mem_t arena_mem, sp_str_t path,
                                    const struct stat* st,
                                    const bc_mtree_entry_t* e,
                                    bc_write_finding_t* out) {
  sp_fs_kind_t actual_kind;
  if      (S_ISREG(st->st_mode))  actual_kind = SP_FS_KIND_FILE;
  else if (S_ISDIR(st->st_mode))  actual_kind = SP_FS_KIND_DIR;
  else if (S_ISLNK(st->st_mode))  actual_kind = SP_FS_KIND_SYMLINK;
  else                            actual_kind = SP_FS_KIND_NONE;

  if (actual_kind != e->kind) {
    out->detail = BC_FINDING_DETAIL_KIND;
    out->str.expected = bc_fs_kind_label(e->kind);
    out->str.actual = bc_fs_kind_label(actual_kind);
    return true;
  }
  if ((s32)(st->st_mode & 07777) != e->mode) {
    out->detail = BC_FINDING_DETAIL_MODE;
    out->num.expected = (s64)e->mode;
    out->num.actual = (s64)(st->st_mode & 07777);
    return true;
  }
  if ((s32)st->st_uid != e->uid) {
    out->detail = BC_FINDING_DETAIL_UID;
    out->num.expected = (s64)e->uid;
    out->num.actual = (s64)st->st_uid;
    return true;
  }
  if ((s32)st->st_gid != e->gid) {
    out->detail = BC_FINDING_DETAIL_GID;
    out->num.expected = (s64)e->gid;
    out->num.actual = (s64)st->st_gid;
    return true;
  }
  // pacman only tracks size on regular files.
  if (actual_kind == SP_FS_KIND_FILE && st->st_size != e->size) {
    out->detail = BC_FINDING_DETAIL_SIZE;
    out->num.expected = e->size;
    out->num.actual = (s64)st->st_size;
    return true;
  }
  if (actual_kind == SP_FS_KIND_SYMLINK && e->target.len) {
    sp_str_t actual_target = bc_worker_readlink(arena_mem, path);
    if (!sp_str_equal(actual_target, e->target)) {
      out->detail = BC_FINDING_DETAIL_TARGET;
      out->str.expected = e->target;
      out->str.actual = actual_target;
      return true;
    }
  }
  return false;
}

SP_PRIVATE void bc_worker_send_progress(bc_worker_t* w, s32 scanned) {
  if (!w->bc->ndjson) return;
  if (scanned & 2047) return;
  bc_write_t out = sp_zero;
  out.kind = BC_WRITE_PROGRESS;
  out.progress.done = (u64)scanned;
  bc_queue_push(&w->bc->write, out);
}

s32 bc_worker_fn(void* userdata) {
  bc_worker_t* w = (bc_worker_t*)userdata;
  bc_t* bc = w->bc;
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(w->arena);

  bc_work_t work;
  u32 local_processed = 0;
  while (bc_queue_pop(&bc->work.queue, &work)) {
    if (sp_atomic_s32_get(&bc->cancel)) break;
    sp_str_t path = work.path;
    s32 scanned = sp_atomic_s32_add(&bc->files_scanned, 1) + 1;
    bc_worker_send_progress(w, scanned);
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
      bc_write_finding_t f = sp_zero;
      f.kind = BC_FINDING_MISSING;
      bc_worker_push_finding(w, arena_mem, f, path, work.pkg);
      continue;
    }

    // 2b: compare every owned file against its mtree entry, regardless of
    // whether the inode cache will hit. This catches mode/uid/gid drift even
    // when content hasn't changed.
    u64 mt_idx;
    bc_mtree_entry_t* mt = sp_str_ht_get_ex(bc->mtree.ht, path, mt_idx);
    if (mt) {
      bc_write_finding_t f = sp_zero;
      f.kind = BC_FINDING_MODIFIED_META;
      if (bc_worker_meta_diff(arena_mem, path, &st, mt, &f)) {
        bc_worker_push_finding(w, arena_mem, f, path, mt->pkg);
      }
    } else {
      bc_write_finding_t f = sp_zero;
      f.kind = BC_FINDING_UNTRACKED;
      bc_worker_push_finding(w, arena_mem, f, path, work.pkg);
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
      bc_write_finding_t f = sp_zero;
      f.kind = BC_FINDING_MODIFIED_CONTENT;
      sp_mem_copy(f.sha.expected, mt->sha256, 32);
      sp_mem_copy(f.sha.actual, hash, 32);
      bc_worker_push_finding(w, arena_mem, f, path, mt->pkg);
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
