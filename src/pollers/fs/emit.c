#include "emit.h"

#include <errno.h>

SP_PRIVATE const c8 bc_hex_digits [] = "0123456789abcdef";

SP_PRIVATE sp_str_t bc_finding_detail_label(bc_finding_detail_t d) {
  switch (d) {
    case BC_FINDING_DETAIL_NONE:   return sp_str_lit("none");
    case BC_FINDING_DETAIL_KIND:   return sp_str_lit("kind");
    case BC_FINDING_DETAIL_MODE:   return sp_str_lit("mode");
    case BC_FINDING_DETAIL_UID:    return sp_str_lit("uid");
    case BC_FINDING_DETAIL_GID:    return sp_str_lit("gid");
    case BC_FINDING_DETAIL_SIZE:   return sp_str_lit("size");
    case BC_FINDING_DETAIL_TARGET: return sp_str_lit("target");
  }
  return sp_str_lit("none");
}

SP_PRIVATE void bc_json_escape(sp_io_writer_t* io, sp_str_t s) {
  u32 i = 0;
  while (i < s.len) {
    u8 c = (u8)s.data[i];
    if (c == '"' || c == '\\') {
      c8 esc [2] = { '\\', (c8)c };
      sp_io_write(io, esc, 2, SP_NULLPTR);
      i++;
    }
    else if (c < 0x20) {
      c8 esc [6] = { '\\', 'u', '0', '0', bc_hex_digits[c >> 4], bc_hex_digits[c & 0xF] };
      sp_io_write(io, esc, 6, SP_NULLPTR);
      i++;
    }
    else if (c < 0x80) {
      sp_io_write(io, &s.data[i], 1, SP_NULLPTR);
      i++;
    }
    else {
      u32 len = 0;
      if      ((c & 0xE0) == 0xC0) len = 2;
      else if ((c & 0xF0) == 0xE0) len = 3;
      else if ((c & 0xF8) == 0xF0) len = 4;
      bool ok = len && i + len <= s.len;
      if (ok) {
        sp_for_range(it, i + 1, i + len) {
          if (((u8)s.data[it] & 0xC0) != 0x80) ok = false;
        }
      }
      if (ok) {
        sp_io_write(io, &s.data[i], len, SP_NULLPTR);
        i += len;
      }
      else {
        sp_io_write_cstr(io, "\\ufffd", SP_NULLPTR);
        i++;
      }
    }
  }
}

SP_PRIVATE void bc_json_str(sp_io_writer_t* io, sp_str_t s) {
  sp_io_write_cstr(io, "\"", SP_NULLPTR);
  bc_json_escape(io, s);
  sp_io_write_cstr(io, "\"", SP_NULLPTR);
}

SP_PRIVATE void bc_json_num(sp_io_writer_t* io, s64 v) {
  c8 buf [24];
  u32 n = 0;
  u64 u = (v < 0) ? (u64)(-v) : (u64)v;
  do { buf[n++] = (c8)('0' + (u % 10)); u /= 10; } while (u);
  if (v < 0) buf[n++] = '-';
  sp_for(it, n / 2) {
    c8 tmp = buf[it];
    buf[it] = buf[n - 1 - it];
    buf[n - 1 - it] = tmp;
  }
  sp_io_write(io, buf, n, SP_NULLPTR);
}

SP_PRIVATE void bc_json_mode(sp_io_writer_t* io, s64 mode) {
  c8 buf [8];
  u32 n = 0;
  u64 u = (u64)(mode & 07777);
  do { buf[n++] = (c8)('0' + (u & 7)); u >>= 3; } while (u);
  sp_for(it, n / 2) {
    c8 tmp = buf[it];
    buf[it] = buf[n - 1 - it];
    buf[n - 1 - it] = tmp;
  }
  sp_io_write_cstr(io, "\"", SP_NULLPTR);
  sp_io_write(io, buf, n, SP_NULLPTR);
  sp_io_write_cstr(io, "\"", SP_NULLPTR);
}

SP_PRIVATE void bc_json_sha(sp_io_writer_t* io, const u8 sha [32]) {
  c8 buf [64];
  sp_for(it, 32) {
    buf[2 * it]     = bc_hex_digits[sha[it] >> 4];
    buf[2 * it + 1] = bc_hex_digits[sha[it] & 0xF];
  }
  sp_io_write_cstr(io, "\"", SP_NULLPTR);
  sp_io_write(io, buf, 64, SP_NULLPTR);
  sp_io_write_cstr(io, "\"", SP_NULLPTR);
}

SP_PRIVATE void bc_emit_line(bc_t* bc, sp_str_t line) {
  const c8* ptr = line.data;
  u64 left = line.len;
  while (left) {
    ssize_t n = write(bc->ndjson_fd, ptr, left);
    if (n < 0) {
      if (errno == EINTR) continue;
      break;
    }
    ptr += n;
    left -= (u64)n;
  }
}

void bc_emit_open(bc_t* bc) {
  bc->ndjson_fd = dup(1);
  sp_assert(bc->ndjson_fd >= 0);
  dup2(2, 1);
}

void bc_emit_finding(bc_t* bc, const bc_write_finding_t* f) {
  if (!bc->ndjson) return;

  sp_mem_arena_marker_t s = sp_mem_begin_scratch();
  sp_io_dyn_mem_writer_t w = sp_zero;
  sp_io_dyn_mem_writer_init(s.mem, &w);
  sp_io_writer_t* io = &w.base;

  sp_io_write_cstr(io, "{\"t\":\"diff\",\"type\":\"", SP_NULLPTR);
  sp_io_write_cstr(io, f->kind == BC_FINDING_STRAY ? "stray" : "pacman-file", SP_NULLPTR);
  sp_io_write_cstr(io, "\",\"id\":", SP_NULLPTR);
  bc_json_str(io, f->path);
  sp_io_write_cstr(io, ",\"field\":\"", SP_NULLPTR);

  switch (f->kind) {
    case BC_FINDING_STRAY: {
      sp_io_write_cstr(io, "exists\",\"expected\":null,\"actual\":true", SP_NULLPTR);
      break;
    }
    case BC_FINDING_MISSING: {
      sp_io_write_cstr(io, "exists\",\"expected\":true,\"actual\":false", SP_NULLPTR);
      break;
    }
    case BC_FINDING_UNTRACKED: {
      sp_io_write_cstr(io, "mtree\",\"expected\":true,\"actual\":false", SP_NULLPTR);
      break;
    }
    case BC_FINDING_MODIFIED_CONTENT: {
      sp_io_write_cstr(io, "content\",\"expected\":", SP_NULLPTR);
      bc_json_sha(io, f->sha.expected);
      sp_io_write_cstr(io, ",\"actual\":", SP_NULLPTR);
      bc_json_sha(io, f->sha.actual);
      break;
    }
    case BC_FINDING_MODIFIED_META: {
      sp_io_write_str(io, bc_finding_detail_label(f->detail), SP_NULLPTR);
      sp_io_write_cstr(io, "\",\"expected\":", SP_NULLPTR);
      switch (f->detail) {
        case BC_FINDING_DETAIL_MODE: {
          bc_json_mode(io, f->num.expected);
          sp_io_write_cstr(io, ",\"actual\":", SP_NULLPTR);
          bc_json_mode(io, f->num.actual);
          break;
        }
        case BC_FINDING_DETAIL_NONE:
        case BC_FINDING_DETAIL_UID:
        case BC_FINDING_DETAIL_GID:
        case BC_FINDING_DETAIL_SIZE: {
          bc_json_num(io, f->num.expected);
          sp_io_write_cstr(io, ",\"actual\":", SP_NULLPTR);
          bc_json_num(io, f->num.actual);
          break;
        }
        case BC_FINDING_DETAIL_KIND:
        case BC_FINDING_DETAIL_TARGET: {
          bc_json_str(io, f->str.expected);
          sp_io_write_cstr(io, ",\"actual\":", SP_NULLPTR);
          bc_json_str(io, f->str.actual);
          break;
        }
      }
      break;
    }
  }

  if (f->kind == BC_FINDING_STRAY) {
    if (f->stat.valid) {
      sp_io_write_cstr(io, ",\"meta\":{\"size\":", SP_NULLPTR);
      bc_json_num(io, f->stat.size);
      sp_io_write_cstr(io, ",\"uid\":", SP_NULLPTR);
      bc_json_num(io, f->stat.uid);
      sp_io_write_cstr(io, ",\"gid\":", SP_NULLPTR);
      bc_json_num(io, f->stat.gid);
      sp_io_write_cstr(io, "}", SP_NULLPTR);
    }
  }
  else if (!sp_str_empty(f->pkg)) {
    sp_io_write_cstr(io, ",\"meta\":{\"pkg\":", SP_NULLPTR);
    bc_json_str(io, f->pkg);
    sp_io_write_cstr(io, "}", SP_NULLPTR);
  }

  sp_io_write_cstr(io, "}\n", SP_NULLPTR);
  bc_emit_line(bc, sp_io_dyn_mem_writer_as_str(&w));
  sp_mem_end_scratch(s);
}

void bc_emit_progress(bc_t* bc, u64 done) {
  if (!bc->ndjson) return;

  sp_mem_arena_marker_t s = sp_mem_begin_scratch();
  sp_io_dyn_mem_writer_t w = sp_zero;
  sp_io_dyn_mem_writer_init(s.mem, &w);
  sp_io_writer_t* io = &w.base;

  sp_io_write_cstr(io, "{\"t\":\"progress\",\"done\":", SP_NULLPTR);
  bc_json_num(io, (s64)done);
  sp_io_write_cstr(io, "}\n", SP_NULLPTR);
  bc_emit_line(bc, sp_io_dyn_mem_writer_as_str(&w));
  sp_mem_end_scratch(s);
}
