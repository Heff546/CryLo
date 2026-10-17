package=abseil
$(package)_version=20260526.0
$(package)_download_path=https://github.com/abseil/abseil-cpp/releases/download/$($(package)_version)
$(package)_file_name=abseil-cpp-$($(package)_version).tar.gz
$(package)_sha256_hash=6e1aee535473414164bf83e4ebc40240dec71a4701f8a642d906e95bea1aea0c
$(package)_cxxflags=-std=c++17

define $(package)_set_vars
  $(package)_config_opts=-DCMAKE_BUILD_TYPE=Release
  $(package)_config_opts+=-DCMAKE_INSTALL_LIBDIR=lib
  $(package)_config_opts+=-DCMAKE_POSITION_INDEPENDENT_CODE=ON
  $(package)_config_opts+=-DBUILD_SHARED_LIBS=OFF
  $(package)_config_opts+=-DBUILD_TESTING=OFF
  $(package)_config_opts+=-DABSL_BUILD_TESTING=OFF
  $(package)_config_opts+=-DABSL_BUILD_TEST_HELPERS=OFF
  $(package)_config_opts+=-DABSL_ENABLE_INSTALL=ON
  $(package)_config_opts+=-DABSL_PROPAGATE_CXX_STD=ON
  $(package)_cflags_linux+=-ffile-prefix-map=$($(package)_extract_dir)=. -fdebug-prefix-map=$($(package)_extract_dir)=. -fmacro-prefix-map=$($(package)_extract_dir)=.
  $(package)_cflags_linux+=-ffile-prefix-map=$(host_prefix)=/usr -fdebug-prefix-map=$(host_prefix)=/usr -fmacro-prefix-map=$(host_prefix)=/usr
  $(package)_cxxflags_linux+=-ffile-prefix-map=$($(package)_extract_dir)=. -fdebug-prefix-map=$($(package)_extract_dir)=. -fmacro-prefix-map=$($(package)_extract_dir)=.
  $(package)_cxxflags_linux+=-ffile-prefix-map=$(host_prefix)=/usr -fdebug-prefix-map=$(host_prefix)=/usr -fmacro-prefix-map=$(host_prefix)=/usr
endef

define $(package)_config_cmds
  CC="$($(package)_cc)" CXX="$($(package)_cxx)" \
  CFLAGS="$($(package)_cflags) $($(package)_cppflags)" \
  CXXFLAGS="$($(package)_cxxflags) $($(package)_cppflags)" \
  LDFLAGS="$($(package)_ldflags)" \
  cmake -S . -B build \
    -DCMAKE_SYSTEM_NAME=$(host_cmake) \
    -DCMAKE_SYSTEM_PROCESSOR=$(host_arch) \
    -DCMAKE_INSTALL_PREFIX=$(host_prefix) \
    $($(package)_config_opts)
endef

define $(package)_build_cmds
  cmake --build build --parallel 2
endef

define $(package)_stage_cmds
  DESTDIR=$($(package)_staging_dir) cmake --install build
endef
