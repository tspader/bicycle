#if !defined(BC_QUEUE_H)
#define BC_QUEUE_H

#define bc_queue(T) struct { \
  sp_mutex_t mu;             \
  sp_cv_t    not_empty;      \
  sp_cv_t    not_full;       \
  bool       closed;         \
  sp_rb(T)   rb;             \
}

#define bc_queue_init(mem, q, cap) do {            \
  sp_mutex_init(&(q)->mu, SP_MUTEX_PLAIN);         \
  sp_cv_init(&(q)->not_empty);                     \
  sp_cv_init(&(q)->not_full);                      \
  (q)->closed = false;                             \
  sp_rb_init_cap((mem), (q)->rb, (cap));           \
} while (0)

#define bc_queue_push(q, item) do {                                  \
  sp_mutex_lock(&(q)->mu);                                           \
  while (sp_rb_size((q)->rb) >= sp_rb_capacity((q)->rb) && !(q)->closed) { \
    sp_cv_wait(&(q)->not_full, &(q)->mu);                            \
  }                                                                  \
  if (!(q)->closed) {                                                \
    sp_rb_push((q)->rb, (item));                                     \
    sp_cv_notify_one(&(q)->not_empty);                               \
  }                                                                  \
  sp_mutex_unlock(&(q)->mu);                                         \
} while (0)

// Returns true if an item was popped, false if the queue was closed
#define bc_queue_pop(q, out) __extension__ ({                        \
  bool _ok = false;                                                  \
  sp_mutex_lock(&(q)->mu);                                           \
  while (sp_rb_empty((q)->rb) && !(q)->closed) {                     \
    sp_cv_wait(&(q)->not_empty, &(q)->mu);                           \
  }                                                                  \
  if (!sp_rb_empty((q)->rb)) {                                       \
    *(out) = *sp_rb_peek((q)->rb);                                   \
    sp_rb_pop((q)->rb);                                              \
    sp_cv_notify_one(&(q)->not_full);                                \
    _ok = true;                                                      \
  }                                                                  \
  sp_mutex_unlock(&(q)->mu);                                         \
  _ok;                                                               \
})

#define bc_queue_close(q) do {                                       \
  sp_mutex_lock(&(q)->mu);                                           \
  (q)->closed = true;                                                \
  sp_cv_notify_all(&(q)->not_empty);                                 \
  sp_cv_notify_all(&(q)->not_full);                                  \
  sp_mutex_unlock(&(q)->mu);                                         \
} while (0)

#endif
