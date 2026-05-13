FROM alpine:3.23

RUN apk add --no-cache \
      build-base \
      make \
      meson \
      samurai \
      pkgconf \
      bash \
      libarchive-dev libarchive-static \
      openssl-dev openssl-libs-static \
      zlib-dev zlib-static \
      zstd-dev zstd-static \
      xz-dev xz-static \
      bzip2-dev bzip2-static \
      expat-dev expat-static \
      acl-dev acl-static \
      attr-dev attr-static \
      lz4-dev lz4-static
