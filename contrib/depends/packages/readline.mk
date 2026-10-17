package=readline
$(package)_version=8.3
$(package)_download_path=https://ftp.gnu.org/gnu/readline
$(package)_file_name=$(package)-$($(package)_version).tar.gz
$(package)_sha256_hash=fe5383204467828cd495ee8d1d3c037a7eba1389c22bc6a041f627976f9061cc
$(package)_dependencies=ncurses
$(package)_patches=readline83-001 readline83-002 readline83-003 readline83-004 readline83-005 readline83-006

define $(package)_set_vars
  $(package)_build_opts=CC="$($(package)_cc)"
  $(package)_config_opts+=--prefix=$(host_prefix)
  $(package)_config_opts+=--exec-prefix=$(host_prefix)
  $(package)_config_opts+=--host=$(HOST)
  $(package)_config_opts+=--disable-shared --with-curses
  $(package)_build_opts=CFLAGS="$($(package)_cflags) $($(package)_cppflags) -fPIC"
endef

define $(package)_preprocess_cmds
  patch -p0 < $($(package)_patch_dir)/readline83-001 &&\
  patch -p0 < $($(package)_patch_dir)/readline83-002 &&\
  patch -p0 < $($(package)_patch_dir)/readline83-003 &&\
  patch -p0 < $($(package)_patch_dir)/readline83-004 &&\
  patch -p0 < $($(package)_patch_dir)/readline83-005 &&\
  patch -p0 < $($(package)_patch_dir)/readline83-006
endef

define $(package)_config_cmds
  $(subst --disable-dependency-tracking,,$($(package)_autoconf))
endef

define $(package)_build_cmds
  $(MAKE) $($(package)_build_opts)
endef

define $(package)_stage_cmds
  $(MAKE) install DESTDIR=$($(package)_staging_dir) prefix=$(host_prefix) exec-prefix=$(host_prefix)
endef
