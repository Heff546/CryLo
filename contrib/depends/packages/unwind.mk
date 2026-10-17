package=unwind
$(package)_version=1.8.3
$(package)_download_path=https://github.com/libunwind/libunwind/releases/download/v$($(package)_version)
$(package)_file_name=lib$(package)-$($(package)_version).tar.gz
$(package)_sha256_hash=be30d910e67f58d82e753231f1357f326a1a088acf126b21ff77e60aab19b90b
$(package)_patches=fix_obj_order.patch

define $(package)_preprocess_cmds
  patch -p0 < $($(package)_patch_dir)/fix_obj_order.patch
endef

define $(package)_config_cmds
  cp -f $(BASEDIR)/config.guess config/config.guess &&\
  cp -f $(BASEDIR)/config.sub config/config.sub &&\
  $($(package)_autoconf) --disable-shared --enable-static --disable-tests --disable-documentation AR_FLAGS=$($(package)_arflags)
endef

define $(package)_build_cmds
  $(MAKE)
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install
endef

define $(package)_postprocess_cmds
  rm lib/*.la
endef

