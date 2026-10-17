package=ncurses
$(package)_version=6.6-20261010
$(package)_download_path=https://invisible-island.net/archives/ncurses/current
$(package)_file_name=$(package)-$($(package)_version).tgz
$(package)_sha256_hash=00a1d10c51c3aa1b4dae9ea4421aec2dd227fa4724e645850ed43fd6fc0a56ec
$(package)_patches=fallback.c

define $(package)_set_vars
  $(package)_build_opts=CC="$($(package)_cc)"
  $(package)_config_env=cf_cv_ar_flags=""
  $(package)_config_opts=--prefix=$(host_prefix)
  $(package)_config_opts+=--disable-shared
  $(package)_config_opts+=--with-build-cc=gcc
  $(package)_config_opts+=--without-debug
  $(package)_config_opts+=--without-ada
  $(package)_config_opts+=--without-cxx-binding
  $(package)_config_opts+=--without-cxx
  $(package)_config_opts+=--without-ticlib
  $(package)_config_opts+=--without-tic
  $(package)_config_opts+=--without-progs
  $(package)_config_opts+=--without-tests
  $(package)_config_opts+=--without-tack
  $(package)_config_opts+=--without-manpages
  $(package)_config_opts+=--with-termlib=tinfo
  $(package)_config_opts+=--disable-tic-depends
  $(package)_config_opts+=--disable-big-strings
  $(package)_config_opts+=--disable-ext-colors
  $(package)_config_opts+=--disable-widec
  $(package)_config_opts+=--enable-pc-files
  $(package)_config_opts+=--with-default-terminfo-dir=/etc/_terminfo_
  $(package)_config_opts+=--with-terminfo-dirs=/etc/_terminfo_
  $(package)_build_opts=CFLAGS="$($(package)_cflags) $($(package)_cppflags) -fPIC"
endef

define $(package)_preprocess_cmds
  cp $($(package)_patch_dir)/fallback.c ncurses
endef

define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE) $($(package)_build_opts) V=1
endef

define $(package)_stage_cmds
  $(MAKE) install.libs DESTDIR=$($(package)_staging_dir)
endef
