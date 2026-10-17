package=native_ccache
$(package)_version=3.3.4
$(package)_download_path=https://samba.org/ftp/ccache
$(package)_file_name=ccache-$($(package)_version).tar.bz2
$(package)_sha256_hash=fa9d7f38367431bc86b19ad107d709ca7ecf1574fdacca01698bdf0a47cd8567

define $(package)_set_vars
  $(package)_config_opts=--sysconfdir=/etc
  $(package)_cflags+=-ffile-prefix-map=$($(package)_extract_dir)=. -fdebug-prefix-map=$($(package)_extract_dir)=. -fmacro-prefix-map=$($(package)_extract_dir)=.
  $(package)_cflags+=-ffile-prefix-map=$(build_prefix)=/usr -fdebug-prefix-map=$(build_prefix)=/usr -fmacro-prefix-map=$(build_prefix)=/usr
  $(package)_cxxflags+=-ffile-prefix-map=$($(package)_extract_dir)=. -fdebug-prefix-map=$($(package)_extract_dir)=. -fmacro-prefix-map=$($(package)_extract_dir)=.
  $(package)_cxxflags+=-ffile-prefix-map=$(build_prefix)=/usr -fdebug-prefix-map=$(build_prefix)=/usr -fmacro-prefix-map=$(build_prefix)=/usr
endef

define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE)
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install
endef

define $(package)_postprocess_cmds
  rm -rf lib include
endef
